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

        return NextResponse.json({
            userFlagged: userFlaggedEnriched,
            candidates: candidatesEnriched,
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
export async function POST(_request: Request) {
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
            return NextResponse.json({ error: 'Scan already in progress' }, { status: 409 });
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

            // Step 2: Tokenize stale records
            for (const adopter of staleAdopters) {
                const newHash = computeTokenHash(adopter);
                if (adopter.tokenHash === newHash) continue; // Fresh, skip

                // Fetch adoptions for onBehalfOf
                const adopterAdoptions = await db.select({ onBehalfOf: adoptions.onBehalfOf })
                    .from(adoptions).where(eq(adoptions.adopterId, adopter.id));

                // Aliases tokenize as name_words (see extractTokens docs); structured
                // socials carry `platform` so the tokenizer emits `social`=`platform|handle`.
                const entries = deserializeContactEntries(adopter.contactEntries);
                const aliases = entries.filter(e => e.type === 'alias').map(e => e.value);
                const socials = entries.filter(e => e.type === 'social').map(e => ({ value: e.value, platform: e.platform ?? null }));
                const household = deserializeHouseholdMembers(adopter.householdMembers).map(m => ({ name: m.name, contactEntries: m.contactEntries }));

                const tokens = extractTokens(adopter, adopterAdoptions, aliases, socials, household);

                // Replace tokens
                await db.delete(duplicateTokens).where(eq(duplicateTokens.adopterId, adopter.id));
                for (const token of tokens) {
                    await db.insert(duplicateTokens).values({
                        id: crypto.randomUUID(),
                        adopterId: adopter.id,
                        tokenType: token.type,
                        tokenValue: token.value,
                    });
                }

                await db.update(adopters).set({ tokenHash: newHash }).where(eq(adopters.id, adopter.id));
                tokenized++;
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

                await db.insert(duplicateCandidates).values({
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
                totalAdopters: staleAdopters.length,
                tokenized,
                newCandidates,
            });
        } catch (scanError) {
            // Release lock on error
            await db.update(appConfig).set({ value: 'error' }).where(eq(appConfig.key, 'duplicate_scan_status'));
            throw scanError;
        }
    } catch (error) {
        logger.error('Duplicate scan failed', error);
        return NextResponse.json({ error: 'Scan failed' }, { status: 500 });
    }
}
