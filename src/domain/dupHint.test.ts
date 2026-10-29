import { describe, it, expect } from 'vitest';
import { NO_DISMISSED, dismissDupHintMatch, dupHintSearchInput, entryMatchesTyped, visibleDupHintMatches } from './dupHint';

describe('dupHintSearchInput — what the engine is asked for one typed identifier', () => {
    it('one list per strong type (emails and socials lower-cased, ids as identity numbers)', () => {
        expect(dupHintSearchInput('phone', ' 11 4444-0303 ')).toEqual({ phones: ['11 4444-0303'] });
        expect(dupHintSearchInput('email', 'Ana@Mail.COM')).toEqual({ emails: ['ana@mail.com'] });
        expect(dupHintSearchInput('social', '@AnaP')).toEqual({ socials: ['@anap'] });
        expect(dupHintSearchInput('id', '30.111.222')).toEqual({ ids: ['30.111.222'] });
    });
    it('nothing for other types, empty values or non-strings', () => {
        expect(dupHintSearchInput('address', 'Belgrano 123')).toBeNull();
        expect(dupHintSearchInput('alias', 'Anita')).toBeNull();
        expect(dupHintSearchInput('phone', '   ')).toBeNull();
        expect(dupHintSearchInput('phone', 42)).toBeNull();
    });
    it('caps the value', () => {
        const out = dupHintSearchInput('email', `${'a'.repeat(500)}@x.com`) as { emails: string[] };
        expect(out.emails[0].length).toBe(200);
    });
});

describe('entryMatchesTyped — which stored contact is the one typed', () => {
    it('phones by their last 8 digits, any format', () => {
        expect(entryMatchesTyped({ type: 'phone', value: '+54 9 11 6585-1333' }, 'phone', '6585 1333')).toBe(true);
        expect(entryMatchesTyped({ type: 'phone', value: '+54 9 11 6585-1334' }, 'phone', '6585 1333')).toBe(false);
        expect(entryMatchesTyped({ type: 'phone', value: '123' }, 'phone', '123')).toBe(false);
    });
    it('emails case-insensitively; handles and ids normalized', () => {
        expect(entryMatchesTyped({ type: 'email', value: 'Ana@Mail.com ' }, 'email', 'ana@mail.com')).toBe(true);
        expect(entryMatchesTyped({ type: 'social', value: 'https://instagram.com/ana.perez' }, 'social', '@Ana.Perez')).toBe(true);
        expect(entryMatchesTyped({ type: 'id', value: '30.111.222' }, 'id', '30111222')).toBe(true);
    });
    it('never across types', () => {
        expect(entryMatchesTyped({ type: 'email', value: '30111222' }, 'id', '30111222')).toBe(false);
    });
});

describe('«No es esta persona» — hidden while the typed value stays the same', () => {
    const matches = [{ adopterId: 'a' }, { adopterId: 'b' }];

    it('hides the answered match, keeps the other', () => {
        const d = dismissDupHintMatch(NO_DISMISSED, '6585-1333', 'a');
        expect(visibleDupHintMatches(matches, d, '6585-1333').map(m => m.adopterId)).toEqual(['b']);
        // Surrounding spaces are the same value.
        expect(visibleDupHintMatches(matches, d, ' 6585-1333 ').map(m => m.adopterId)).toEqual(['b']);
    });
    it('a different value shows it again, and answering there starts over', () => {
        const d = dismissDupHintMatch(NO_DISMISSED, '6585-1333', 'a');
        expect(visibleDupHintMatches(matches, d, '6585-1334').map(m => m.adopterId)).toEqual(['a', 'b']);
        const d2 = dismissDupHintMatch(d, '6585-1334', 'b');
        expect(d2).toEqual({ value: '6585-1334', ids: ['b'] });
    });
    it('both answered → nothing left; answering twice adds nothing', () => {
        const d = dismissDupHintMatch(dismissDupHintMatch(NO_DISMISSED, 'x@y.com', 'a'), 'x@y.com', 'b');
        expect(visibleDupHintMatches(matches, d, 'x@y.com')).toEqual([]);
        expect(dismissDupHintMatch(d, 'x@y.com', 'a').ids).toEqual(['a', 'b']);
    });
});

