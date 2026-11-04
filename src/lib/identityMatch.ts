/**
 * One verdict call for every surface (form, Pendientes, search, sheet import):
 * who already in the database is the same person (`same`) or may be (`possible`)
 * as this input. Maps a surface's person to the pure verdict's facts, resolves the
 * country phones are read with, retrieves + judges, drops everything that is not
 * same/possible, and returns the surfaces' common match shape plus the verdict.
 *
 * Throws on retrieval failure: each caller owns its fallback and its log (never
 * a silent `[]`). Never logs names or contacts — ids and counts only.
 */
import { cachedOwnerCountry } from '@/lib/actorCountry';
import { judgeCandidates, redactedErrorFields } from '@/lib/identityCandidates';
import { logger } from '@/lib/logger';
import type { getDb } from '@/lib/db';
import type { PersonFacts, VerdictReason } from '@/domain/identityVerdict';
import type { DuplicateMatch } from '@/app/actions/types';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

const DEFAULT_LIMIT = 5;

export interface PersonInput {
    name?: string;
    aliases?: string[];
    phones?: string[];
    emails?: string[];
    /** Passed through as given: a value with spaces ("Lau Benítez Rescate") is not an account and is never converted. */
    socials?: string[];
    documentIds?: string[];
}
export type IdentityMatch = DuplicateMatch & { verdict: 'same' | 'possible'; reason: VerdictReason | null };

const list = (v: string[] | undefined): string[] => (v ?? []).map(s => (typeof s === 'string' ? s.trim() : '')).filter(Boolean);

export async function findPersonMatches(
    db: Db,
    input: PersonInput,
    opts: { actor?: string | null; country?: string | null; excludeAdopterId?: string; limit?: number; skipLikeFallback?: boolean; ctx?: Record<string, unknown> } = {},
): Promise<IdentityMatch[]> {
    const ctx = opts.ctx ?? {};
    const facts: PersonFacts = {
        name: (input.name ?? '').trim(),
        aliases: list(input.aliases),
        phones: list(input.phones),
        emails: list(input.emails),
        socials: list(input.socials),
        documentIds: list(input.documentIds),
        country: null,
    };
    if (opts.country !== undefined) {
        facts.country = opts.country;
    } else if (opts.actor && facts.phones.length > 0) {
        // Read once per actor for ten minutes (not once per call).
        try {
            facts.country = await cachedOwnerCountry(db, opts.actor, `match-${crypto.randomUUID().slice(0, 8)}`);
        } catch (e) {
            logger.warn('findPersonMatches: country lookup failed, phones read without country', { ...ctx, actor: opts.actor, ...redactedErrorFields(e) });
        }
    }

    const limit = opts.limit ?? DEFAULT_LIMIT;
    const exclude = opts.excludeAdopterId;
    // The excluded profile is dropped inside the retrieval (engine and name counts), so it costs no slot.
    const judged = await judgeCandidates(db, facts, ctx, { limit, excludeAdopterId: exclude, skipLikeFallback: opts.skipLikeFallback });

    const out: IdentityMatch[] = [];
    for (const j of judged) {
        if (j.verdict !== 'same' && j.verdict !== 'possible') continue;
        const c = j.candidate;
        if (exclude && c.adopterId === exclude) continue;
        out.push({
            adopterId: c.adopterId, adopterName: c.name, relevancePercent: c.relevancePercent,
            matchTypes: c.matchTypes, matchValues: c.matchValues, source: c.source,
            verdict: j.verdict, reason: j.reason,
        });
    }
    return out.slice(0, limit);
}
