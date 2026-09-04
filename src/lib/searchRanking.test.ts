import { describe, it, expect } from 'vitest';
import {
    classifyNameMatch, NAME_MATCH_WEIGHT, isNameLikeQuery, qualifiesForMainList,
} from './searchRanking';

/**
 * The ranking fixture. Before this, nothing tested ordering or bucketing at all —
 * `WEIGHTS` could be changed and no test would notice. These pin the two
 * behaviours that were argued over in review: a different name must not tie a
 * real one, and a typo'd name must still win.
 */

describe('classifyNameMatch', () => {
    it('recognises the whole name', () => {
        expect(classifyNameMatch('maria', 'maria')).toBe('exact');
    });

    it('recognises the query as one word of the name', () => {
        expect(classifyNameMatch('maria gonzalez', 'maria')).toBe('word');
        expect(classifyNameMatch('ana maria gonzalez', 'maria')).toBe('word');
    });

    // The reported bug: "Mariano" answered "maria" as strongly as "María".
    it('demotes a different name that merely starts with the query', () => {
        expect(classifyNameMatch('mariano gil', 'maria')).toBe('word_prefix');
        expect(classifyNameMatch('mariana godoy', 'maria')).toBe('word_prefix');
        expect(classifyNameMatch('marcos gimenez', 'mar')).toBe('word_prefix');
    });

    // The product requirement this must not break, litigated once already:
    // typing "jonatan" has to find "Jonathan".
    it('keeps typo tolerance ahead of prefix containment', () => {
        expect(classifyNameMatch('jonathan daniel fernandez', 'jonatan')).toBe('fuzzy_word');
        expect(classifyNameMatch('jonatan daniel fernandez', 'jonathan')).toBe('fuzzy_word');
    });

    it('scores a typo above a different name', () => {
        const typo = NAME_MATCH_WEIGHT[classifyNameMatch('jonathan fernandez', 'jonatan')];
        const other = NAME_MATCH_WEIGHT[classifyNameMatch('mariano gil', 'maria')];
        expect(typo).toBeGreaterThan(other);
    });

    // The tie that started this: both used to score a flat 50.
    it('ranks the real name above the coincidental one', () => {
        const real = NAME_MATCH_WEIGHT[classifyNameMatch('maria gonzalez', 'maria')];
        const coincidental = NAME_MATCH_WEIGHT[classifyNameMatch('mariano gil', 'maria')];
        expect(real).toBeGreaterThan(coincidental);
        // and by a margin the incidental bonuses (photo 5 + rating 3 + recent 3)
        // cannot close, which is exactly how the old tie was broken
        expect(real - coincidental).toBeGreaterThan(11);
    });

    it('falls back to a mid-word substring as the weakest signal', () => {
        expect(classifyNameMatch('guadalupe', 'dalu')).toBe('substring');
    });

    it('returns none when nothing matches', () => {
        expect(classifyNameMatch('juan perez', 'maria')).toBe('none');
        expect(classifyNameMatch('', 'maria')).toBe('none');
        expect(classifyNameMatch('maria', '')).toBe('none');
    });

    // A 4-char token gets a zero edit budget, so it must not fuzzy-match.
    it('gives short queries no typo budget', () => {
        expect(classifyNameMatch('juan perez', 'jose')).toBe('none');
    });
});

describe('isNameLikeQuery', () => {
    it('is true for names', () => {
        expect(isNameLikeQuery('maria')).toBe(true);
        expect(isNameLikeQuery('María González')).toBe(true);
    });

    it('is false for identifiers, which answer through contact fields', () => {
        expect(isNameLikeQuery('11 3318-6767')).toBe(false);
        expect(isNameLikeQuery('ana@mail.com')).toBe(false);
        expect(isNameLikeQuery('DNI 30123456')).toBe(false);
    });
});

describe('qualifiesForMainList', () => {
    const base = {
        relevancePercent: 50, matchTypes: ['name_contains'], coverage: 1,
        hasStrongId: false, isMultiToken: false, isNameLike: true, minRelevance: 10,
    };

    it('keeps a name match', () => {
        expect(qualifiesForMainList(base)).toBe(true);
    });

    // The street-name case: "Calle Mariano" answering a search for "maria".
    it('demotes a one-word name search answered only by an address', () => {
        expect(qualifiesForMainList({ ...base, matchTypes: ['address'] })).toBe(false);
    });

    // Previously the floor was skipped entirely for single-token queries.
    it('applies the relevance floor to single-token queries', () => {
        expect(qualifiesForMainList({ ...base, relevancePercent: 4 })).toBe(false);
    });

    // Searching a phone must still be answered by the contact field.
    it('keeps an identifier search answered by contact', () => {
        expect(qualifiesForMainList({
            ...base, matchTypes: ['contact'], isNameLike: false,
        })).toBe(true);
    });

    it('never demotes a strong identifier match', () => {
        expect(qualifiesForMainList({
            ...base, relevancePercent: 1, matchTypes: ['address'], hasStrongId: true,
        })).toBe(true);
    });

    it('still requires full coverage on multi-token queries', () => {
        expect(qualifiesForMainList({ ...base, isMultiToken: true, coverage: 0.5 })).toBe(false);
        expect(qualifiesForMainList({ ...base, isMultiToken: true, coverage: 1 })).toBe(true);
    });
});
