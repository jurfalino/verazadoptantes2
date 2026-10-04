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
    return runFindAdopters(input, options);
}
