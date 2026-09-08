import { describe, it, expect } from 'vitest';
import { collapseNameEvidence } from './matchEvidence';

describe('collapseNameEvidence', () => {
    it('drops name words already contained in the matched full name', () => {
        // The reported card: "Nombre Completo luis igartua" + "Nombre igartua, luis".
        const out = collapseNameEvidence({
            name_full: ['luis igartua'],
            name_word: ['igartua', 'luis'],
        });
        expect(out.name_full).toEqual(['luis igartua']);
        expect(out.name_word).toBeUndefined();
    });

    it('keeps a name word that is NOT part of the full name', () => {
        // A surname shared via an alias is real extra evidence.
        const out = collapseNameEvidence({
            name_full: ['luis igartua'],
            name_word: ['igartua', 'luis', 'lozada'],
        });
        expect(out.name_word).toEqual(['lozada']);
    });

    it('is case- and order-insensitive', () => {
        const out = collapseNameEvidence({
            name_full: ['Luis Igartua'],
            name_word: ['IGARTUA', 'Luis'],
        });
        expect(out.name_word).toBeUndefined();
    });

    it('leaves name words alone when no full name matched', () => {
        // Two records sharing only a surname — that IS the whole evidence.
        const out = collapseNameEvidence({ name_word: ['igartua'] });
        expect(out.name_word).toEqual(['igartua']);
    });

    it('never touches other evidence types', () => {
        const out = collapseNameEvidence({
            name_full: ['luis igartua'],
            name_word: ['luis', 'igartua'],
            phone: ['1558336897'],
        });
        expect(out.phone).toEqual(['1558336897']);
        expect(out.name_word).toBeUndefined();
    });

    it('handles multi-word full names with extra spacing', () => {
        const out = collapseNameEvidence({
            name_full: ['luis  igartua   lozada'],
            name_word: ['lozada', 'luis', 'igartua'],
        });
        expect(out.name_word).toBeUndefined();
    });

    it('returns the input untouched when there is nothing to collapse', () => {
        const input = { phone: ['123'] };
        expect(collapseNameEvidence(input)).toBe(input);
    });
});
