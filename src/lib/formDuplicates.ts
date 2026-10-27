/**
 * The «Nuevo adoptante» duplicate check (findFormDuplicates' body), callable
 * by server code with options the browser must not set. NOT a 'use server'
 * module. See src/app/actions/findFormDuplicates.ts for the why: the
 * purpose-built `mode: 'duplicate'` engine (fuzzy + phone-suffix, structured
 * input), re-hydrated into the masked DiscoveryMatch cards via
 * hydrateDuplicateMatches.
 */
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { findAdopters } from '@/app/actions/findAdopters';
import { hydrateDuplicateMatches } from '@/app/actions/hydrateDuplicateMatches';
import type { DiscoveryMatch, DuplicateMatch } from '@/app/actions/types';

export interface FormDuplicateInput {
    name: string;
    phones?: string[];
    emails?: string[];
    socials?: string[];
    excludeAdopterId?: string;
}

/**
 * `allowContactOnly`: look with a contact and no name (the household add
 * form). Server-only; the public action never passes it. `viewer` resolves the
 * session lazily (after detection, as the form always did). Never throws: a
 * failure is logged and means no suggestions.
 */
export async function searchFormDuplicates(
    input: FormDuplicateInput,
    opts: { minRelevance?: number; limit?: number; allowContactOnly?: boolean },
    viewer: () => Promise<string>,
): Promise<{ results: DiscoveryMatch[] }> {
    const name = (input?.name || '').trim();
    const hasContact = [input?.phones, input?.emails, input?.socials].some(list => (list ?? []).some(v => typeof v === 'string' && v.trim()));
    if (name.length < 2 && !(opts.allowContactOnly === true && hasContact)) return { results: [] };

    try {
        const db = await getDb();
        if (!db) return { results: [] };

        // 1. Detection via the proven duplicate engine (fuzzy + phone-suffix).
        const dup = await findAdopters(
            {
                name: name.length < 2 ? '' : name,
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
        const user = await viewer();
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
