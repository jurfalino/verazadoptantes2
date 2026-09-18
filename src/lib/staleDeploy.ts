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

/**
 * Reload once per session. Returns whether a reload was actually triggered, so
 * the caller knows whether to fall through to its error UI.
 *
 * If sessionStorage is unavailable (private mode, blocked cookies) we decline
 * to reload at all: without the guard we cannot promise to stop, and a reload
 * loop is far worse than an error screen.
 */
export function attemptStaleReload(): boolean {
    try {
        if (sessionStorage.getItem(STALE_RELOAD_GUARD)) return false;
        sessionStorage.setItem(STALE_RELOAD_GUARD, '1');
    } catch {
        return false;
    }
    window.location.reload();
    return true;
}
