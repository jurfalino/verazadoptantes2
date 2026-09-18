/**
 * Classification of uncaught client-side errors.
 *
 * React hydration mismatches are *recoverable*: React discards the
 * server-rendered tree, re-renders that subtree on the client, and the page
 * carries on working. But React 19's default `onRecoverableError` is
 * `reportError()`, which dispatches a global `error` event — indistinguishable,
 * to a `window.addEventListener('error')` handler, from an actual crash.
 *
 * That is how errorId 43d67f9e reached a user on 2026-09-07: a date rendered in
 * two different timezones, React recovered silently, and we showed the user a
 * red "Algo salió mal" toast with an error code for a page that was fine.
 *
 * These still get reported — a mismatch is a real defect and we want it in
 * Axiom — just at `warn`, without interrupting the user.
 */

/** React error codes for hydration mismatches React recovers from itself. */
const RECOVERABLE_REACT_CODES = [418, 423, 425];

const RECOVERABLE_PATTERNS = [
    // Un-minified builds spell the same conditions out in full.
    'Hydration failed because',
    'There was an error while hydrating',
    'Text content does not match server-rendered HTML',
    'did not match the server-rendered HTML',
];

/**
 * Whether an uncaught error is a React hydration mismatch that React already
 * recovered from — worth logging, not worth alarming the user about.
 */
export function isRecoverableHydrationError(message: string): boolean {
    if (!message) return false;

    const minified = message.match(/Minified React error #(\d+)/);
    if (minified && RECOVERABLE_REACT_CODES.includes(Number(minified[1]))) return true;

    return RECOVERABLE_PATTERNS.some(pattern => message.includes(pattern));
}

/**
 * Whether an uncaught error is webpack failing to fetch a lazy chunk.
 *
 * This happens on every deploy: the running SPA holds content-hashed chunk
 * filenames from the build it loaded, a new build rewrites those hashes, the
 * CDN drops the old files, and the next dynamic import 404s. The recovery is
 * always the same — reload once, so fresh HTML brings fresh chunk references.
 *
 * Checks name, message AND stack because production gets all three wrong in
 * different ways. Real payload behind errorId 7092aed7 (2026-09-10) arrived
 * with `name: 'Error'` and only the stack spelling out `ChunkLoadError`, so a
 * name-only test misses it.
 */
export function isChunkLoadError(
    err: { name?: string; message?: string; stack?: string } | null | undefined,
): boolean {
    if (!err) return false;
    if (err.name === 'ChunkLoadError') return true;
    if (err.stack?.startsWith('ChunkLoadError')) return true;
    return /Loading (CSS )?chunk [^\s]+ failed/.test(err.message || '');
}

/**
 * Whether a global error event is the browser's opaque cross-origin placeholder.
 *
 * When a script served from another origin without CORS headers throws, the
 * spec requires the browser to withhold everything: the message becomes the
 * literal "Script error.", the filename is empty and the position is 0:0. The
 * page cannot act on it, the user cannot act on it, and — crucially — it is
 * almost never our code. Third-party tags (analytics, in-app-browser
 * injections) throw these routinely on pages that are working perfectly.
 *
 * That is how errorId b1f16983 reached a visitor on 2026-09-17: a throw inside
 * a cross-origin tag in the Instagram in-app browser showed a red "algo salió
 * mal" toast over a homepage that was fine.
 *
 * Deliberately strict. All three signals must agree, so a genuine same-origin
 * failure that merely mentions a script error still reaches the user.
 */
export function isOpaqueCrossOriginError(
    event: { message?: string; filename?: string; lineno?: number; colno?: number },
): boolean {
    const message = (event.message || '').trim();
    if (message !== 'Script error.' && message !== 'Script error') return false;
    if (event.filename) return false;
    return !event.lineno && !event.colno;
}

/** What the global error handler should do with an uncaught event. */
export type WindowErrorKind = 'chunk' | 'hydration' | 'opaque' | 'report';

/**
 * Decide which branch an uncaught window error belongs in.
 *
 * The predicates above are each honest on their own; what has twice put a
 * useless error code in front of a user is the ORDER they run in. Keeping the
 * order here, as one pure function, is what makes it testable — the handler in
 * ClientErrorReporter only carries out the action.
 *
 * `chunk` goes first on purpose: a missing chunk is the one case with a real
 * recovery, and it must not be claimed by a looser match. `report` is the
 * default, so anything unrecognised still reaches the user with an id.
 */
export function classifyWindowError(event: {
    message?: string;
    name?: string;
    stack?: string;
    filename?: string;
    lineno?: number;
    colno?: number;
}): WindowErrorKind {
    if (isChunkLoadError({ name: event.name, message: event.message, stack: event.stack })) return 'chunk';
    if (isRecoverableHydrationError(event.message || '')) return 'hydration';
    if (isOpaqueCrossOriginError(event)) return 'opaque';
    return 'report';
}

/**
 * Body returned by the middleware when a request carries a deployment id that
 * is not the running one, and therefore the message of the error Next's client
 * raises for it. Shared so the producer (src/middleware.ts) and the consumer
 * (resolveErrorId) cannot drift apart.
 */
export const DEPLOYMENT_SKEW_SENTINEL = 'DEPLOYMENT_SKEW';

/**
 * Whether a caught error means "this tab is older than the deployment serving
 * it" rather than a genuine failure.
 *
 * Next's action reducer throws `new Error(await res.text())` for a `text/plain`
 * response at status >= 400, so the middleware's body reaches the client
 * verbatim. Without the middleware guard the same request gets 200 + HTML and
 * the action quietly resolves `undefined` instead — which is the bug this
 * whole path exists to convert into something recoverable.
 */
export function isDeploymentSkewError(error: unknown): boolean {
    const message = error instanceof Error
        ? error.message
        : typeof error === 'string' ? error : '';
    return message.includes(DEPLOYMENT_SKEW_SENTINEL);
}
