/**
 * One-shot page reload after a webpack chunk failure.
 *
 * Every deploy rewrites content-hashed chunk filenames and the CDN drops the
 * old ones, so a tab left open across a deploy 404s on its next lazy import.
 * Reloading pulls fresh HTML with fresh chunk references and the user carries
 * on; the alternative is an error screen whose retry button re-requests the
 * same missing file.
 *
 * Lives here rather than at the four call sites (the two global handlers in
 * ClientErrorReporter and the two React error boundaries) so the guard key —
 * and the promise that we reload at most once — exist in exactly one place.
 */
export const CHUNK_RELOAD_GUARD = 'buenadoptante.chunk_reload_attempted';

/**
 * Reload once per session. Returns whether a reload was actually triggered, so
 * the caller knows whether to fall through to its error UI.
 *
 * If sessionStorage is unavailable (private mode, blocked cookies) we decline
 * to reload at all: without the guard we cannot promise to stop, and a reload
 * loop is far worse than an error screen.
 */
export function attemptChunkReload(): boolean {
    try {
        if (sessionStorage.getItem(CHUNK_RELOAD_GUARD)) return false;
        sessionStorage.setItem(CHUNK_RELOAD_GUARD, '1');
    } catch {
        return false;
    }
    window.location.reload();
    return true;
}
