export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { adopters, adoptions, duplicateTokens, duplicateCandidates, adopterFlags, appConfig } from '@/db/schema';
import { eq, sql, isNull, or } from 'drizzle-orm';
import { auth } from '@/auth';
import { isAdminAsync } from '@/config/admins';
import { logger } from '@/lib/logger';
import { extractTokens, computeTokenHash } from '@/lib/tokenizer';
import { deserializeContactEntries } from '@/lib/contactEntries';
import { deserializeHouseholdMembers } from '@/lib/householdMembers';
import { computeAvgRating } from '@/domain/ratings';

/**
 * Compute the average activity rating for an adopter. Cheap D1-safe lookup —
 * one query per id. Returns null when the adopter has no rated records yet
 * (matches the rest of the app's "no activity = no rating" convention).
 * The legacy `adopter.status` column is deprecated; only avgRating is real.
 */
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
        const page = parseInt(searchParams.get('page') || '1');
        const limit = 20;
        const offset = (page - 1) * limit;

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

        // Enrich user-flagged with adopter names + computed avgRating.
        const userFlaggedEnriched = await Promise.all(
            userFlagged.map(async (flag: typeof userFlagged[number]) => {
                const [adopter1, adopter2, avg1, avg2] = await Promise.all([
                    db.select({ name: adopters.name, contactInfo: adopters.contactInfo })
                        .from(adopters).where(eq(adopters.id, flag.adopterId)).get().catch(() => undefined),
                    flag.targetAdopterId
                        ? db.select({ name: adopters.name, contactInfo: adopters.contactInfo })
                            .from(adopters).where(eq(adopters.id, flag.targetAdopterId)).get().catch(() => undefined)
                        : null,
                    avgRatingFor(db, flag.adopterId).catch(() => null),
                    avgRatingFor(db, flag.targetAdopterId).catch(() => null),
                ]);
                return {
                    ...flag,
                    source: 'user' as const,
                    adopter1Name: adopter1?.name || 'Unknown',
                    adopter1Contact: adopter1?.contactInfo,
                    adopter1AvgRating: avg1,
                    adopter2Name: adopter2?.name || null,
                    adopter2Contact: adopter2?.contactInfo,
                    adopter2AvgRating: avg2,
                };
            })
        );

        // 2. System-detected candidates
        const candidates = await db.select()
            .from(duplicateCandidates)
            .where(eq(duplicateCandidates.status, status))
            .orderBy(sql`${duplicateCandidates.score} DESC`)
            .limit(limit)
            .offset(offset);

        // Enrich with adopter data + computed avgRating.
        const candidatesEnriched = await Promise.all(
            candidates.map(async (c: typeof candidates[number]) => {
                const [adopter1, adopter2, avg1, avg2] = await Promise.all([
                    db.select({ name: adopters.name, contactInfo: adopters.contactInfo })
                        .from(adopters).where(eq(adopters.id, c.adopter1Id)).get().catch(() => undefined),
                    db.select({ name: adopters.name, contactInfo: adopters.contactInfo })
                        .from(adopters).where(eq(adopters.id, c.adopter2Id)).get().catch(() => undefined),
                    avgRatingFor(db, c.adopter1Id).catch(() => null),
                    avgRatingFor(db, c.adopter2Id).catch(() => null),
                ]);
                return {
                    ...c,
                    source: 'system' as const,
                    adopter1Name: adopter1?.name || 'Deleted',
                    adopter1Contact: adopter1?.contactInfo,
                    adopter1AvgRating: avg1,
                    adopter2Name: adopter2?.name || 'Deleted',
                    adopter2Contact: adopter2?.contactInfo,
                    adopter2AvgRating: avg2,
                };
            })
        );

        // Counts
        const [pendingCount, dismissedCount, mergedCount] = await Promise.all([
            db.select({ count: sql<number>`COUNT(*)` }).from(duplicateCandidates).where(eq(duplicateCandidates.status, 'pending')),
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

        return NextResponse.json({
            userFlagged: userFlaggedEnriched,
            candidates: candidatesEnriched,
            staleCount,
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
 * Cost per record is now FIXED at 3 D1 calls (delete + one multi-row token
 * insert + hash update). That fixed-ness is the point: it used to be
 * `2 + tokenCount`, and with a real-world max of 26 tokens on one record, a
 * batch sized off the 6.1 average could quietly cost 3x its estimate. v2.49.3
 * shipped a batch of 100 on that average and was hard-killed on the first click
 * against production-scale data — no catch block runs on a subrequest kill, so
 * it also left the scan lock wedged at `running` (see SCAN_LOCK_STALE_MS).
 *
 * 50 × 3 = 150, plus a handful of surrounding queries. Deliberately ~6x under
 * the ceiling rather than shaving it: the loop is automatic, so more batches
 * costs a few seconds, while one over-large batch costs a failed run. Callers
 * that want fewer round trips can pass `?limit=` up to SCAN_BATCH_MAX.
 */
const SCAN_BATCH_DEFAULT = 50;
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

/**
 * Rows per multi-row candidate insert. `duplicate_candidates` binds 8 columns,
 * so D1's 100-parameter cap allows 12 rows; 10 leaves margin.
 */
const CANDIDATE_INSERT_CHUNK = 10;

/**
 * A `running` lock older than this is treated as abandoned and reclaimed.
 *
 * Load-bearing: when a Worker is hard-killed (subrequest ceiling, CPU limit)
 * the `catch` below never runs, so the lock stays `running` forever and every
 * subsequent scan 409s. That happened on staging 2026-09-02 and needed a manual
 * UPDATE to recover — unacceptable for a production runbook step.
 *
 * Generous relative to a batch (seconds), so it cannot reclaim a live scan.
 */
const SCAN_LOCK_STALE_MS = 5 * 60 * 1000;

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
            // Worker leaves this set with no catch block to clear it.
            const lockAgeMs = lockRow.updatedAt ? Date.now() - new Date(lockRow.updatedAt).getTime() : Infinity;
            if (lockAgeMs < SCAN_LOCK_STALE_MS) {
                return NextResponse.json({
                    error: 'Scan already in progress',
                    retryInMs: SCAN_LOCK_STALE_MS - lockAgeMs,
                }, { status: 409 });
            }
            logger.warn('Duplicate scan: reclaiming stale lock', {
                lockAgeMs, staleAfterMs: SCAN_LOCK_STALE_MS, user: session.user.email,
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
                addressInfo: adopters.addressInfo,
                familyMembers: adopters.familyMembers,
                householdMembers: adopters.householdMembers,
                sourceUrl: adopters.sourceUrl,
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

            // Step 2: Tokenize stale records (this batch only)
            for (const adopter of staleAdopters) {
                if (!batchIds.has(adopter.id)) continue;
                const newHash = computeTokenHash(adopter);
                if (adopter.tokenHash === newHash) continue; // Fresh, skip

                // Fetch adoptions for onBehalfOf
                const adopterAdoptions = adoptionsByAdopter.get(adopter.id) ?? [];

                // Aliases tokenize as name_words (see extractTokens docs); structured
                // socials carry `platform` so the tokenizer emits `social`=`platform|handle`.
                const entries = deserializeContactEntries(adopter.contactEntries);
                const aliases = entries.filter(e => e.type === 'alias').map(e => e.value);
                const socials = entries.filter(e => e.type === 'social').map(e => ({ value: e.value, platform: e.platform ?? null }));
                const household = deserializeHouseholdMembers(adopter.householdMembers).map(m => ({ name: m.name, contactEntries: m.contactEntries }));

                const tokens = extractTokens(adopter, adopterAdoptions, aliases, socials, household);

                // Replace tokens. ONE multi-row insert, not one per token: at ~6
                // tokens per record that is the difference between ~8 and ~3 D1
                // calls per record, and the subrequest ceiling is what kills this
                // endpoint at scale.
                await db.delete(duplicateTokens).where(eq(duplicateTokens.adopterId, adopter.id));
                for (let i = 0; i < tokens.length; i += TOKEN_INSERT_CHUNK) {
                    await db.insert(duplicateTokens).values(
                        tokens.slice(i, i + TOKEN_INSERT_CHUNK).map(token => ({
                            id: crypto.randomUUID(),
                            adopterId: adopter.id,
                            tokenType: token.type,
                            tokenValue: token.value,
                        })),
                    );
                }

                await db.update(adopters).set({ tokenHash: newHash }).where(eq(adopters.id, adopter.id));
                tokenized++;
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

            // A social handle shared by more than this many adopters is almost
            // certainly a shared/rescuer contact mis-entered across records (not a
            // real duplicate). Skip pair generation for it — otherwise one handle on
            // N records spawns C(N,2) false candidates. See dedup spec §4 (#3-revised).
            const SHARED_SOCIAL_HANDLE_CAP = 8;
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
                // Rescuer/shared social handle on many records → skip (spec §4).
                if ((row.tokenType === 'social' || row.tokenType === 'social_handle') && row.count > SHARED_SOCIAL_HANDLE_CAP) {
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
            const SCORE_MAP: Record<string, number> = {
                source_url: 100,
                phone: 50,
                email: 50,
                social: 40,
                name_full: 30,
                address_word: 25,  // only if 2+ words shared
                name_word: 20,     // only if 2+ words shared
            };

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

            // Delete existing pending candidates (will be re-computed)
            await db.delete(duplicateCandidates).where(eq(duplicateCandidates.status, 'pending'));

            /** Buffered candidate rows, flushed in chunks after scoring. */
            const candidateRows: (typeof duplicateCandidates.$inferInsert)[] = [];

            for (const [pairKey, signal] of pairSignals) {
                if (dismissedKeys.has(pairKey)) continue;

                let score = 0;
                const types = Array.from(signal.types);

                for (const type of types) {
                    const count = signal.values[type]?.length || 0;
                    if (type === 'name_word') {
                        score += count >= 2 ? SCORE_MAP.name_word : 5; // 1 word = 5pts
                    } else if (type === 'address_word') {
                        if (count >= 2) score += SCORE_MAP.address_word;
                        // 1 address word = 0pts (too noisy)
                    } else {
                        score += SCORE_MAP[type] || 0;
                    }
                }

                if (score < 10) continue; // Below threshold

                const confidence = score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';
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
