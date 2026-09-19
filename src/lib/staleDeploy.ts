/**
 * One-shot page reload for a tab that has outlived its deployment.
 *
 * Every deploy rewrites content-hashed chunk filenames and the CDN drops the
 * old ones, so a tab left open across a deploy 404s on its next lazy import.
 * Reloading pulls fresh HTML with fresh chunk references and the user carries
 * on; the alternative is an error screen whose retry button re-requests the
 * same missing file.
 *
 * Two different symptoms, one cause and one cure. A missing lazy chunk is the
 * visible one. The quieter one is deployment skew: an action id the running
 * deployment no longer knows is answered with 200 + HTML, which Next's client
 * turns into an action that resolved with nothing (errorId 3d84fc1c). Both
 * mean "this tab is too old", and both are fixed by fetching the page again.
 *
 * Lives here rather than at its call sites so the guard key — and the promise
 * that we reload at most once — exist in exactly one place. The key still says
 * `chunk` on purpose: changing the stored value would let a tab that already
 * reloaded under the old key reload a second time.
 */
export const STALE_RELOAD_GUARD = 'buenadoptante.chunk_reload_attempted';
/** At most one automatic reload per this window, per tab. */
export const STALE_RELOAD_WINDOW_MS = 5 * 60_000;

/**
 * Reload once per session. Returns whether a reload was actually triggered, so
 * the caller knows whether to fall through to its error UI.
 *
 * If sessionStorage is unavailable (private mode, blocked cookies) we decline
 * to reload at all: without the guard we cannot promise to stop, and a reload
 * loop is far worse than an error screen.
 */
export function attemptStaleReload(now: number = Date.now()): boolean {
    try {
        // A timestamp, not a one-shot flag. sessionStorage survives reloads, so a
        // flag meant "this tab may never recover again": fine on the first
        // deploy, stuck on every later one. A window still stops a loop — a
        // deploy that is genuinely broken reloads at most once per window.
        // The pre-2.56.66 value '1' reads as an attempt at epoch 1: long past.
        const last = Number(sessionStorage.getItem(STALE_RELOAD_GUARD));
        if (last && now - last < STALE_RELOAD_WINDOW_MS) return false;
        sessionStorage.setItem(STALE_RELOAD_GUARD, String(now));
    } catch {
        return false;
    }
    window.location.reload();
    return true;
}

// ── Stale-tab signal (v2.56.67) ─────────────────────────────────────────────
//
// Reloading unprompted is only safe where nothing typed can be lost: search,
// navigation, a crashed tree. Most server calls are SAVES, and a reload there
// destroys the form (audit 2026-09-19, P0-1). So the default is to *announce*
// the tab is stale and let a banner offer "Recargar"; callers that are reads
// opt in to attemptStaleReload instead.

/** Window event the banner listens for. `detail` carries what is known about the build. */
export const DEPLOYMENT_STALE_EVENT = 'buenadoptante:deployment-stale';

/**
 * Error id handed to a caller's toast when the failure was a stale tab. The toast
 * layer drops toasts carrying it, so the banner is the only message the user sees
 * — ~50 existing catch blocks need no change.
 */
export const STALE_DEPLOY_ERROR_ID = 'stale-deploy';

export interface DeploymentStaleDetail {
    serverBuildId?: string | null;
    /** True when the person just tried to do something (a save), not a background poll. */
    userInitiated?: boolean;
}

let staleMarked = false;

/**
 * Flag this tab as older than the running deployment. Never reloads. Announces
 * EVERY time: if the person dismissed the notice and then tries to save again,
 * the watcher must be able to bring it back — a one-shot event left later saves
 * failing with no explanation at all (audit 2, F2).
 */
export function markDeploymentStale(detail: DeploymentStaleDetail = {}): void {
    staleMarked = true;
    try {
        window.dispatchEvent(new CustomEvent<DeploymentStaleDetail>(DEPLOYMENT_STALE_EVENT, { detail }));
    } catch { /* no window (SSR): nothing to announce to */ }
}

export function isDeploymentMarkedStale(): boolean { return staleMarked; }

/** Test-only: the flag is module state. */
export function _resetStaleMarkForTests(): void { staleMarked = false; }
