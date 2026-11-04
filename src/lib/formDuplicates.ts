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
import { redactedErrorFields } from '@/lib/redactedError';
import { findPersonMatches } from '@/lib/identityMatch';
import { hydrateDuplicateMatches } from '@/app/actions/hydrateDuplicateMatches';
import type { DiscoveryMatch } from '@/app/actions/types';

export interface FormDuplicateInput {
    name: string;
    phones?: string[];
    emails?: string[];
    socials?: string[];
    documentIds?: string[];
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
): Promise<{ results: DiscoveryMatch[]; failed?: true }> {
    const name = (input?.name || '').trim();
    // A DNI is a contact here too: «Agregar conviviente» with only a DNI searches.
    const hasContact = [input?.phones, input?.emails, input?.socials, input?.documentIds].some(list => (list ?? []).some(v => typeof v === 'string' && v.trim()));
    if (name.length < 2 && !(opts.allowContactOnly === true && hasContact)) return { results: [] };

    // Outside the try: the failure log carries who asked (never the names or contacts).
    let user = '';
    try {
        const db = await getDb();
        if (!db) return { results: [], failed: true };

        // 1. The shared identity verdict (same first, then possible). Name length
        //    only decides whether to search at all: a nameless input with a contact is «possible».
        //    `minRelevance` stays accepted for callers; the verdict decides, not a percentage.
        user = await viewer();
        const matches = await findPersonMatches(
            db,
            {
                name: name.length < 2 ? '' : name,
                phones: input.phones, emails: input.emails, socials: input.socials, documentIds: input.documentIds,
            },
            { actor: user, excludeAdopterId: input.excludeAdopterId, limit: opts.limit ?? 5, ctx: { op: 'searchFormDuplicates' } },
        );
        if (matches.length === 0) return { results: [] };

        // 2. Re-hydrate matched IDs into card-ready enriched rows via the shared
        //    bridge. The form user is authed; no geo re-check (the form already
        //    scopes to what the rescuer is entering).
        const hydrated = await hydrateDuplicateMatches(db, matches, {
            viewer: user,
            isUnauthenticated: false,
            // What the rescuer typed shows in full where a match carries it.
            revealValues: [...(input.phones ?? []), ...(input.emails ?? []), ...(input.socials ?? []), ...(input.documentIds ?? [])],
        });
        const verdictOf = new Map(matches.map(m => [m.adopterId, m.verdict]));
        // hydrate re-sorts by relevance; same-person first is the contract (stable: relevance order within each group).
        const results = hydrated
            .map(r => ({ ...r, verdict: verdictOf.get(r.adopterId) }))
            .sort((a, b) => Number(b.verdict === 'same') - Number(a.verdict === 'same'));
        return { results };
    } catch (e) {
        // Redacted: a failed lookup's message ends with the phone / email / DNI it was bound to.
        const count = (list?: string[]) => (list ?? []).length;
        logger.warn('findFormDuplicates failed — form falls back to no-suggestion', {
            actor: user || null, excludesProfile: !!input?.excludeAdopterId,
            phones: count(input?.phones), emails: count(input?.emails), socials: count(input?.socials), documentIds: count(input?.documentIds),
            ...redactedErrorFields(e),
        });
        // `failed`: a caller that must not treat "no suggestions" as "nobody like this" can tell.
        return { results: [], failed: true };
    }
}
