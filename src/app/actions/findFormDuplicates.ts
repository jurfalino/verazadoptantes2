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

import { getUser } from './_db';
import { searchFormDuplicates, type FormDuplicateInput } from '@/lib/formDuplicates';
import type { DiscoveryMatch } from './types';

/**
 * Browser-callable. Takes only the name-gated search: the contact-only option
 * (households) lives in src/lib/formDuplicates.ts and is never read from here.
 */
export async function findFormDuplicates(
    input: FormDuplicateInput,
    opts: { minRelevance?: number; limit?: number } = {},
): Promise<{ results: DiscoveryMatch[] }> {
    return searchFormDuplicates(capFormInput(input), { minRelevance: opts?.minRelevance, limit: capFormLimit(opts?.limit) }, getUser);
}

/** The most values of each contact kind one call may look up (and reveal on a match), as households cap theirs. */
const FORM_MAX_CONTACTS = 20;

/** The browser's contact lists, each cut to FORM_MAX_CONTACTS strings: no guessing many values in one call. */
function capFormInput(input: FormDuplicateInput): FormDuplicateInput {
    const cap = (list: unknown) => Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string').slice(0, FORM_MAX_CONTACTS) : undefined;
    return { ...input, phones: cap(input?.phones), emails: cap(input?.emails), socials: cap(input?.socials), documentIds: cap(input?.documentIds) };
}

/** The most suggestions the form asks for: each is a detail read and a card hydration. */
const MAX_FORM_LIMIT = 10;

/** The browser picks `limit`: clamp it to [1, MAX_FORM_LIMIT]; an absent / non-finite value → the default. Not exported ('use server'). */
function capFormLimit(limit: unknown): number | undefined {
    const n = Math.floor(Number(limit));
    if (limit === undefined || limit === null || !Number.isFinite(n)) return undefined;
    return Math.min(Math.max(n, 1), MAX_FORM_LIMIT);
}
