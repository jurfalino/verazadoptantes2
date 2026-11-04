import { describe, it, expect } from 'vitest';
import { followMergeChain, pickActiveMerge, type MergeStep } from './mergeRedirect';

// A tiny in-memory "database": id → what a profile URL for that id finds.
const steps = (map: Record<string, MergeStep>) => async (id: string): Promise<MergeStep> =>
    map[id] ?? { kind: 'gone' };

describe('followMergeChain', () => {
    it('one hop: the absorbed profile resolves to its survivor', async () => {
        const step = steps({ b: { kind: 'merged', into: 'a' }, a: { kind: 'live' } });
        expect(await followMergeChain('b', step)).toBe('a');
    });

    it('a chain A←B←C: C resolves to the final survivor, not the middle hop', async () => {
        const step = steps({
            c: { kind: 'merged', into: 'b' },
            b: { kind: 'merged', into: 'a' },
            a: { kind: 'live' },
        });
        expect(await followMergeChain('c', step)).toBe('a');
    });

    it('a live profile is not a redirect', async () => {
        expect(await followMergeChain('a', steps({ a: { kind: 'live' } }))).toBeNull();
    });

    it('a profile deleted for any reason other than a merge stays a 404', async () => {
        expect(await followMergeChain('x', steps({ x: { kind: 'gone' } }))).toBeNull();
    });

    it('a survivor that was later deleted leaves nowhere to go: 404', async () => {
        const step = steps({ b: { kind: 'merged', into: 'a' }, a: { kind: 'gone' } });
        expect(await followMergeChain('b', step)).toBeNull();
    });

    it('a cycle never loops forever', async () => {
        const step = steps({ a: { kind: 'merged', into: 'b' }, b: { kind: 'merged', into: 'a' } });
        expect(await followMergeChain('a', step)).toBeNull();
    });

    it('a merge pointing at itself is ignored', async () => {
        expect(await followMergeChain('a', steps({ a: { kind: 'merged', into: 'a' } }))).toBeNull();
    });

    it('gives up past the hop cap', async () => {
        const map: Record<string, MergeStep> = {};
        for (let i = 0; i < 20; i++) map[`p${i}`] = { kind: 'merged', into: `p${i + 1}` };
        map.p20 = { kind: 'live' };
        expect(await followMergeChain('p0', steps(map), 10)).toBeNull();
        expect(await followMergeChain('p15', steps(map), 10)).toBe('p20');
    });
});

describe('pickActiveMerge', () => {
    it('the latest merge that was not undone wins', () => {
        expect(pickActiveMerge([
            { primaryId: 'old', createdAt: 1, undone: false },
            { primaryId: 'new', createdAt: 3, undone: false },
            { primaryId: 'mid', createdAt: 2, undone: false },
        ])).toBe('new');
    });

    it('an undone merge is skipped: merged into X, undone, merged into Y → Y', () => {
        expect(pickActiveMerge([
            { primaryId: 'x', createdAt: 1, undone: true },
            { primaryId: 'y', createdAt: 2, undone: false },
        ])).toBe('y');
    });

    it('only undone merges: nothing to follow', () => {
        expect(pickActiveMerge([{ primaryId: 'x', createdAt: 1, undone: true }])).toBeNull();
    });

    it('rows without a survivor id are ignored', () => {
        expect(pickActiveMerge([{ primaryId: null, createdAt: 5, undone: false }])).toBeNull();
    });
});
