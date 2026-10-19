export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { adopters, adoptions, duplicateTokens, duplicateCandidates, adopterFlags, appConfig, users } from '@/db/schema';
import { eq, sql, isNull, or, and } from 'drizzle-orm';
import { auth } from '@/auth';
import { isAdminAsync } from '@/config/admins';
import { logger } from '@/lib/logger';
import { extractTokens, computeTokenHash } from '@/lib/tokenizer';
import { tokenInputsFor } from '@/lib/adopterTokenize';
import { pairsOnSharedToken, scorePair, confidenceOf } from '@/domain/duplicatePairing';
import { lockWaitMs } from '@/domain/scanResilience';
import { computeAvgRating } from '@/domain/ratings';
import { getRequestContext } from '@/lib/requestContext';

/**
 * Compute the average activity rating for an adopter. Cheap D1-safe lookup —
 * one query per id. Returns null when the adopter has no rated records yet
 * (matches the rest of the app's "no activity = no rating" convention).
 * The legacy `adopter.status` column is deprecated; only avgRating is real.
 */
/** email → display name for the people who registered the listed profiles (one query per person; never IN on D1). */
async function creatorNamesFor(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, emails: Array<string | null | undefined>): Promise<Record<string, string | null>> {
    const distinct = [...new Set(emails.filter((e): e is string => !!e && e.includes('@')))];
    const rows = await Promise.all(distinct.map(email =>
        db.select({ name: users.name }).from(users).where(eq(users.email, email)).get()
            .then((u: { name: string | null } | undefined) => [email, u?.name ?? null] as const)
            .catch((e: unknown) => {
                logger.warn('Duplicate list: creator name fallback hit', { error: e instanceof Error ? e.message : String(e) });
                return [email, null] as const;
            }),
    ));
    return Object.fromEntries(rows);
}

async function avgRatingFor(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, adopterId: string | null | undefined): Promise<number | null> {
    if (!adopterId) return null;
    const rows = await db.select({ rating: adoptions.rating })
        .from(adoptions)
        .where(eq(adoptions.adopterId, adopterId))
        .all() as Array<{ rating: number | null }>;
    return computeAvgRating(rows);
}

/**
 * GET /api/admin/duplicates
 * Returns paginated duplicate candidates + user-flagged duplicates
 */
