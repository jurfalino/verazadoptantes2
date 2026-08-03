'use server';

/**
 * Duplicate detection for the create-adopter FORM (AdopterForm live suggestion
 * + save-time gate).
 *
 * Why this exists — the form used to call `findAdopters({ raw }, { mode:
 * 'discovery' })`, i.e. the general LIKE search, which:
 *   • has NO Levenshtein fuzzy → "jonathan" never matched "jonatan", and
 *   • has NO phone-suffix normalization → "1165851333" never matched
 *     "+5491165851333",
 * and was fed a `name + contactInfo` blob whose phone was frequently missing
 * (the phone lives in structured `contactEntries` on the form, not the blob).
 * Net effect: real duplicates were missed while unrelated same-first-name
 * profiles surfaced.
 *
 * This routes detection through the purpose-built `mode: 'duplicate'` engine
 * (fuzzy + phone-suffix, structured input), then re-hydrates the matched IDs
 * into the enriched `DiscoveryMatch[]` shape the dedup UI (DuplicatePeek /
 * StrongMatchStrip / save modal) renders — reusing the SAME enrichment +
 * PII-masking tail as discovery via `enrichAdopters` + `assembleDiscoveryMatch`.
 * Scoring (`weights`, `PERSIST_THRESHOLD`, `normalizeConfidence`) is untouched.
 */

import { adopters } from '@/db/schema';
import { eq, isNull, and } from 'drizzle-orm';
import { getDb, getUser } from './_db';
import { findAdopters } from './findAdopters';
import { enrichAdopters } from './enrichAdopters';
import { assembleDiscoveryMatch } from '@/lib/discoveryMatch';
import { isPiiGatingEnabled, isPublicProfilesEnabled, resolveAdoptersVisibility, maskOptionsFor } from '@/lib/piiAccessServer';
import { logger } from '@/lib/logger';
import type { DiscoveryMatch, DuplicateMatch } from './types';

interface FormDuplicateInput {
    name: string;
    phones?: string[];
    emails?: string[];
    socials?: string[];
    excludeAdopterId?: string;
}

const DEFAULT_STATS = { searchHits: 0, profileViews: 0, requests: 0, adoptions: 0 };
const DEFAULT_FLAGS = {
    inaccurate: false, duplicate: false, systemDuplicate: false,
    verified_identity: false, verified_address: false,
    tooManyAdoptions: null, tooManyRequests: null,
};

export async function findFormDuplicates(
    input: FormDuplicateInput,
    opts: { minRelevance?: number; limit?: number } = {},
): Promise<{ results: DiscoveryMatch[] }> {
    const name = (input.name || '').trim();
    if (name.length < 2) return { results: [] };

    try {
        const db = await getDb();
        if (!db) return { results: [] };

        // 1. Detection via the proven duplicate engine (fuzzy + phone-suffix).
        const dup = await findAdopters(
            {
                name,
                phones: input.phones ?? [],
                emails: input.emails ?? [],
                socials: input.socials ?? [],
                excludeAdopterId: input.excludeAdopterId,
            },
            { mode: 'duplicate', minRelevance: opts.minRelevance ?? 15, limit: opts.limit ?? 5 },
        );
        const matches = dup.results as DuplicateMatch[];
        if (matches.length === 0) return { results: [] };

        // 2. Re-hydrate matched IDs into card-ready enriched rows.
        const ids = matches.map(m => m.adopterId);
        const rows = (await Promise.all(ids.map(id =>
            db.select().from(adopters)
                .where(and(eq(adopters.id, id), isNull(adopters.deletedAt)))
                .get()
                .catch((e: unknown) => {
                    logger.warn('findFormDuplicates: adopter row lookup fallback', {
                        adopterId: id, error: e instanceof Error ? e.message : String(e),
                    });
                    return null;
                }),
        ))).filter((r): r is typeof adopters.$inferSelect => !!r);
        if (rows.length === 0) return { results: [] };

        const enrichmentMap = await enrichAdopters(db, rows.map(r => r.id));

        // 3. Same PII-masking tail discovery uses. The form user is authed;
        //    resolve their per-row visibility so an unrelated existing record's
        //    contact isn't over-exposed in the peek.
        const user = await getUser();
        const piiGatingOn = await isPiiGatingEnabled();
        const visibilityMap = piiGatingOn
            ? await resolveAdoptersVisibility(user, rows.map(r => ({ id: r.id, addedBy: r.addedBy })))
            : null;
        const publicProfilesFlag = piiGatingOn && await isPublicProfilesEnabled();

        const byId = new Map(rows.map(r => [r.id, r]));
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
                matchValues: m.matchValues, // the fuzzy/phone chips from duplicate mode
                source: m.source,
                matchSnippet: null,
            };
            const vis = visibilityMap?.get(row.id);
            const maskOpts = maskOptionsFor(publicProfilesFlag, row);
            results.push(assembleDiscoveryMatch({ ...row }, enrichmentVals, meta, vis, undefined, maskOpts));
        }

        results.sort((a, b) => b.relevancePercent - a.relevancePercent);
        return { results };
    } catch (e) {
        logger.warn('findFormDuplicates failed — form falls back to no-suggestion', {
            error: e instanceof Error ? e.message : String(e),
        });
        return { results: [] };
    }
}
