'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createUndoQueue } from '@/lib/undoQueue';

/** How long the user has to undo before the delete actually commits. */
export const UNDO_DELAY_MS = 5000;

/**
 * Optimistic delete with an undo window, for the contact-entry lists.
 *
 * All of the sequencing lives in `createUndoQueue` (`src/lib/undoQueue.ts`) and
 * is unit tested there — read that file for *why* scheduling commits rather
 * than cancels, why undo is token-keyed, and why unmount flushes. This hook is
 * only the React binding.
 *
 * @param commit - performs the real deletion. Read through a ref, so the timer
 *                 always runs the latest closure and callers can safely use
 *                 current props inside it.
 */
export function useUndoableDelete<T>(commit: (item: T) => void | Promise<void>) {
    const [pending, setPending] = useState<T | null>(null);

    const commitRef = useRef(commit);
    useEffect(() => { commitRef.current = commit; });

    const queue = useMemo(
        () => createUndoQueue<T>({
            delayMs: UNDO_DELAY_MS,
            commit: (item) => commitRef.current(item),
            onPendingChange: setPending,
        }),
        [],
    );

    // Commit rather than drop on unmount: the undo toast is rendered by the
    // layout-level provider and outlives this component, so cancelling here
    // would leave a "deleted — undo" toast for a delete that never happened.
    useEffect(() => () => { queue.flush(); }, [queue]);

    return { pending, schedule: queue.schedule, undo: queue.undo };
}
