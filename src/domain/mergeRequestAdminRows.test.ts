import { describe, it, expect } from 'vitest';
import { oneRowPerPair, type AdminRequestRowLike } from './mergeRequestAdminRows';

const row = (id: string, a: string, b: string, over: Partial<AdminRequestRowLike> = {}): AdminRequestRowLike => ({
    id,
    status: 'pending',
    dispute: false,
    primary: { id: a },
    secondary: { id: b },
    ownerEmail: 'owner@example.com',
    resolvedByEmail: null,
    resolvedAt: null,
    ...over,
});

describe('oneRowPerPair (admin «Pedidos de combinación»)', () => {
    it('a pending dispute and the declined request it came from are ONE row: the dispute, carrying who rejected it', () => {
        const declined = row('d1', 'mine', 'theirs', { status: 'declined', resolvedByEmail: 'teammate@example.com', resolvedAt: 5_000 });
        const dispute = row('x1', 'theirs', 'mine', { dispute: true, ownerEmail: null });
        const out = oneRowPerPair([dispute, declined]);
        expect(out.map(r => r.id)).toEqual(['x1']);
        expect(out[0].rejected).toEqual({ byEmail: 'teammate@example.com', at: 5_000 });
    });

    it('the decliner falls back to the asked owner when the answer has no resolver recorded', () => {
        const out = oneRowPerPair([row('d1', 'a', 'b', { status: 'declined' }), row('x1', 'a', 'b', { dispute: true, ownerEmail: null })]);
        expect(out).toHaveLength(1);
        expect(out[0].rejected).toEqual({ byEmail: 'owner@example.com', at: null });
    });

    it('the latest decline is the position shown when there were several', () => {
        const out = oneRowPerPair([
            row('d-old', 'a', 'b', { status: 'declined', resolvedByEmail: 'first@example.com', resolvedAt: 1 }),
            row('d-new', 'b', 'a', { status: 'declined', resolvedByEmail: 'second@example.com', resolvedAt: 9 }),
            row('x1', 'a', 'b', { dispute: true, ownerEmail: null }),
        ]);
        expect(out.map(r => r.id)).toEqual(['x1']);
        expect(out[0].rejected?.byEmail).toBe('second@example.com');
    });

    it('a dispute with no decline on its pair (an admin had ruled them separate) stands alone', () => {
        const out = oneRowPerPair([row('x1', 'a', 'b', { dispute: true, ownerEmail: null })]);
        expect(out).toEqual([expect.objectContaining({ id: 'x1', rejected: null })]);
    });

    it('other pairs, and plain requests, are left as they are and in order', () => {
        const out = oneRowPerPair([
            row('p1', 'a', 'b'),
            row('x1', 'c', 'd', { dispute: true, ownerEmail: null }),
            row('d1', 'e', 'f', { status: 'declined' }),
            row('d2', 'd', 'c', { status: 'declined' }),
        ]);
        expect(out.map(r => [r.id, r.rejected])).toEqual([
            ['p1', null],
            ['x1', { byEmail: 'owner@example.com', at: null }],
            ['d1', null],
        ]);
    });
});
