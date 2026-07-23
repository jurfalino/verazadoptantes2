import { describe, it, expect } from 'vitest';
import { chunk, D1_IN_CHUNK } from './chunk';

describe('chunk', () => {
    it('returns [] for an empty array', () => {
        expect(chunk([], 40)).toEqual([]);
    });

    it('keeps a single short chunk when arr fits in one', () => {
        expect(chunk([1], 40)).toEqual([[1]]);
        expect(chunk([1, 2, 3], 40)).toEqual([[1, 2, 3]]);
    });

    it('splits exactly on the boundary', () => {
        const arr = Array.from({ length: 40 }, (_, i) => i);
        const res = chunk(arr, 40);
        expect(res).toHaveLength(1);
        expect(res[0]).toHaveLength(40);
    });

    it('spills one over into a second chunk', () => {
        const arr = Array.from({ length: 41 }, (_, i) => i);
        const res = chunk(arr, 40);
        expect(res).toHaveLength(2);
        expect(res[0]).toHaveLength(40);
        expect(res[1]).toEqual([40]);
    });

    it('produces full + remainder chunks and preserves order + total count', () => {
        const arr = Array.from({ length: 91 }, (_, i) => i); // 40 + 40 + 11
        const res = chunk(arr, 40);
        expect(res.map((c) => c.length)).toEqual([40, 40, 11]);
        expect(res.flat()).toEqual(arr); // order-preserving, no drops/dupes
    });

    it('rejects a non-positive size', () => {
        expect(() => chunk([1, 2], 0)).toThrow();
        expect(() => chunk([1, 2], -1)).toThrow();
    });
});

describe('D1_IN_CHUNK', () => {
    // The dup-candidates query binds the id list twice plus one status param.
    // This is the regression guard for the bug that returned an empty
    // /my-adopters list for a 50-adopter user: 1 + 2*50 = 101 > 100.
    it('keeps the doubled dup-candidates query under D1 100-param cap', () => {
        expect(D1_IN_CHUNK * 2 + 1).toBeLessThanOrEqual(100);
    });

    it('keeps single-list enrichment queries under the cap', () => {
        expect(D1_IN_CHUNK + 1).toBeLessThanOrEqual(100);
    });
});