export async function GET(request: Request) {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const db = await getDb();
        if (!db) throw new Error('Database not available');

        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status') || 'pending';
        const page = Math.max(1, parseInt(searchParams.get('page') || '1') || 1);
        // 50 pairs/page × 4 enrichment queries each = 200 subrequests; with the
        // user-flagged section's own fan-out this stays under the Workers
        // ceiling, but don't raise it further without batching the enrichment.
        const limit = 50;
        const offset = (page - 1) * limit;

        // Optional confidence filter, e.g. `confidence=high,medium`. The low
        // tier is ~75% of the queue and mostly single-shared-name-word noise,
        // so the panel defaults to hiding it; unknown values are dropped.
        const confidenceParam = (searchParams.get('confidence') || '')
            .split(',').map(s => s.trim()).filter(c => c === 'high' || c === 'medium' || c === 'low');
        const confidenceCond = confidenceParam.length > 0 && confidenceParam.length < 3
            ? or(...confidenceParam.map(c => eq(duplicateCandidates.confidence, c)))
            : undefined;

        // Exclude pairs referencing a soft-deleted (merged-away) adopter from
        // the PENDING view only — such "ghost" pairs render like live
        // duplicates but their merge is refused by the already-deleted guard.
        // The dismissed/merged views keep them: there one deleted side is the
        // expected outcome, and filtering would empty the merged tab.
        const bothSidesLive = sql`${duplicateCandidates.adopter1Id} IN (SELECT id FROM adopters WHERE deleted_at IS NULL) AND ${duplicateCandidates.adopter2Id} IN (SELECT id FROM adopters WHERE deleted_at IS NULL)`;
        const candidateWhere = and(
            eq(duplicateCandidates.status, status),
            ...(status === 'pending' ? [bothSidesLive] : []),
            ...(confidenceCond ? [confidenceCond] : []),
        );

        // 1. User-flagged duplicates (from adopterFlags)
        const userFlagged = await db.select({
            flagId: adopterFlags.id,
            adopterId: adopterFlags.adopterId,
            targetAdopterId: adopterFlags.targetAdopterId,
            flaggedBy: adopterFlags.flaggedBy,
            details: adopterFlags.details,
            createdAt: adopterFlags.createdAt,
        })
            .from(adopterFlags)
            .where(eq(adopterFlags.reason, 'duplicate'))
            // Bound the per-row enrichment fan-out below (each row = 4 D1 queries);
            // uncapped this could exceed the Workers subrequest limit and 500.
            .limit(100);

        // D1-fallback logger for the enrichment fan-out below. A swallowed
        // error here used to render as the name "Deleted"/"Unknown" — a lie
        // on a vetting tool. Log per the fallback convention and return the
        // fallback so one bad sub-query still doesn't sink the panel.
        const logFallback = <T,>(op: string, ctx: Record<string, unknown>, fallback: T) => (e: unknown): T => {
            logger.warn(`Duplicate list: ${op} fallback hit`, { ...ctx, error: e instanceof Error ? e.message : String(e) });
            return fallback;
        };
        // Name semantics for the panel: row missing (hard-deleted or fetch
        // failure, both logged) → null; row present with empty name → '' —
        // a legitimate NAMELESS profile (see adopterDisplay.ts), never to be
        // labeled deleted. The old `?.name || 'Deleted'` collapsed the two.
        const nameOf = (row: { name: string } | null | undefined): string | null => (row ? row.name : null);

        // Enrich user-flagged with adopter names + computed avgRating.
        const userFlaggedEnriched = await Promise.all(
            userFlagged.map(async (flag: typeof userFlagged[number]) => {
                const [adopter1, adopter2, avg1, avg2] = await Promise.all([
                    db.select({ name: adopters.name, contactInfo: adopters.contactInfo, addedBy: adopters.addedBy })
                        .from(adopters).where(eq(adopters.id, flag.adopterId)).get()
                        .catch(logFallback('flag adopter fetch', { flagId: flag.flagId, adopterId: flag.adopterId }, undefined)),
                    flag.targetAdopterId
                        ? db.select({ name: adopters.name, contactInfo: adopters.contactInfo, addedBy: adopters.addedBy })
                            .from(adopters).where(eq(adopters.id, flag.targetAdopterId)).get()
                            .catch(logFallback('flag target fetch', { flagId: flag.flagId, adopterId: flag.targetAdopterId }, undefined))
                        : null,
                    avgRatingFor(db, flag.adopterId).catch(logFallback('flag avgRating', { flagId: flag.flagId, adopterId: flag.adopterId }, null)),
                    avgRatingFor(db, flag.targetAdopterId).catch(logFallback('flag target avgRating', { flagId: flag.flagId, adopterId: flag.targetAdopterId }, null)),
                ]);
                return {
                    ...flag,
                    source: 'user' as const,
                    adopter1Name: nameOf(adopter1),
                    adopter1Contact: adopter1?.contactInfo,
                    adopter1AvgRating: avg1,
                    adopter1AddedBy: adopter1?.addedBy ?? null,
                    adopter2Name: nameOf(adopter2),
                    adopter2Contact: adopter2?.contactInfo,
                    adopter2AvgRating: avg2,
                    adopter2AddedBy: adopter2?.addedBy ?? null,
                };
            })
        );

        // 2. System-detected candidates
        const candidates = await db.select()
            .from(duplicateCandidates)
            .where(candidateWhere)
            .orderBy(sql`${duplicateCandidates.score} DESC`)
            .limit(limit)
            .offset(offset);

        // Total under the CURRENT filter — what the pagination math needs.
        // The stat-card counts below are per-status totals and ignore the
        // confidence filter, so they can't stand in for this.
        const filteredTotalRows = await db.select({ count: sql<number>`COUNT(*)` })
            .from(duplicateCandidates)
            .where(candidateWhere);
        const filteredTotal = filteredTotalRows[0]?.count || 0;

        // Enrich with adopter data + computed avgRating.
        const candidatesEnriched = await Promise.all(
            candidates.map(async (c: typeof candidates[number]) => {
                const [adopter1, adopter2, avg1, avg2] = await Promise.all([
                    db.select({ name: adopters.name, contactInfo: adopters.contactInfo, addedBy: adopters.addedBy })
                        .from(adopters).where(eq(adopters.id, c.adopter1Id)).get()
                        .catch(logFallback('candidate adopter1 fetch', { candidateId: c.id, adopterId: c.adopter1Id }, undefined)),
                    db.select({ name: adopters.name, contactInfo: adopters.contactInfo, addedBy: adopters.addedBy })
                        .from(adopters).where(eq(adopters.id, c.adopter2Id)).get()
                        .catch(logFallback('candidate adopter2 fetch', { candidateId: c.id, adopterId: c.adopter2Id }, undefined)),
                    avgRatingFor(db, c.adopter1Id).catch(logFallback('candidate avgRating1', { candidateId: c.id, adopterId: c.adopter1Id }, null)),
                    avgRatingFor(db, c.adopter2Id).catch(logFallback('candidate avgRating2', { candidateId: c.id, adopterId: c.adopter2Id }, null)),
                ]);
                return {
                    ...c,
                    source: 'system' as const,
                    adopter1Name: nameOf(adopter1),
                    adopter1Contact: adopter1?.contactInfo,
                    adopter1AvgRating: avg1,
                    adopter1AddedBy: adopter1?.addedBy ?? null,
                    adopter2Name: nameOf(adopter2),
                    adopter2Contact: adopter2?.contactInfo,
                    adopter2AvgRating: avg2,
                    adopter2AddedBy: adopter2?.addedBy ?? null,
                };
            })
        );

        // Counts
        const [pendingCount, dismissedCount, mergedCount] = await Promise.all([
            // Pending counts only actionable pairs — ghosts referencing a
            // merged-away adopter are excluded, same as the pending listing.
            db.select({ count: sql<number>`COUNT(*)` }).from(duplicateCandidates)
                .where(and(eq(duplicateCandidates.status, 'pending'), bothSidesLive)),
            db.select({ count: sql<number>`COUNT(*)` }).from(duplicateCandidates).where(eq(duplicateCandidates.status, 'dismissed')),
            db.select({ count: sql<number>`COUNT(*)` }).from(duplicateCandidates).where(eq(duplicateCandidates.status, 'merged')),
        ]);

        // How many records still need re-tokenizing. Staleness is
        // `token_hash !== computeTokenHash(record)` and that hash is computed in
        // app code, so no SQL query can answer this — without surfacing it here
        // there is NO way to see scan progress except by running another batch,
        // which is exactly the wrong tool for "did it finish?".
        //
        // One extra select of the hashable columns; hashing is pure and
        // in-memory. This endpoint is admin-only and low-traffic.
        let staleCount = 0;
        try {
            const hashable = await db.select({
                name: adopters.name,
                contactInfo: adopters.contactInfo,
                addressInfo: adopters.addressInfo,
                familyMembers: adopters.familyMembers,
                householdMembers: adopters.householdMembers,
                sourceUrl: adopters.sourceUrl,
                contactEntries: adopters.contactEntries,
                country: adopters.country,
                tokenHash: adopters.tokenHash,
            }).from(adopters).where(isNull(adopters.deletedAt));
            for (const a of hashable) {
                if (a.tokenHash !== computeTokenHash(a)) staleCount++;
            }
        } catch (e) {
            // Never fail the whole panel over a progress counter.
            logger.warn('Duplicate list: stale count failed', {
                error: e instanceof Error ? e.message : String(e),
            });
            staleCount = -1; // -1 = unknown, so the UI can say so rather than lie with 0
        }

        // Whether the LAST scan actually finished. `duplicate_scan_last_run` is
        // written only by the completion block, so it is the authoritative
        // marker — and it was previously written but never surfaced anywhere.
        //
        // This gap is what made a failed scan look successful: detection dies
        // after inserting candidates, the queue fills, `staleCount` reads 0
        // because tokenizing DID finish, and the panel cheerfully reports
        // everything tokenized. Meanwhile the status sits at 'running'/'error'
        // and last-run is months stale, visible only by querying D1 by hand.
        let scan: { status: string | null; lastRun: string | null } = { status: null, lastRun: null };
        try {
            const rows = await db.select({ key: appConfig.key, value: appConfig.value })
                .from(appConfig)
                .where(or(
                    eq(appConfig.key, 'duplicate_scan_status'),
                    eq(appConfig.key, 'duplicate_scan_last_run'),
                ));
            const byKey = new Map<string, string>();
            for (const r of rows as Array<{ key: string; value: string | null }>) {
                if (r.value != null) byKey.set(r.key, String(r.value));
            }
            scan = {
                status: byKey.get('duplicate_scan_status') ?? null,
                lastRun: byKey.get('duplicate_scan_last_run') ?? null,
            };
        } catch (e) {
            logger.warn('Duplicate list: scan status read failed', {
                error: e instanceof Error ? e.message : String(e),
            });
        }

        return NextResponse.json({
            userFlagged: userFlaggedEnriched,
            candidates: candidatesEnriched,
            // Who registered each profile, by name (admins see the email too).
            creatorNames: await creatorNamesFor(db, [...userFlaggedEnriched, ...candidatesEnriched]
                .flatMap((r: { adopter1AddedBy?: string | null; adopter2AddedBy?: string | null }) => [r.adopter1AddedBy, r.adopter2AddedBy])),
            filteredTotal,
            staleCount,
            scan,
            counts: {
                pending: pendingCount[0]?.count || 0,
                dismissed: dismissedCount[0]?.count || 0,
                merged: mergedCount[0]?.count || 0,
                userFlagged: userFlaggedEnriched.length,
            },
            page,
            hasMore: candidates.length === limit,
        });
    } catch (error) {
        const errorId = logger.error('Duplicate list failed', error instanceof Error ? error : new Error(String(error)), {
            session: session.user.email,
        });
        // Return the errorId + message in the response so the admin can paste
        // it back when reporting. Admin endpoint — leaking the message is OK.
        return NextResponse.json({
            error: 'Failed to load duplicates',
            errorId,
            message: error instanceof Error ? error.message : String(error),
        }, { status: 500 });
    }
}

