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

import { getDb, getUser } from './_db';
import { findAdopters } from './findAdopters';
import { hydrateDuplicateMatches } from './hydrateDuplicateMatches';
import { logger } from '@/lib/logger';
import type { DiscoveryMatch, DuplicateMatch } from './types';

interface FormDuplicateInput {
    name: string;
    phones?: string[];
    emails?: string[];
    socials?: string[];
    excludeAdopterId?: string;
}

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

        // 2. Re-hydrate matched IDs into card-ready enriched rows via the shared
        //    bridge. The form user is authed; no geo re-check (the form already
        //    scopes to what the rescuer is entering).
        const user = await getUser();
        const results = await hydrateDuplicateMatches(db, matches, {
            viewer: user,
            isUnauthenticated: false,
        });
        return { results };
    } catch (e) {
        logger.warn('findFormDuplicates failed — form falls back to no-suggestion', {
            error: e instanceof Error ? e.message : String(e),
        });
        return { results: [] };
    }
}
