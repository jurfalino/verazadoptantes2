import { levenshtein, maxNameEditDistance } from '@/lib/scoring';

/**
 * Name-match precision for single-token searches.
 *
 * Discovery used to score the name with a binary `nameNorm.includes(queryNorm)`,
 * worth a flat 50. Searching "maria" therefore scored **María González** and
 * **Mariano Gil** identically — both merely contain the string — and since the
 * sort compares only the relevance percentage, the tie was broken by incidental
 * bonuses. A Mariano with a profile photo outranked a María without one.
 *
 * `nameTokenMatches` could not be reused for the distinction: it opens with
 * `text.includes(token)`, so it says yes to Mariano too. It is the right tool for
 * "did this token appear at all" (recall) and the wrong one for "how well does
 * this name answer the query" (precision).
 *
 * The bands below are ordered so that typo tolerance is checked BEFORE prefix
 * containment. That ordering is the thing to preserve: it is what keeps
 * "jonatan" finding "Jonathan Daniel Fernández" — an explicit product
 * requirement — while pushing "Mariano" down for "maria".
 */

export type NameMatchKind =
    /** The whole name is the query. */
    | 'exact'
    /** A word of the name IS the query — "maria" in "María González". */
    | 'word'
    /** A word is within the query's edit-distance budget — "jonatan" ≈ "jonathan". */
    | 'fuzzy_word'
    /** A word merely STARTS with the query — "mariano" for "maria". */
    | 'word_prefix'
    /** The query appears mid-word, matching no word boundary at all. */
    | 'substring'
    | 'none';

/**
 * Weight per band. `fuzzy_word` stays high on purpose — a typo'd name is still
 * the name you meant — while `word_prefix` drops far enough that a different
 * name can no longer tie a real one. It is not zero: someone typing a partial
 * name ("mari" for "Mariano") should still find it, just not above an exact hit.
 */
export const NAME_MATCH_WEIGHT: Record<NameMatchKind, number> = {
    exact: 100,
    word: 85,
    fuzzy_word: 70,
    word_prefix: 22,
    substring: 12,
    none: 0,
};

/** Match types the UI already knows about, so no new chip kinds leak out. */
export const NAME_MATCH_TYPE: Record<Exclude<NameMatchKind, 'none'>, string> = {
    exact: 'name_exact',
    word: 'name_contains',
    fuzzy_word: 'name_tokens',
    word_prefix: 'name_partial',
    substring: 'name_partial',
};

/**
 * Classify how well `nameNorm` answers `queryNorm`. Both must already be
 * normalised (lowercased, accent-stripped) by the caller.
 */
export function classifyNameMatch(nameNorm: string, queryNorm: string): NameMatchKind {
    const name = (nameNorm || '').trim();
    const query = (queryNorm || '').trim();
    if (!name || !query) return 'none';

    if (name === query) return 'exact';

    const words = name.split(/\s+/).filter(Boolean);
    if (words.includes(query)) return 'word';

    // Typo tolerance before prefix containment: "jonatan" must reach "jonathan"
    // (distance 1, budget 1) rather than falling through to the prefix band.
    const budget = maxNameEditDistance(query);
    if (budget > 0) {
        for (const word of words) {
            if (Math.abs(word.length - query.length) > budget) continue;
            if (levenshtein(word, query) <= budget) return 'fuzzy_word';
        }
    }

    // "mariano".startsWith("maria") — a different name that happens to open with
    // the query. Real, but weak evidence.
    if (words.some(w => w.startsWith(query))) return 'word_prefix';

    if (name.includes(query)) return 'substring';
    return 'none';
}

/**
 * Is this query a name rather than an identifier? Digits and `@` mean a phone,
 * document or email, where a contact-field match IS the answer and must not be
 * demoted for lacking a name signal.
 */
export function isNameLikeQuery(query: string): boolean {
    const q = (query || '').trim();
    return q.length > 0 && !/[\d@]/.test(q);
}

/** Match types that count as the record answering by NAME. */
const NAME_SIGNALS = new Set(['name_exact', 'name_contains', 'name_tokens', 'name_partial']);

export interface MainListInput {
    relevancePercent: number;
    matchTypes: string[];
    /** Fraction of query tokens the record covers. Multi-token queries only. */
    coverage: number;
    /** Matched a phone/document identifier, which always stays strong. */
    hasStrongId: boolean;
    isMultiToken: boolean;
    /** The query looks like a name rather than an identifier. */
    isNameLike: boolean;
    minRelevance: number;
}

/**
 * Does a result belong in the main list, or under "Ampliar la búsqueda"?
 *
 * Two things changed here. The relevance floor used to apply ONLY to multi-token
 * queries — a single-word search skipped bucketing entirely, so everything that
 * cleared the anchor gate landed in the main list however weakly it scored. And a
 * one-word NAME search that a record answers only through its address ("Calle
 * Mariano" for "maria") is weak evidence, so it drops to the second tier.
 *
 * Demotion is not deletion: the weak tier sits one tap below with a count, which
 * is what makes tightening precision here safe.
 */
export function qualifiesForMainList(r: MainListInput): boolean {
    if (r.hasStrongId) return true;
    if (r.relevancePercent < r.minRelevance) return false;
    if (r.isMultiToken) return r.coverage >= 1;
    // Single-token name search: require the record to answer by name.
    if (r.isNameLike) return r.matchTypes.some(t => NAME_SIGNALS.has(t));
    return true;
}