/**
 * POST /api/admin/duplicates
 * Scan: refresh stale tokens, find shared tokens, score pairs, insert candidates
 */
/**
 * How many stale records one Scan call re-tokenizes.
 *
 * A Worker has a hard subrequest ceiling (~1000), and a tokenizer-version bump
 * makes EVERY record stale at once — 1,146 in production as of v2.49.
 *
 * Writes go out as one atomic D1 batch per SCAN_WRITE_GROUP records (a batch
 * is one subrequest), so a batch of 25 costs ~3 write subrequests plus a
 * handful of surrounding queries. History: per-record writes used to cost
 * `2 + tokenCount`, and v2.49.3's batch of 100 was hard-killed on production
 * data with the scan lock wedged at `running` (see lockWaitMs); then 3
 * sequential calls per record (~30 s per batch of 50), where one dropped call
 * left a record half-written (2026-10-10). The loop is automatic, so the batch
 * stays modest: a smaller batch loses less to a failure. Callers that want
 * fewer round trips can pass `?limit=` up to SCAN_BATCH_MAX.
 */
// 25 since 2.56.159: a batch of 50 took ~30 s, and a dropped browser
// connection cancels the batch in flight — a shorter one loses less and lets
// the page retry sooner (see src/domain/scanResilience.ts).
const SCAN_BATCH_DEFAULT = 25;
const SCAN_BATCH_MAX = 200;

