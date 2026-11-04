import { describe, it, expect, vi } from 'vitest';
import { scanScopedMemo, SCAN_MEMO_TTL_MS } from './scanMemo';
import { SCAN_BATCH_MAX, SCAN_MAX_BATCHES, SCAN_PAGE_LIMIT, validScanId } from '@/domain/scanResilience';

describe('scanScopedMemo', () => {
    it('reads once for every batch of one scan', async () => {
        const read = scanScopedMemo<number>();
        const load = vi.fn(async () => 7);
        expect(await read('scan-aaaa-1', load, 0)).toBe(7);
        expect(await read('scan-aaaa-1', load, 1000)).toBe(7);
        expect(await read('scan-aaaa-1', load, 2000)).toBe(7);
        expect(load).toHaveBeenCalledTimes(1);
    });
    it('a new scan reads again', async () => {
        const read = scanScopedMemo<number>();
        const load = vi.fn(async () => 1);
        await read('scan-aaaa-1', load, 0);
        await read('scan-bbbb-2', load, 0);
        expect(load).toHaveBeenCalledTimes(2);
    });
    it('no scan id: a fresh read every call', async () => {
        const read = scanScopedMemo<number>();
        const load = vi.fn(async () => 1);
        await read(null, load);
        await read(null, load);
        expect(load).toHaveBeenCalledTimes(2);
    });
    it('expires, and never keeps a failed read', async () => {
        const read = scanScopedMemo<number>();
        const load = vi.fn(async () => 1);
        await read('scan-aaaa-1', load, 0);
        await read('scan-aaaa-1', load, SCAN_MEMO_TTL_MS + 1);
        expect(load).toHaveBeenCalledTimes(2);
        const failing = vi.fn().mockRejectedValueOnce(new Error('D1 down')).mockResolvedValue(3);
        const read2 = scanScopedMemo<number>();
        await expect(read2('scan-cccc-3', failing, 0)).rejects.toThrow('D1 down');
        expect(await read2('scan-cccc-3', failing, 10)).toBe(3);
        expect(failing).toHaveBeenCalledTimes(2);
    });
});

describe('Scan Now batch sizes', () => {
    it('one click finishes the households release scan (~6,000 stale profiles) with room to spare', () => {
        expect(SCAN_PAGE_LIMIT).toBeLessThanOrEqual(SCAN_BATCH_MAX);
        expect(SCAN_PAGE_LIMIT * SCAN_MAX_BATCHES).toBeGreaterThanOrEqual(2 * 239 * 25);
    });
    it('accepts only a plain scan id', () => {
        expect(validScanId('4f9c2a1e-8b7d-4c3a-9e21-0d5b6a7c8e9f')).toBe('4f9c2a1e-8b7d-4c3a-9e21-0d5b6a7c8e9f');
        expect(validScanId('short')).toBeNull();
        expect(validScanId("x'; DROP TABLE")).toBeNull();
        expect(validScanId(null)).toBeNull();
    });
});
