import { describe, it, expect, vi, afterEach } from 'vitest';
import { attemptStaleReload, STALE_RELOAD_GUARD, STALE_RELOAD_WINDOW_MS } from './staleDeploy';

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

describe('attemptStaleReload', () => {
    it('reloads and records when it did', () => {
        const reload = vi.fn();
        const storage = fakeStorage();
        vi.stubGlobal('sessionStorage', storage);
        vi.stubGlobal('window', { location: { reload } });

        expect(attemptStaleReload(1_000_000)).toBe(true);
        expect(reload).toHaveBeenCalledTimes(1);
        expect(storage.store[STALE_RELOAD_GUARD]).toBe('1000000');
    });

    it('refuses a second reload within the window, so a broken deploy cannot loop', () => {
        const reload = vi.fn();
        vi.stubGlobal('sessionStorage', fakeStorage({ [STALE_RELOAD_GUARD]: String(1_000_000) }));
        vi.stubGlobal('window', { location: { reload } });

        expect(attemptStaleReload(1_000_000 + STALE_RELOAD_WINDOW_MS - 1)).toBe(false);
        expect(reload).not.toHaveBeenCalled();
    });

    it('allows a reload again once the window has passed — a tab that outlives a second deploy recovers', () => {
        // The guard lives in sessionStorage, which survives reloads. A one-shot
        // flag left every long-lived tab unable to recover from any later deploy.
        const reload = vi.fn();
        vi.stubGlobal('sessionStorage', fakeStorage({ [STALE_RELOAD_GUARD]: String(1_000_000) }));
        vi.stubGlobal('window', { location: { reload } });

        expect(attemptStaleReload(1_000_000 + STALE_RELOAD_WINDOW_MS + 1)).toBe(true);
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('treats the old one-shot marker as an old attempt, not a permanent block', () => {
        const reload = vi.fn();
        vi.stubGlobal('sessionStorage', fakeStorage({ [STALE_RELOAD_GUARD]: '1' }));
        vi.stubGlobal('window', { location: { reload } });

        expect(attemptStaleReload(1_000_000)).toBe(true);
    });

    it('does not reload when storage is unavailable, so it cannot loop', () => {
        const reload = vi.fn();
        vi.stubGlobal('sessionStorage', fakeStorage({}, true));
        vi.stubGlobal('window', { location: { reload } });

        expect(attemptStaleReload()).toBe(false);
        expect(reload).not.toHaveBeenCalled();
    });
});
