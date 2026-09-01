import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createUndoQueue } from './undoQueue';

const DELAY = 5000;

function setup() {
    const commit = vi.fn();
    const onPendingChange = vi.fn();
    const q = createUndoQueue<string>({ delayMs: DELAY, commit, onPendingChange });
    return { q, commit, onPendingChange };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createUndoQueue', () => {
    it('commits after the delay', () => {
        const { q, commit } = setup();
        q.schedule('a');
        expect(commit).not.toHaveBeenCalled();
        vi.advanceTimersByTime(DELAY);
        expect(commit).toHaveBeenCalledExactlyOnceWith('a');
    });

    it('does not commit before the delay elapses', () => {
        const { q, commit } = setup();
        q.schedule('a');
        vi.advanceTimersByTime(DELAY - 1);
        expect(commit).not.toHaveBeenCalled();
    });

    it('exposes the pending item while it is in the window', () => {
        const { q } = setup();
        q.schedule('a');
        expect(q.getPending()).toBe('a');
        vi.advanceTimersByTime(DELAY);
        expect(q.getPending()).toBeNull();
    });

    it('undo cancels the commit entirely', () => {
        const { q, commit } = setup();
        const token = q.schedule('a');
        q.undo(token);
        vi.advanceTimersByTime(DELAY * 3);
        expect(commit).not.toHaveBeenCalled();
        expect(q.getPending()).toBeNull();
    });

    // Behaviour 1: the inline implementation this replaces CANCELLED the first
    // delete here, so it silently never happened.
    it('scheduling a second delete commits the first immediately', () => {
        const { q, commit } = setup();
        q.schedule('a');
        q.schedule('b');
        expect(commit).toHaveBeenCalledExactlyOnceWith('a');
        vi.advanceTimersByTime(DELAY);
        expect(commit).toHaveBeenCalledTimes(2);
        expect(commit).toHaveBeenLastCalledWith('b');
    });

    // Behaviour 2: toasts stack and outlive their action, so an old toast's
    // Undo must not cancel a newer delete.
    it('ignores a stale token so an old toast cannot cancel a newer delete', () => {
        const { q, commit } = setup();
        const tokenA = q.schedule('a');
        q.schedule('b');          // commits 'a', 'b' now pending
        commit.mockClear();

        q.undo(tokenA);           // the stale toast's Undo — must be a no-op

        expect(q.getPending()).toBe('b');
        vi.advanceTimersByTime(DELAY);
        expect(commit).toHaveBeenCalledExactlyOnceWith('b');
    });

    it('undo with a token from an already-committed delete does nothing', () => {
        const { q, commit } = setup();
        const token = q.schedule('a');
        vi.advanceTimersByTime(DELAY);
        commit.mockClear();
        q.undo(token);
        vi.advanceTimersByTime(DELAY);
        expect(commit).not.toHaveBeenCalled();
    });

    // Behaviour 3: unmount must commit, not drop.
    it('flush commits immediately without waiting', () => {
        const { q, commit } = setup();
        q.schedule('a');
        q.flush();
        expect(commit).toHaveBeenCalledExactlyOnceWith('a');
        expect(q.getPending()).toBeNull();
    });

    it('flush is a no-op when nothing is pending', () => {
        const { q, commit } = setup();
        q.flush();
        expect(commit).not.toHaveBeenCalled();
    });

    it('does not double-commit when flush races the timer', () => {
        const { q, commit } = setup();
        q.schedule('a');
        q.flush();
        vi.advanceTimersByTime(DELAY * 2);
        expect(commit).toHaveBeenCalledTimes(1);
    });

    it('notifies pending changes so the UI can hide and restore the row', () => {
        const { q, onPendingChange } = setup();
        const token = q.schedule('a');
        expect(onPendingChange).toHaveBeenLastCalledWith('a');
        q.undo(token);
        expect(onPendingChange).toHaveBeenLastCalledWith(null);
    });

    it('survives many sequential deletes, committing each exactly once', () => {
        const { q, commit } = setup();
        for (const id of ['a', 'b', 'c', 'd']) q.schedule(id);
        vi.advanceTimersByTime(DELAY);
        expect(commit.mock.calls.map(c => c[0])).toEqual(['a', 'b', 'c', 'd']);
    });
});
