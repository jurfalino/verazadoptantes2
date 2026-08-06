'use server';

/**
 * Lazy "weak tier" for the search box (v2.26.7) — the fuzzy/partial name matches
 * shown in the collapsed "Otras posibles coincidencias" section, loaded ONLY
 * when the user expands it.
 *
 * The eager search (`findAdopters` discovery, now incl. phone-token + accent
 * recall) is the STRONG tier and stays fast. This action runs the slower
 * duplicate engine (Levenshtein fuzzy + prefix-LIKE names) whose measured p95 is
 * ~3 s — acceptable because it's paid only on expand, not on every search. It
 * returns the name-fuzzy remainder: matches NOT already shown eagerly
 * (`excludeIds` = the strong-tier adopter ids), hydrated + masked via the shared
 * `hydrateDuplicateMatches` bridge.
 */

import { getDb, getUser } from './_db';
import { findAdopters } from './findAdopters';
import { hydrateDuplicateMatches } from './hydrateDuplicateMatches';
import { getUserCountry } from './userCountry';
import { logger } from '@/lib/logger';
import type { DiscoveryMatch, DuplicateMatch } from './types';

const WEAK_LIMIT = 20;

export async function findWeakNameMatches(
    rawQuery: string,
    excludeIds: string[] = [],
): Promise<{ results: DiscoveryMatch[] }> {
    const name = (rawQuery || '').trim();
    if (name.length < 2) return { results: [] };

    try {
        const db = await getDb();
        if (!db) return { results: [] };

        // Duplicate engine self-extracts phones/emails from the raw name blob.
        const dup = await findAdopters(
            { name },
            { mode: 'duplicate', minRelevance: 15, limit: WEAK_LIMIT + excludeIds.length },
        );
        const exclude = new Set(excludeIds);
        const matches = (dup.results as DuplicateMatch[])
            .filter(m => !exclude.has(m.adopterId))
            .slice(0, WEAK_LIMIT);
        if (matches.length === 0) return { results: [] };

        const user = await getUser().catch(() => 'unknown');
        const isUnauthenticated = user === 'unknown';
        const userCountry = await getUserCountry(user);

        const results = await hydrateDuplicateMatches(db, matches, {
            viewer: user,
            isUnauthenticated,
            userCountry,
        });
        return { results };
    } catch (e) {
        logger.warn('findWeakNameMatches failed — weak tier degrades to empty', {
            error: e instanceof Error ? e.message : String(e),
        });
        return { results: [] };
    }
}
