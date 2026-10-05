import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutosaveQueue } from './autosaveQueue';

describe('AutosaveQueue', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('debounces changes into one save', async () => {
        const save = vi.fn(async () => true);
        const q = new AutosaveQueue(save, 800, () => {});
        q.schedule('a'); q.schedule('b'); q.schedule('c');
        await vi.advanceTimersByTimeAsync(800);
        expect(save).toHaveBeenCalledTimes(1);
        expect(save).toHaveBeenCalledWith('c');
    });

    it('flush saves immediately and skips an unchanged payload', async () => {
        const save = vi.fn(async () => true);
        const q = new AutosaveQueue(save, 800, () => {});
        q.schedule('a');
        expect(await q.flush()).toBe(true);
        expect(save).toHaveBeenCalledTimes(1);
        expect(await q.flush()).toBe(true);
        expect(save).toHaveBeenCalledTimes(1);
    });

    it('new typing after a save shows "saving", not "saved", until it is saved', async () => {
        const statuses: string[] = [];
        const save = vi.fn(async () => true);
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
        const save = vi.fn(async () => true);
        const q = new AutosaveQueue(save, 800, () => {});
        q.schedule('a');
        q.dispose();
        await vi.runAllTimersAsync();
        expect(save).toHaveBeenCalledWith('a');
    });

    it('goes offline on failure and retries until it succeeds', async () => {
        const statuses: string[] = [];
        const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        const q = new AutosaveQueue(save, 100, s => statuses.push(s));
        q.schedule('a');
        await vi.advanceTimersByTimeAsync(100);
        expect(statuses).toContain('offline');
        await vi.advanceTimersByTimeAsync(3000);
        expect(save).toHaveBeenCalledTimes(2);
        expect(statuses.at(-1)).toBe('saved');
    });
});
