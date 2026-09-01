/**
 * Single-slot undo queue for optimistic deletes.
 *
 * Pure of React so the sequencing — which is where the bugs live — can be unit
 * tested. `useUndoableDelete` is a thin wrapper over this.
 *
 * Three behaviours it guarantees, each of which was a real bug in the inline
 * implementation this replaces:
 *
 * 1. Scheduling while something is pending COMMITS the pending item rather than
 *    cancelling it. The old code cancelled, so deleting two entries inside the
 *    undo window silently lost the first — it just reappeared, unexplained.
 *
 * 2. Undo is keyed to a token. The undo affordance is a toast, and toasts stack
 *    and outlive the action that raised them, so an older toast's Undo button
 *    would otherwise cancel a *newer* delete.
 *
 * 3. `flush` commits on demand, for unmount: the toast is rendered by a
 *    layout-level provider and survives navigation, so dropping the delete
 *    would leave a "deleted — undo" toast for something never deleted.
 */
export interface UndoQueue<T> {
    /** Hide `item` and commit it after `delayMs`. Returns a token for `undo`. */
    schedule: (item: T) => number;
    /** Cancel the pending delete iff `token` is still the current one. */
    undo: (token: number) => void;
    /** Commit the pending delete immediately, if any. */
    flush: () => void;
    /** The item currently inside its undo window, or null. */
    getPending: () => T | null;
}

export function createUndoQueue<T>(opts: {
    delayMs: number;
    commit: (item: T) => void | Promise<void>;
    /** Called whenever the pending item changes, so a UI can re-render. */
    onPendingChange?: (item: T | null) => void;
}): UndoQueue<T> {
    const { delayMs, commit, onPendingChange } = opts;

    let pending: T | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let seq = 0;

    function setPending(item: T | null) {
        pending = item;
        onPendingChange?.(item);
    }

    /** Clear timer + pending, returning what was pending. */
    function settle(): T | null {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        const item = pending;
        if (item !== null) setPending(null);
        return item;
    }

    function flush() {
        const item = settle();
        if (item !== null) void commit(item);
    }

    function schedule(item: T): number {
        // Commit, don't cancel — see (1) above.
        flush();
        const token = ++seq;
        setPending(item);
        timer = setTimeout(() => {
            timer = null;
            // A newer schedule superseded us; that one owns the state now.
            if (seq !== token) return;
            const it = pending;
            if (it !== null) setPending(null);
            if (it !== null) void commit(it);
        }, delayMs);
        return token;
    }

    function undo(token: number) {
        // Stale token — the delete it referred to has already committed. See (2).
        if (seq !== token) return;
        settle();
    }

    return { schedule, undo, flush, getPending: () => pending };
}
