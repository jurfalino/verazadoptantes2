import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutosaveQueue } from './autosaveQueue';

describe('AutosaveQueue', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('debounces changes into one save', async () => {
        const save = vi.fn(async () => 'ok' as const);
        const q = new AutosaveQueue(save, 800, () => {});
        q.schedule('a'); q.schedule('b'); q.schedule('c');
        await vi.advanceTimersByTimeAsync(800);
        expect(save).toHaveBeenCalledTimes(1);
        expect(save).toHaveBeenCalledWith('c');
    });

    it('flush saves immediately and skips an unchanged payload', async () => {
        const save = vi.fn(async () => 'ok' as const);
        const q = new AutosaveQueue(save, 800, () => {});
        q.schedule('a');
        expect(await q.flush()).toBe(true);
        expect(save).toHaveBeenCalledTimes(1);
        expect(await q.flush()).toBe(true);
        expect(save).toHaveBeenCalledTimes(1);
    });

    it('new typing after a save shows "saving", not "saved", until it is saved', async () => {
        const statuses: string[] = [];
        const save = vi.fn(async () => 'ok' as const);
        const q = new AutosaveQueue(save, 800, s => statuses.push(s));
        q.schedule('a');
        await vi.advanceTimersByTimeAsync(800);
        expect(statuses.at(-1)).toBe('saved');
        q.schedule('b');
        expect(statuses.at(-1)).toBe('saving');
        await vi.advanceTimersByTimeAsync(800);
        expect(statuses.at(-1)).toBe('saved');
    });

    it('dispose flushes a pending change instead of dropping it', async () => {
        const save = vi.fn(async () => 'ok' as const);
        const q = new AutosaveQueue(save, 800, () => {});
        q.schedule('a');
        q.dispose();
        await vi.runAllTimersAsync();
        expect(save).toHaveBeenCalledWith('a');
    });

    it('goes offline on failure and retries until it succeeds', async () => {
        const statuses: string[] = [];
        const save = vi.fn().mockResolvedValueOnce('retry').mockResolvedValueOnce('ok');
        const q = new AutosaveQueue(save, 100, s => statuses.push(s));
        q.schedule('a');
        await vi.advanceTimersByTimeAsync(100);
        expect(statuses).toContain('offline');
        await vi.advanceTimersByTimeAsync(3000);
        expect(save).toHaveBeenCalledTimes(2);
        expect(statuses.at(-1)).toBe('saved');
    });

    it('revert while a save is in flight ends with the reverted payload on the server', async () => {
        const statuses: string[] = [];
        const server: string[] = [];
        let release!: () => void;
        const save = vi.fn(async (p: string) => {
            if (p === 'a+x') await new Promise<void>(r => { release = r; });
            server.push(p);
            return 'ok' as const;
        });
        const q = new AutosaveQueue(save, 100, s => statuses.push(s));
        q.schedule('a');
        await vi.advanceTimersByTimeAsync(100);
        q.schedule('a+x');
        await vi.advanceTimersByTimeAsync(100); // a+x now in flight
        q.schedule('a');                          // revert
        release();
        await vi.advanceTimersByTimeAsync(500);
        expect(server.at(-1)).toBe('a');
        expect(statuses.at(-1)).toBe('saved');
    });

    it('concurrent flushes never overlap and the newest payload is saved last', async () => {
        let active = 0; let maxActive = 0; const order: string[] = [];
        const save = vi.fn(async (p: string) => {
            active++; maxActive = Math.max(maxActive, active);
            await new Promise(r => setTimeout(r, 50));
            order.push(p); active--;
            return 'ok' as const;
        });
        const q = new AutosaveQueue(save, 800, () => {});
        q.schedule('a');
        const f1 = q.flush();
        q.schedule('b');
        const f2 = q.flush();
        q.schedule('c');
        const f3 = q.flush();
        await vi.advanceTimersByTimeAsync(1000);
        await Promise.all([f1, f2, f3]);
        expect(maxActive).toBe(1);
        expect(order.at(-1)).toBe('c');
    });

    it('a fatal result shows "error" and never retries', async () => {
        const statuses: string[] = [];
        const save = vi.fn(async () => 'fatal' as const);
        const q = new AutosaveQueue(save, 100, s => statuses.push(s));
        q.schedule('a');
        await vi.advanceTimersByTimeAsync(100);
        expect(statuses.at(-1)).toBe('error');
        await vi.advanceTimersByTimeAsync(10000);
        expect(save).toHaveBeenCalledTimes(1);
    });

    it('dispose with a failing save tries once and never retries', async () => {
        const save = vi.fn(async () => 'retry' as const);
        const q = new AutosaveQueue(save, 800, () => {});
        q.schedule('a');
        q.dispose();
        await vi.advanceTimersByTimeAsync(10000);
        expect(save).toHaveBeenCalledTimes(1);
    });
});
