/**
 * Did a mutating server action actually write anything?
 *
 * Every mutating action in `src/app/actions` either throws or returns the
 * affected record's id — `saveAdoption`, for instance, returns
 * `{ success: true, id }`. So a call that *resolves* without an id did not
 * write: the promise came back, but nothing reached the database.
 *
 * The case that matters in the wild is a tab that outlived the deployment its
 * bundle was served from. Its action references no longer correspond to
 * anything on the server, and the call comes back empty rather than failing
 * loudly. Optional-chaining the result (`result?.id`) hides exactly this: the
 * form skips its follow-up work, reports success, and the user believes an
 * edit was saved that never was.
 *
 * Observed as errorId 3d84fc1c (2026-09-18), from a tab six days older than
 * the deployment then serving staging.
 */
export function didPersist(result: unknown): boolean {
    if (!result || typeof result !== 'object') return false;
    const id = (result as { id?: unknown }).id;
    return typeof id === 'string' ? id.length > 0 : id != null;
}
