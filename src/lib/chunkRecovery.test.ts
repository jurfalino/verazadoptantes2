import { describe, it, expect, vi, afterEach } from 'vitest';
import { attemptChunkReload, CHUNK_RELOAD_GUARD } from './chunkRecovery';

/** Minimal sessionStorage stand-in; `throws` simulates private-mode blocking. */
function fakeStorage(initial: Record<string, string> = {}, throws = false) {
    const store = { ...initial };
    return {
        store,
        getItem: (k: string) => { if (throws) throw new Error('blocked'); return store[k] ?? null; },
        setItem: (k: string, v: string) => { if (throws) throw new Error('blocked'); store[k] = v; },
    };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('attemptChunkReload', () => {
    it('reloads once and records the attempt', () => {
        const reload = vi.fn();
        const storage = fakeStorage();
        vi.stubGlobal('sessionStorage', storage);
        vi.stubGlobal('window', { location: { reload } });

        expect(attemptChunkReload()).toBe(true);
        expect(reload).toHaveBeenCalledTimes(1);
        expect(storage.store[CHUNK_RELOAD_GUARD]).toBe('1');
    });

    it('refuses a second reload in the same session', () => {
        const reload = vi.fn();
        vi.stubGlobal('sessionStorage', fakeStorage({ [CHUNK_RELOAD_GUARD]: '1' }));
        vi.stubGlobal('window', { location: { reload } });

        expect(attemptChunkReload()).toBe(false);
        expect(reload).not.toHaveBeenCalled();
    });

    it('does not reload when storage is unavailable, so it cannot loop', () => {
        const reload = vi.fn();
        vi.stubGlobal('sessionStorage', fakeStorage({}, true));
        vi.stubGlobal('window', { location: { reload } });

        expect(attemptChunkReload()).toBe(false);
        expect(reload).not.toHaveBeenCalled();
    });
});
