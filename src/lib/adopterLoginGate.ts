/**
 * Adopter-login gate (v2.14.9-14).
 *
 * BuenAdoptante is a tool for rescuers / NGOs. We don't want adopters
 * (the people being rated) signing in and discovering the registry has
 * their data. When an OAuth login lands here, this gate checks whether
 * the email matches an adopter profile that meets any of the block
 * conditions; if so, the signIn callback rejects the session, the user
 * sees a generic "something went wrong" error page, and admins get a
 * notification + an audit row in `blocked_logins`.
 *
 * Block conditions (any of these triggers a block on the matched adopter):
 *   - avgRating < 4   (rated, but not high enough)
 *   - tooManyAdoptions flag set
 *   - tooManyRequests flag set
 *
 * Explicitly NOT blocked:
 *   - email doesn't match any adopter
 *   - email matches, avgRating is null (never rated) AND no density flags
 *   - email matches, avgRating >= 4 AND no density flags
 *
 * Match strategy: primarily via `duplicate_tokens` (normalized email tokens —
 * the existing duplicate-detection pipeline already maintains this for every
 * adopter). Falls back to LIKE-substring scan of `adopters.contactInfo` for
 * historical rows that pre-date the token index, or where the email lives
 * inside a free-text blob and didn't get tokenized cleanly.
 */

import { adopters, adoptions, duplicateTokens, adopterHistory } from '@/db/schema';
import { eq, and, like, isNull, desc } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { computeAvgRating } from '@/domain/ratings';
import { computeMaxDensityPeriod } from '@/lib/adoptionFilters';
import { getAdoptionConfig } from '@/app/actions/config';

export interface BlockMatch {
    adopterId: string;
    adopterName: string;
    avgRating: number | null;
    tooManyAdoptions: boolean;
    tooManyRequests: boolean;
    addedBy: string | null;
    /** Most-recent history.changedBy entries (last 2). */
    lastChangedBy: string[];
    /** Why this match triggered: list of triggers that fired. */
    triggers: string[];
}

export interface GateResult {
    blocked: boolean;
    matches: BlockMatch[];
    /** Composite reason summarizing why the attempt was blocked. */
    reason: string;
}

const PASS: GateResult = { blocked: false, matches: [], reason: '' };

/**
 * Run the block-detection logic for a given email.
 *
 * Returns `{ blocked: false }` on any error — the gate fails OPEN. That's
 * deliberate: a transient D1 hiccup shouldn't lock legitimate rescuers out
 * of their own tool. The downside is that during an outage an adopter could
 * theoretically slip through; we accept that vs. the cost of blocking
 * everyone when D1 is degraded.
 */
export async function checkAdopterLoginGate(rawEmail: string): Promise<GateResult> {
    if (!rawEmail) return PASS;
    const email = rawEmail.toLowerCase().trim();
    if (!email.includes('@')) return PASS;

    try {
        const db = await getDb();
        if (!db) return PASS;

        // 1. Primary match: tokenized email index. Same normalization the
        //    duplicate-detection pipeline uses (tokenize-adopter writes
        //    tokenType='email' rows with the lowercased value).
        const tokenRows = await db.select({ adopterId: duplicateTokens.adopterId })
            .from(duplicateTokens)
            .where(and(
                eq(duplicateTokens.tokenType, 'email'),
                eq(duplicateTokens.tokenValue, email),
            ));
        const adopterIdsFromTokens = new Set<string>(tokenRows.map((r: { adopterId: string }) => r.adopterId));

        // 2. Fallback: substring match in contactInfo for older rows that
        //    might not be in the token index. Cheaper than running the full
        //    findAdopters pipeline at login time. The token check above is
        //    O(1) on an indexed key; this is O(n) but n is small (~hundreds).
        const fallbackRows = await db.select({ id: adopters.id })
            .from(adopters)
            .where(and(
                isNull(adopters.deletedAt),
                like(adopters.contactInfo, `%${email}%`),
            ));
        const adopterIds = new Set<string>([...adopterIdsFromTokens]);
        for (const r of fallbackRows as { id: string }[]) adopterIds.add(r.id);

        if (adopterIds.size === 0) return PASS;

        // 3. For each matched adopter, compute the block conditions.
        const adoptionConfig = await getAdoptionConfig();
        const matches: BlockMatch[] = [];

        for (const adopterId of adopterIds) {
            // Adopter row (for name + addedBy)
            const adopterRow = await db.select({
                id: adopters.id,
                name: adopters.name,
                addedBy: adopters.addedBy,
            }).from(adopters).where(eq(adopters.id, adopterId)).get();
            if (!adopterRow) continue;

            // Adoptions for rating + density flags
            const adoptionRows = await db.select({
                rating: adoptions.rating,
                recordType: adoptions.recordType,
                date: adoptions.date,
            }).from(adoptions).where(eq(adoptions.adopterId, adopterId));

            const avgRating = computeAvgRating(adoptionRows as { rating: number | null }[]);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const adoptionsDensity = computeMaxDensityPeriod(adoptionRows as any, 'adoption', adoptionConfig.periodDays);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const requestsDensity = computeMaxDensityPeriod(adoptionRows as any, 'adoption_request', adoptionConfig.requestsPeriodDays);
            const tooManyAdoptions = adoptionsDensity.count >= adoptionConfig.threshold;
            const tooManyRequests = requestsDensity.count >= adoptionConfig.requestsThreshold;

            const triggers: string[] = [];
            if (avgRating !== null && avgRating < 4) triggers.push('low_rating');
            if (tooManyAdoptions) triggers.push('too_many_adoptions');
            if (tooManyRequests) triggers.push('too_many_requests');

            // Most recent 2 editors from history.
            const historyRows = await db.select({ changedBy: adopterHistory.changedBy })
                .from(adopterHistory)
                .where(eq(adopterHistory.adopterId, adopterId))
                .orderBy(desc(adopterHistory.changedAt))
                .limit(2)
                .catch(() => [] as { changedBy: string | null }[]);
            const lastChangedBy = (historyRows as { changedBy: string | null }[])
                .map((r) => r.changedBy)
                .filter((v): v is string => typeof v === 'string' && v.length > 0);

            matches.push({
                adopterId,
                adopterName: adopterRow.name || '',
                avgRating,
                tooManyAdoptions,
                tooManyRequests,
                addedBy: adopterRow.addedBy,
                lastChangedBy,
                triggers,
            });
        }

        // 4. Should ANY match block? If yes, return blocked=true with the
        //    full matches list so the caller (auth callback) can write the
        //    notification + audit row with full context.
        const blockingMatches = matches.filter(m => m.triggers.length > 0);
        if (blockingMatches.length === 0) return { blocked: false, matches, reason: '' };

        const allTriggers = new Set<string>();
        for (const m of blockingMatches) for (const t of m.triggers) allTriggers.add(t);
        const reason = Array.from(allTriggers).sort().join(',');

        return { blocked: true, matches, reason };
    } catch (e) {
        // Fail OPEN. See header note.
        logger.warn('adopterLoginGate: error during check, failing open', {
            email,
            error: e instanceof Error ? e.message : String(e),
        });
        return PASS;
    }
}

