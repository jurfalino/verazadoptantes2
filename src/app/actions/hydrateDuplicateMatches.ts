'use server';

/**
 * Shared bridge: turn lightweight `DuplicateMatch[]` (from the duplicate engine)
 * into enriched, PII-masked `DiscoveryMatch[]` the result-card UI renders — the
 * same enrichment + masking tail discovery uses (`enrichAdopters` +
 * `resolveAdoptersVisibility` + `maskOptionsFor` + `assembleDiscoveryMatch`).
 *
 * Extracted from findFormDuplicates (v2.26.5) so both the create-form dedup peek
 * AND the search box's lazy weak tier (findWeakNameMatches, v2.26.7) reuse ONE
 * masking implementation. Two capabilities the form-only original lacked:
 *   - `isUnauthenticated`: force NO_ACCESS_VISIBILITY so a logged-out searcher
 *     never sees unmasked PII (the form tail was auth-only).
 *   - `userCountry`: optional geo re-check — drop a hydrated row in a different
 *     country unless the viewer owns it (mirrors discovery's geo gate, so the
 *     duplicate leg can't surface a cross-country record the search would hide).
 */

import { adopters } from '@/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { enrichAdopters } from './enrichAdopters';
import { assembleDiscoveryMatch } from '@/lib/discoveryMatch';
import { NO_ACCESS_VISIBILITY } from '@/lib/piiAccess';
import { isPiiGatingEnabled, isPublicProfilesEnabled, resolveAdoptersVisibility, maskOptionsFor } from '@/lib/piiAccessServer';
import { logger } from '@/lib/logger';
import type { DiscoveryMatch, DuplicateMatch } from './types';

const DEFAULT_STATS = { searchHits: 0, profileViews: 0, requests: 0, adoptions: 0 };
const DEFAULT_FLAGS = {
    inaccurate: false, duplicate: false, systemDuplicate: false,
    verified_identity: false, verified_address: false,
    tooManyAdoptions: null, tooManyRequests: null,
};

interface HydrateOpts {
    /** The viewer's email ('unknown' for unauthenticated). */
    viewer: string;
    /** When true, every row is masked (NO_ACCESS_VISIBILITY); no grant resolution. */
    isUnauthenticated: boolean;
    /** When set, drop rows in a different country unless the viewer owns them. */
    userCountry?: string | null;
}

export async function hydrateDuplicateMatches(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any,
    matches: DuplicateMatch[],
    opts: HydrateOpts,
): Promise<DiscoveryMatch[]> {
    if (matches.length === 0) return [];

    const ids = matches.map(m => m.adopterId);
    const rows = (await Promise.all(ids.map(id =>
        db.select().from(adopters)
            .where(and(eq(adopters.id, id), isNull(adopters.deletedAt)))
            .get()
            .catch((e: unknown) => {
                logger.warn('hydrateDuplicateMatches: adopter row lookup fallback', {
                    adopterId: id, error: e instanceof Error ? e.message : String(e),
                });
                return null;
            }),
    ))).filter((r): r is typeof adopters.$inferSelect => !!r);

    // Geo re-check — duplicate mode has no geo gate, so a cross-country record
    // could surface here that the pure search would hide. Owned records bypass.
    const scoped = opts.userCountry
        ? rows.filter(r => r.country === opts.userCountry || r.addedBy === opts.viewer)
        : rows;
    if (scoped.length === 0) return [];

    const enrichmentMap = await enrichAdopters(db, scoped.map(r => r.id));

    // Auth viewers get per-row visibility; unauth is always fully masked.
    const piiGatingOn = !opts.isUnauthenticated && await isPiiGatingEnabled();
    const visibilityMap = piiGatingOn
        ? await resolveAdoptersVisibility(opts.viewer, scoped.map(r => ({ id: r.id, addedBy: r.addedBy })))
        : null;
    const publicProfilesFlag = piiGatingOn && await isPublicProfilesEnabled();

    const byId = new Map(scoped.map(r => [r.id, r]));
    const results: DiscoveryMatch[] = [];
    for (const m of matches) {
        const row = byId.get(m.adopterId);
        if (!row) continue;
        const enrichment = enrichmentMap.get(row.id);
        const enrichmentVals = {
            avgRating: enrichment?.avgRating ?? null,
            thumbnail: enrichment?.thumbnail ?? null,
            stats: enrichment?.stats ?? DEFAULT_STATS,
            flags: enrichment?.flags ?? DEFAULT_FLAGS,
        };
        const meta = {
            relevancePercent: m.relevancePercent,
            matchTypes: m.matchTypes,
            matchValues: m.matchValues,
            source: m.source,
            matchSnippet: null,
        };
        const vis = opts.isUnauthenticated ? NO_ACCESS_VISIBILITY : visibilityMap?.get(row.id);
        const maskOpts = maskOptionsFor(publicProfilesFlag, row);
        results.push(assembleDiscoveryMatch({ ...row }, enrichmentVals, meta, vis, undefined, maskOpts));
    }

    results.sort((a, b) => b.relevancePercent - a.relevancePercent);
    return results;
}
