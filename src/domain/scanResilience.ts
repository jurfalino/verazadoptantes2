/**
 * Keeping the duplicate Scan going when the browser's connection drops.
 *
 * Scan runs as many short requests (one batch each), driven by the admin page.
 * When the connection drops mid-request, Cloudflare cancels the work: the
 * records already re-indexed stay done, but no catch block runs, so the lock
 * stays `running` and the page used to stop with "Scan failed after N
 * profiles" (production, 2026-10-11: 800 of 1,253, Cloudflare status
 * `clientDisconnected`, no CPU or memory kill).
 */

/** Anyone's abandoned lock is reclaimed after this — far longer than a batch. */
export const SCAN_LOCK_STALE_MS = 5 * 60 * 1000;
/**
 * The same admin retrying their own interrupted batch may reclaim sooner: a
 * batch of 25 takes ~15 s, so a minute cannot cut into a live one of theirs.
 */
export const SCAN_LOCK_SAME_USER_STALE_MS = 60 * 1000;

/** How long until this requester may take over a `running` lock (0 = now). */
export function lockWaitMs(lockAgeMs: number, lockHolder: string | null | undefined, requester: string): number {
    const staleAfter = lockHolder && lockHolder === requester ? SCAN_LOCK_SAME_USER_STALE_MS : SCAN_LOCK_STALE_MS;
    return Math.max(0, staleAfter - lockAgeMs);
}

/** Consecutive failed requests after which the page gives up and says so. */
export const SCAN_MAX_CONSECUTIVE_FAILURES = 5;
const BACKOFF_MS = [2000, 5000, 10000, 20000, 30000];
/** The longest a 409 "wait for the lock" pause may be (just over the same-user window). */
const MAX_LOCK_WAIT_MS = 65 * 1000;

/**
 * Pause before retrying after the `failures`-th consecutive failure, or null to
 * stop. A busy lock says how long to wait (`retryInMs`); otherwise back off.
 */
export function scanRetryDelayMs(failures: number, retryInMs?: number): number | null {
    if (failures > SCAN_MAX_CONSECUTIVE_FAILURES) return null;
    const backoff = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1] ?? BACKOFF_MS[0];
    if (typeof retryInMs === 'number' && retryInMs > 0) return Math.min(retryInMs + 1000, MAX_LOCK_WAIT_MS);
    return backoff;
}

/**
 * Batch sizes for «Scan Now» (Admin → Duplicates). The page loops one POST per
 * batch until the route answers `done`.
 *
 * - `SCAN_BATCH_MAX`: the most records one call may re-tokenize (`?limit=` is
 *   clamped to it).
 * - `SCAN_PAGE_LIMIT`: what the page asks for. Writes go out in grouped D1
 *   batches, so a call's cost is mostly its fixed reads (every live profile,
 *   the adoptions view, the gift forms); a bigger batch amortizes them.
 * - `SCAN_MAX_BATCHES`: a safety stop for the page's loop. The real guard is
 *   «no forward progress» (the page stops when `remaining` does not fall); this
 *   only stops a runaway. It must never cut a real scan short: the households
 *   release needed ~239 batches of 25 (≈6,000 stale profiles) and the old stop
 *   was 200, so one click never finished.
 */
export const SCAN_BATCH_MAX = 200;
export const SCAN_PAGE_LIMIT = 100;
export const SCAN_MAX_BATCHES = 500;

/** A scan id the page sends with every batch of one «Scan Now» (`?scan=`); anything else is ignored. */
export function validScanId(raw: string | null | undefined): string | null {
    return raw && /^[A-Za-z0-9-]{8,64}$/.test(raw) ? raw : null;
}
