'use server';

/**
 * The browser's door to the search engine (src/app/actions/findAdopters.ts,
 * a plain server module). Discovery mode is unchanged: the engine resolves the
 * session itself and masks for anonymous viewers. 'duplicate' mode — raw names
 * and match values, no masking, no geo gate — is only for signed-in rescuers
 * (DuplicateHint, the import wizards); an anonymous caller gets no results.
 * Server code that runs without a session (the public form / contract submit
 * via _adopterFactory) imports the engine directly.
 */

import { findAdopters as runFindAdopters } from './findAdopters';
import { getUser } from './_db';
import { logger } from '@/lib/logger';
import { SEARCH_RESULT_LIMIT } from '@/config/constants';
import type { FindAdoptersInput, FindAdoptersOptions, FindAdoptersResponse } from './types';

export async function findAdopters(
    input: FindAdoptersInput,
    options: FindAdoptersOptions,
): Promise<FindAdoptersResponse> {
    if (options?.mode === 'duplicate') {
        try { await getUser(); } catch {
            logger.warn('findAdopters: duplicate mode refused — no session');
            return { results: [] };
        }
    }
    return runFindAdopters(input, capLimit(options));
}

/**
 * The browser picks `limit`; the engine would honour any number. Clamp it to
 * the app's search limit (both modes): an absent / invalid value falls back
 * to the engine's own default, anything else lands in [1, SEARCH_RESULT_LIMIT].
 */
function capLimit(options: FindAdoptersOptions): FindAdoptersOptions {
    if (!options || options.limit === undefined) return options;
    const n = Math.floor(Number(options.limit));
    if (!Number.isFinite(n)) {
        const { limit: _drop, ...rest } = options;
        void _drop;
        return rest;
    }
    return { ...options, limit: Math.min(Math.max(n, 1), SEARCH_RESULT_LIMIT) };
}
