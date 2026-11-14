import { describe, it, expect } from 'vitest';
import { readBoth } from './readBoth';

describe('«Pendientes de revisar» reads pairs and general forms apart (review M4)', () => {
    it('a failed pairs read never hides the general forms', async () => {
        const boom = new Error('D1 down');
        const res = await readBoth(Promise.reject(boom), Promise.resolve(['ana']));
        expect(res).toEqual({ pairs: null, pairsError: boom, requests: ['ana'] });
    });

    it('both read: both returned', async () => {
        expect(await readBoth(Promise.resolve({ total: 2 }), Promise.resolve([]))).toEqual({ pairs: { total: 2 }, pairsError: null, requests: [] });
    });
});
