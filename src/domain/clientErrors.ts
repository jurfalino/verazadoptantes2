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
