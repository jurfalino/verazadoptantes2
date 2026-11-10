/** Per-request memo: reused within a request, never across requests, failures not remembered. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let current: object | null = null;
vi.mock('next/headers', () => ({ headers: vi.fn(async () => { if (!current) throw new Error('outside a request'); return current; }) }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));

import { perRequest } from './requestMemo';

beforeEach(() => { current = null; });

describe('perRequest', () => {
    it('one request: the second call reuses the first answer', async () => {
        current = {};
        const fn = vi.fn(async () => 'ana@x.org');
        expect(await perRequest('getUser', fn)).toBe('ana@x.org');
        expect(await perRequest('getUser', fn)).toBe('ana@x.org');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('two requests never share an answer (another person, another request)', async () => {
        current = {};
        await perRequest('getUser', async () => 'ana@x.org');
        current = {};
        expect(await perRequest('getUser', async () => 'bea@x.org')).toBe('bea@x.org');
    });

    it('different keys are different questions', async () => {
        current = {};
        expect(await perRequest('role:a', async () => 'admin')).toBe('admin');
        expect(await perRequest('role:b', async () => null)).toBeNull();
    });

    it('a failure is not remembered: the next call tries again', async () => {
        current = {};
        await expect(perRequest('team', async () => { throw new Error('D1 down'); })).rejects.toThrow('D1 down');
        expect(await perRequest('team', async () => ['ana@x.org'])).toEqual(['ana@x.org']);
    });

    it('outside a request (build, cron, tests): no memo at all', async () => {
        const fn = vi.fn(async () => 1);
        await perRequest('x', fn);
        await perRequest('x', fn);
        expect(fn).toHaveBeenCalledTimes(2);
    });
});
