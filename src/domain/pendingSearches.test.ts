import { describe, it, expect } from 'vitest';
import { groupPendingSearches, refines, refineKind, fingerprint, isIdentified, HIGH_CONFIDENCE_PERCENT } from './pendingSearches';

const NOW = 1_800_000_000;
const ago = (days: number) => NOW - days * 86400;

function s(id: string, query: string, createdAt = ago(1), extra: Record<string, unknown> = {}) {
    return { id, query, createdAt, ...extra };
}

describe('refines', () => {
    it('treats an added surname as the same search carried further', () => {
        expect(refines(fingerprint('Maria Perez'), fingerprint('Maria'))).toBe(true);
    });

    it('treats an added phone as the same search carried further', () => {
        expect(refines(fingerprint('Maria Perez 11-6666666'), fingerprint('Maria Perez'))).toBe(true);
    });

    it('keeps two different surnames apart', () => {
        expect(refines(fingerprint('Maria Gomez'), fingerprint('Maria Perez'))).toBe(false);
        expect(refines(fingerprint('Maria Perez'), fingerprint('Maria Gomez'))).toBe(false);
    });

    it('folds a half-typed name into the full one', () => {
        expect(refineKind(fingerprint('Maria'), fingerprint('Mar'))).toBe('prefix');
    });

    it('calls a whole-token refinement exact, not prefix', () => {
        expect(refineKind(fingerprint('Maria Perez'), fingerprint('Maria'))).toBe('exact');
    });

    it('ignores accents and case', () => {
        expect(refines(fingerprint('María Pérez'), fingerprint('maria perez'))).toBe(true);
    });

    it('keeps two different phones apart', () => {
        expect(refines(fingerprint('Maria 11-6666666'), fingerprint('Maria 11-7777777'))).toBe(false);
    });
});

describe('groupPendingSearches', () => {
    it('asks once, about the most complete search', () => {
        const asks = groupPendingSearches([
            s('1', 'Maria', ago(3)),
            s('2', 'Maria Perez', ago(2)),
            s('3', 'Maria Perez 11-6666666', ago(1)),
        ], { now: NOW });

        expect(asks).toHaveLength(1);
        expect(asks[0].query).toBe('Maria Perez 11-6666666');
        expect(asks[0].searchCount).toBe(3);
        // Answering the ask has to close all three searches, or they come back.
        expect([...asks[0].memberIds].sort()).toEqual(['1', '2', '3']);
    });

    it('still picks the most complete search when it was not the last one typed', () => {
        const asks = groupPendingSearches([
            s('1', 'Maria Perez 11-6666666', ago(3)),
            s('2', 'Maria', ago(1)),
        ], { now: NOW });

        expect(asks[0].query).toBe('Maria Perez 11-6666666');
        expect(asks[0].searchCount).toBe(2);
    });

    it('asks separately about different people', () => {
        const asks = groupPendingSearches([
            s('1', 'Maria Perez', ago(2)),
            s('2', 'Juan Gomez', ago(1)),
        ], { now: NOW });

        expect(asks.map((a) => a.query)).toEqual(['Juan Gomez', 'Maria Perez']);
    });

    it('never borrows the identity a broader search matched', () => {
        // The v2.56.82 defect: "Maria Ornella" matched one record called
        // "Ornella", and that name ended up on an ask led by a narrower search
        // that had matched nobody — then a record was written against it.
        const asks = groupPendingSearches([
            s('1', 'Maria', ago(3)),
            s('2', 'Maria Ornella', ago(3), { adopterId: 'ornella', adopterName: 'Ornella', matchConfidence: 95 }),
            s('3', 'Maria Ornella Capri', ago(3)),
            s('4', 'Maria Ornella Capri Otto', ago(3)),
        ], { now: NOW });

        expect(asks).toHaveLength(1);
        expect(asks[0].query).toBe('Maria Ornella Capri Otto');
        expect(asks[0].adopterId).toBeFalsy();
        expect(isIdentified(asks[0])).toBe(false);
    });

    it('keeps the identity when the most complete search found it itself', () => {
        const asks = groupPendingSearches([
            s('1', 'Maria', ago(2)),
            s('2', 'Maria Perez 11-6666666', ago(1), { adopterId: 'a1', adopterName: 'María Pérez', matchConfidence: 96 }),
        ], { now: NOW });

        expect(asks[0].adopterId).toBe('a1');
        expect(isIdentified(asks[0])).toBe(true);
    });

    it('drops searches older than the window', () => {
        expect(groupPendingSearches([s('1', 'Maria Perez', ago(45))], { now: NOW })).toEqual([]);
        expect(groupPendingSearches([s('1', 'Maria Perez', ago(20))], { now: NOW })).toHaveLength(1);
    });

    it('defaults to a 30-day window and 10 asks', () => {
        const names = ['Ana Lopez', 'Bruno Diaz', 'Carla Ruiz', 'Diego Sosa', 'Elena Mota',
            'Fabio Nieto', 'Gina Paz', 'Hugo Vera', 'Iris Cano', 'Jorge Rey', 'Keila Soto', 'Lucas Bravo'];
        const many = names.map((n, i) => s(String(i), n, ago(i + 1)));
        expect(groupPendingSearches(many, { now: NOW })).toHaveLength(10);
    });

    it('folds a half-typed name in only when it was typed moments earlier', () => {
        const sameSitting = groupPendingSearches([
            s('1', 'Mari', NOW - 3600),
            s('2', 'Mariana Torres', NOW - 3540),
        ], { now: NOW });
        expect(sameSitting).toHaveLength(1);
        expect(sameSitting[0].query).toBe('Mariana Torres');

        // Ana is the start of Anabel, but a week apart they are two people.
        const weekApart = groupPendingSearches([
            s('1', 'Ana', ago(8)),
            s('2', 'Anabel Ferreyra', ago(1)),
        ], { now: NOW });
        expect(weekApart).toHaveLength(2);
    });

    it('drops searches with nothing to match on', () => {
        expect(groupPendingSearches([s('1', '   '), s('2', '...')], { now: NOW })).toEqual([]);
    });

    it('returns the newest asks first, capped', () => {
        const asks = groupPendingSearches([
            s('1', 'Ana Lopez', ago(5)),
            s('2', 'Juan Gomez', ago(4)),
            s('3', 'Maria Perez', ago(3)),
        ], { now: NOW, limit: 2 });

        expect(asks.map((a) => a.query)).toEqual(['Maria Perez', 'Juan Gomez']);
    });
});

describe('isIdentified', () => {
    it('needs a match that is certain, not merely single', () => {
        expect(isIdentified({ adopterId: 'a1', matchConfidence: HIGH_CONFIDENCE_PERCENT })).toBe(true);
        expect(isIdentified({ adopterId: 'a1', matchConfidence: HIGH_CONFIDENCE_PERCENT - 1 })).toBe(false);
        expect(isIdentified({ adopterId: 'a1', matchConfidence: null })).toBe(false);
        expect(isIdentified({ adopterId: null, matchConfidence: 99 })).toBe(false);
    });
});