/**
 * Rows per multi-row token insert.
 *
 * **D1 caps bound parameters at 100 per query.** `duplicate_tokens` binds 4
 * columns per row, so 25 rows is the hard ceiling and 20 leaves margin.
 *
 * This is not theoretical. v2.49.4 inserted every token in one statement and
 * died on a real profile whose notes tokenize into 20+ `name_word` entries:
 * 27 rows × 4 = 108 bindings, over the cap, mid-scan. It survived local testing
 * because the 78-record fixture set contains no profile that verbose.
 *
 * Note the v5 tokenizer emits MORE tokens than v3, so sizing this off existing
 * `duplicate_tokens` counts understates it — that is how 27 slipped past a
 * measured maximum of 26.
 */
const TOKEN_INSERT_CHUNK = 20;

/** Records whose token writes go out as one atomic D1 batch (one round trip, one subrequest). */
const SCAN_WRITE_GROUP = 10;

function chunkList<T>(list: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
}

/** Run `op`; on failure wait a moment and run it once more. Only for atomic / idempotent work. */
async function withOneRetry<T>(what: string, op: () => Promise<T>, context: Record<string, unknown>): Promise<T> {
    try {
        return await op();
    } catch (e) {
        logger.warn(`${what} failed, retrying once`, { ...context, error: e instanceof Error ? e.message : String(e) });
        await new Promise(r => setTimeout(r, 750));
        return op();
    }
}

/**
 * Rows per multi-row candidate insert. `duplicate_candidates` binds 8 columns,
 * so D1's 100-parameter cap allows 12 rows; 10 leaves margin.
 */
const CANDIDATE_INSERT_CHUNK = 10;

/**
 * A `running` lock is reclaimed once abandoned — see lockWaitMs
 * (src/domain/scanResilience.ts): after 5 minutes for anyone, after 1 minute for
 * the admin who holds it (their own batch, cut off by a dropped connection).
 *
 * Load-bearing: when a Worker is hard-killed or its client disconnects, the
 * `catch` below never runs, so the lock stays `running` and every subsequent
 * scan would 409. That happened on staging 2026-09-02 and needed a manual
 * UPDATE to recover — unacceptable for a production runbook step.
 */

export async function POST(request: Request) {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const db = await getDb();
        if (!db) throw new Error('Database not available');

        // Check scan lock
        const lockRow = await db.select().from(appConfig).where(eq(appConfig.key, 'duplicate_scan_status')).get();
        if (lockRow?.value === 'running') {
            // Reclaim an abandoned lock rather than 409 forever — a hard-killed
            // Worker or a dropped connection leaves this set with no catch block
            // to clear it.
            const lockAgeMs = lockRow.updatedAt ? Date.now() - new Date(lockRow.updatedAt).getTime() : Infinity;
            const waitMs = lockWaitMs(lockAgeMs, lockRow.updatedBy, session.user.email);
            if (waitMs > 0) {
                return NextResponse.json({ error: 'Scan already in progress', retryInMs: waitMs }, { status: 409 });
            }
            logger.warn('Duplicate scan: reclaiming stale lock', {
                lockAgeMs, sameUser: lockRow.updatedBy === session.user.email, user: session.user.email,
            });
        }

        // Set lock
        await db.insert(appConfig).values({
            key: 'duplicate_scan_status',
            value: 'running',
            updatedAt: new Date(),
            updatedBy: session.user.email,
        }).onConflictDoUpdate({
            target: appConfig.key,
            set: { value: 'running', updatedAt: new Date(), updatedBy: session.user.email },
        });

        try {
            // Step 1: Find adopters with stale/missing tokens
            const staleAdopters = await db.select({
                id: adopters.id,
                name: adopters.name,
                contactInfo: adopters.contactInfo,
                // Aliases and platform-tagged socials live in contactEntries;
                // without this column the batch scan silently tokenized every
                // record as if it had neither (the per-save tokenizeAdopter
                // path always read them).
                contactEntries: adopters.contactEntries,
                addressInfo: adopters.addressInfo,
                familyMembers: adopters.familyMembers,
                householdMembers: adopters.householdMembers,
                sourceUrl: adopters.sourceUrl,
                country: adopters.country,
                tokenHash: adopters.tokenHash,
            })
                .from(adopters)
                .where(isNull(adopters.deletedAt));

            let tokenized = 0;

            // Batch size for this call. Clamped so a bad query string can't
            // reinstate the unbounded behaviour this exists to prevent.
            const requestedLimit = Number(new URL(request.url).searchParams.get('limit'));
            const batchLimit = Number.isFinite(requestedLimit) && requestedLimit > 0
                ? Math.min(Math.floor(requestedLimit), SCAN_BATCH_MAX)
                : SCAN_BATCH_DEFAULT;

            // How many records are stale before this batch runs. Hashing is
            // pure and in-memory, so counting up front is free and lets the
            // caller show real progress instead of guessing.
            const staleIds: string[] = [];
            for (const a of staleAdopters) {
                if (a.tokenHash !== computeTokenHash(a)) staleIds.push(a.id);
            }
            const staleBefore = staleIds.length;
            const batchIds = new Set(staleIds.slice(0, batchLimit));
            const remaining = Math.max(0, staleBefore - batchIds.size);

            // Adoptions feed `onBehalfOf` tokens. Fetched ONCE for the whole
            // batch and grouped in memory rather than one query per record —
            // that alone was `batchLimit` subrequests, and the subrequest
            // ceiling is the binding constraint on this endpoint.
            //
            // Deliberately NOT filtered by adopter id: D1 does not expand array
            // parameters in `IN (...)` (see docs/D1_COMPATIBILITY.md), so a
            // filtered version would either be silently wrong or need the
            // per-record fan-out back. One unfiltered scan of a ~1.2k-row view
            // is cheaper and correct.
            const adoptionsByAdopter = new Map<string, { onBehalfOf: string | null }[]>();
            {
                const rows = await db.select({
                    adopterId: adoptions.adopterId,
                    onBehalfOf: adoptions.onBehalfOf,
                }).from(adoptions);
                for (const row of rows) {
                    if (!row.adopterId) continue;
                    const list = adoptionsByAdopter.get(row.adopterId);
                    if (list) list.push({ onBehalfOf: row.onBehalfOf });
                    else adoptionsByAdopter.set(row.adopterId, [{ onBehalfOf: row.onBehalfOf }]);
                }
            }

            // Step 2: Tokenize stale records (this batch only).
            //
            // Each record is delete-tokens + insert-tokens + update-hash. Sent
            // one by one that is ~3 sequential D1 round trips per record, and a
            // dropped call failed the batch after a record's tokens were already
            // replaced but before its hash was (2026-10-10, errorId 60d0dc35).
            // SCAN_WRITE_GROUP records go out as ONE D1 batch instead: one round
            // trip, atomic (a failed group writes nothing, so it is simply
            // retried once, then the page's own retry takes over).
            type Planned = { id: string; hash: string; tokens: ReturnType<typeof extractTokens> };
            const planned: Planned[] = [];
            for (const adopter of staleAdopters) {
                if (!batchIds.has(adopter.id)) continue;
                const newHash = computeTokenHash(adopter);
                if (adopter.tokenHash === newHash) continue; // Fresh, skip

                // Fetch adoptions for onBehalfOf
                const adopterAdoptions = adoptionsByAdopter.get(adopter.id) ?? [];

                // Typed entries only (titular + each household member) — the same
                // inputs save-time tokenizing uses (tokenInputsFor).
                const { entries, household } = tokenInputsFor(adopter);
                planned.push({ id: adopter.id, hash: newHash, tokens: extractTokens(adopter, adopterAdoptions, entries, household) });
            }

            let rawD1: D1Database | undefined;
            try {
                rawD1 = (getRequestContext().env as { DB?: D1Database })?.DB;
            } catch (e) {
                logger.warn('Duplicate scan: no request context, writing records one by one (local dev)', {
                    error: e instanceof Error ? e.message : String(e),
                });
            }

            for (let g = 0; g < planned.length; g += SCAN_WRITE_GROUP) {
                const group = planned.slice(g, g + SCAN_WRITE_GROUP);
                if (rawD1?.batch) {
                    const D1 = rawD1;
                    const statements = group.flatMap(rec => [
                        D1.prepare('DELETE FROM duplicate_tokens WHERE adopter_id = ?').bind(rec.id),
                        ...chunkList(rec.tokens, TOKEN_INSERT_CHUNK).map(part => D1.prepare(
                            `INSERT INTO duplicate_tokens (id, adopter_id, token_type, token_value) VALUES ${part.map(() => '(?, ?, ?, ?)').join(', ')}`,
                        ).bind(...part.flatMap(tk => [crypto.randomUUID(), rec.id, tk.type, tk.value]))),
                        D1.prepare('UPDATE adopters SET token_hash = ? WHERE id = ?').bind(rec.hash, rec.id),
                    ]);
                    await withOneRetry('Duplicate scan: write group', () => D1.batch(statements), {
                        group: g / SCAN_WRITE_GROUP, records: group.length, firstId: group[0]?.id,
                    });
                } else {
                    for (const rec of group) {
                        await db.delete(duplicateTokens).where(eq(duplicateTokens.adopterId, rec.id));
                        for (const part of chunkList(rec.tokens, TOKEN_INSERT_CHUNK)) {
                            await db.insert(duplicateTokens).values(part.map(token => ({
                                id: crypto.randomUUID(), adopterId: rec.id, tokenType: token.type, tokenValue: token.value,
                            })));
                        }
                        await db.update(adopters).set({ tokenHash: rec.hash }).where(eq(adopters.id, rec.id));
                    }
                }
                tokenized += group.length;
            }

            // More stale records left — stop here and let the caller call again.
            // Steps 3-5 below (GROUP BY over duplicate_tokens, pair scoring,
            // candidate insertion) are the expensive tail AND would operate on a
            // half-retokenized token set, producing candidates that get
            // recomputed on the next batch anyway. Deferring them to the final
            // batch keeps intermediate calls cheap and their results meaningful.
            //
            // The lock MUST be released before returning or the next batch gets
            // a 409 and the loop stalls at whatever progress it reached.
            if (remaining > 0) {
                await db.update(appConfig).set({ value: 'idle', updatedAt: new Date() })
                    .where(eq(appConfig.key, 'duplicate_scan_status'));

                logger.info('Duplicate scan batch complete', {
                    staleBefore, tokenized, remaining, user: session.user.email,
                });

                return NextResponse.json({
                    success: true,
                    done: false,
                    totalAdopters: staleAdopters.length,
                    staleBefore,
                    tokenized,
                    remaining,
                    newCandidates: 0,
                });
            }

            // A social handle or address word shared by many records pairs nobody
            // (a rescuer's contact pasted across imports; a place like "villa").
            // See pairsOnSharedToken (src/domain/duplicatePairing.ts).
            let skippedSharedHandles = 0;

            // Step 3: Find shared tokens (GROUP BY)
            const sharedTokens = await db.select({
                tokenType: duplicateTokens.tokenType,
                tokenValue: duplicateTokens.tokenValue,
                adopterIds: sql<string>`GROUP_CONCAT(DISTINCT ${duplicateTokens.adopterId})`,
                count: sql<number>`COUNT(DISTINCT ${duplicateTokens.adopterId})`,
            })
                .from(duplicateTokens)
                .groupBy(duplicateTokens.tokenType, duplicateTokens.tokenValue)
                .having(sql`COUNT(DISTINCT ${duplicateTokens.adopterId}) > 1`);

            // Step 4: Build pair → signals map
            const pairSignals = new Map<string, { types: Set<string>; values: Record<string, string[]>; }>();

            for (const row of sharedTokens) {
                if (!pairsOnSharedToken(row.tokenType, row.count)) {
                    skippedSharedHandles++;
                    continue;
                }
                const ids = row.adopterIds.split(',').sort();

                // Generate all pairs from the group
                for (let i = 0; i < ids.length; i++) {
                    for (let j = i + 1; j < ids.length; j++) {
                        const pairKey = `${ids[i]}|${ids[j]}`;

                        if (!pairSignals.has(pairKey)) {
                            pairSignals.set(pairKey, { types: new Set(), values: {} });
                        }

                        const signal = pairSignals.get(pairKey)!;
                        // Deduplicate phone and phone_suffix into single "phone" category
                        const category = row.tokenType === 'phone_suffix' ? 'phone' : row.tokenType === 'social_handle' ? 'social' : row.tokenType;
                        signal.types.add(category);

                        if (!signal.values[category]) signal.values[category] = [];
                        // Store the human-readable handle, not the internal
                        // `platform|handle` token, so the merge UI never shows "facebook|juan".
                        signal.values[category].push(
                            row.tokenType === 'social' ? row.tokenValue.slice(row.tokenValue.indexOf('|') + 1) : row.tokenValue,
                        );
                    }
                }
            }

            // Step 5: Score pairs

            let newCandidates = 0;

            // Get existing dismissed/merged pair keys to skip
            const existingPairs = await db.select({
                adopter1Id: duplicateCandidates.adopter1Id,
                adopter2Id: duplicateCandidates.adopter2Id,
                status: duplicateCandidates.status,
            }).from(duplicateCandidates)
                .where(or(
                    eq(duplicateCandidates.status, 'dismissed'),
                    eq(duplicateCandidates.status, 'merged')
                ));

            const dismissedKeys = new Set(existingPairs.map((p: typeof existingPairs[number]) => `${p.adopter1Id}|${p.adopter2Id}`));

            // Build the new candidate set under a staging status, then swap it in
            // at the end (see the swap below). Previously this deleted `pending`
            // up front and re-inserted over the following ~1,150 statements — so
            // a Worker killed anywhere in that window left the queue emptied and
            // not rebuilt. Existing `pending` rows are now untouched until the
            // new set is complete.
            //
            // `status` is free-form text with no CHECK constraint, so 'rebuilding'
            // needs no migration. Nothing reads it: the GET filters on
            // pending/dismissed/merged, so partial rows stay invisible.
            const REBUILDING = 'rebuilding';

            // Clear leftovers from a previous run that died mid-rebuild.
            await db.delete(duplicateCandidates).where(eq(duplicateCandidates.status, REBUILDING));

            /** Buffered candidate rows, flushed in chunks after scoring. */
            const candidateRows: (typeof duplicateCandidates.$inferInsert)[] = [];

            for (const [pairKey, signal] of pairSignals) {
                if (dismissedKeys.has(pairKey)) continue;

                // Weights and the address rule live in scorePair
                // (src/domain/duplicatePairing.ts).
                const score = scorePair(signal.values);
                const types = Array.from(signal.types);

                if (score < 10) continue; // Below threshold

                const confidence = confidenceOf(score);
                const [id1, id2] = pairKey.split('|');

                // Collected, not inserted one at a time — see the chunked write
                // below. Scoring above is pure, so this loop costs no D1 calls.
                candidateRows.push({
                    id: crypto.randomUUID(),
                    adopter1Id: id1,
                    adopter2Id: id2,
                    matchTypes: JSON.stringify(types),
                    matchValues: JSON.stringify(signal.values),
                    score,
                    confidence,
                    status: REBUILDING,
                    detectedAt: new Date(),
                });

                newCandidates++;
            }

            // Write candidates in chunks. This loop used to `await db.insert`
            // once per candidate: at production scale that is ~1,150 subrequests
            // in a single request, well past the Worker ceiling, and it killed
            // the final batch of every full scan.
            //
            // 8 columns per row against D1's 100-bound-parameter cap gives a
            // hard maximum of 12 rows; 10 leaves margin. ~1,150 candidates
            // becomes ~115 statements instead of ~1,150.
            //
            // This was invisible locally: miniflare does NOT enforce the
            // subrequest ceiling, so the unbounded version passed a full
            // 1,224-record run on this machine and died on staging.
            for (let i = 0; i < candidateRows.length; i += CANDIDATE_INSERT_CHUNK) {
                await db.insert(duplicateCandidates)
                    .values(candidateRows.slice(i, i + CANDIDATE_INSERT_CHUNK));
            }

            // Swap the rebuilt set in. Both statements go through D1's atomic
            // `batch()` so the queue is never momentarily empty — the same
            // pattern `api/admin/users` uses for multi-table deletes.
            //
            // Falls back to two sequential statements where the request context
            // isn't available (local dev). That leaves a one-statement window
            // rather than the ~1,150-statement one this replaces, and the
            // fallback path never runs on Cloudflare.
            let swapped = false;
            try {
                const { env } = getRequestContext();
                const D1 = (env as { DB?: D1Database })?.DB;
                if (D1?.batch) {
                    await D1.batch([
                        D1.prepare(`DELETE FROM duplicate_candidates WHERE status = 'pending'`),
                        D1.prepare(`UPDATE duplicate_candidates SET status = 'pending' WHERE status = ?`).bind(REBUILDING),
                    ]);
                    swapped = true;
                }
            } catch (e) {
                logger.warn('Duplicate scan: atomic swap unavailable, falling back', {
                    error: e instanceof Error ? e.message : String(e),
                });
            }
            if (!swapped) {
                await db.delete(duplicateCandidates).where(eq(duplicateCandidates.status, 'pending'));
                await db.update(duplicateCandidates)
                    .set({ status: 'pending' })
                    .where(eq(duplicateCandidates.status, REBUILDING));
            }

            // Release lock & store timestamp
            await db.update(appConfig).set({
                value: 'idle',
                updatedAt: new Date(),
            }).where(eq(appConfig.key, 'duplicate_scan_status'));

            await db.insert(appConfig).values({
                key: 'duplicate_scan_last_run',
                value: new Date().toISOString(),
                updatedAt: new Date(),
                updatedBy: session.user.email,
            }).onConflictDoUpdate({
                target: appConfig.key,
                set: { value: new Date().toISOString(), updatedAt: new Date(), updatedBy: session.user.email },
            });

            logger.info('Duplicate scan complete', {
                totalAdopters: staleAdopters.length,
                tokenized,
                sharedTokenGroups: sharedTokens.length,
                newCandidates,
                skippedSharedHandles, // high-count social handles excluded (shared/rescuer contacts)
                user: session.user.email,
            });

            return NextResponse.json({
                success: true,
                done: true,
                totalAdopters: staleAdopters.length,
                staleBefore,
                tokenized,
                remaining: 0,
                newCandidates,
            });
        } catch (scanError) {
            // Release lock on error
            await db.update(appConfig).set({ value: 'error' }).where(eq(appConfig.key, 'duplicate_scan_status'));
            throw scanError;
        }
    } catch (error) {
        // Return errorId + message like the GET above does. Returning a bare
        // "Scan failed" threw away the only handle on the actual fault: the
        // admin saw nothing actionable and the errorId existed only in Axiom,
        // so a mid-run failure could not be diagnosed from the UI at all.
        // Admin-only endpoint — surfacing the message is fine.
        const errorId = logger.error('Duplicate scan failed', error instanceof Error ? error : new Error(String(error)), {
            user: session.user.email,
        });
        return NextResponse.json({
            error: 'Scan failed',
            errorId,
            message: error instanceof Error ? error.message : String(error),
        }, { status: 500 });
    }
}
