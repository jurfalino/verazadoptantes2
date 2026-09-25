import { describe, it, expect } from 'vitest';
import { mergeMessages, nextSince, unreadAdminCount, type ChatThreadMessage } from './chatThread';

/**
 * The three bugs this exists to prevent, all reported together on 2026-09-24.
 *
 * 1. A sent message appeared TWICE. The widget inserted an optimistic bubble
 *    under a fabricated `local-<Date.now()>` id — it read the real id from a
 *    response header (`x-chat-local-id`) that no route has ever set. Dedupe is
 *    by id, so the server's row for that same message looked new and was
 *    appended next to the optimistic copy.
 *
 * 2. An admin reply never arrived unless the page was reloaded after it was
 *    written. Nothing polled while the panel was closed.
 *
 * 3. No activity indicator appeared when a reply landed — same cause as 2, plus
 *    a `chat_last_seen_at` that older builds wrote in CLIENT-clock milliseconds
 *    while every server timestamp is second-truncated server time. A viewer
 *    whose clock ran fast has a last-seen value in the future, which suppresses
 *    the indicator for every reply that follows.
 *
 * These are the pure parts of the fix. The widget is a thin shell over them.
 */

const msg = (over: Partial<ChatThreadMessage> & { id: string }): ChatThreadMessage => ({
    direction: 'user',
    body: 'hola',
    createdAt: 1_000_000,
    ...over,
});

describe('mergeMessages', () => {
    it('dedupes the server row against the optimistic copy of the same message', () => {
        // The fix: the optimistic bubble carries the server-assigned id, so the
        // row that comes back on the next poll matches and merges instead of
        // appending. This is bug 1.
        const optimistic = [msg({ id: 'srv-1', body: 'Holaa ¿Que países cubre?', createdAt: 1_790_267_859_000 })];
        const fromServer = [msg({ id: 'srv-1', body: 'Holaa ¿Que países cubre?', createdAt: 1_790_267_859_000 })];
        expect(mergeMessages(optimistic, fromServer)).toHaveLength(1);
    });

    it('keeps the thread in timestamp order when a reply arrives out of order', () => {
        const prev = [msg({ id: 'b', createdAt: 2_000 })];
        const incoming = [msg({ id: 'a', createdAt: 1_000 }), msg({ id: 'c', createdAt: 3_000 })];
        expect(mergeMessages(prev, incoming).map(m => m.id)).toEqual(['a', 'b', 'c']);
    });

    it('returns the SAME array when nothing is new', () => {
        // Load-bearing. The poll cursor is inclusive (`>=`) so every tick
        // re-returns the message it points at. A fresh array on each tick would
        // retrigger the effects keyed on `messages` — restarting the poll
        // interval and re-running the smooth-scroll — several times a minute.
        const prev = [msg({ id: 'a', createdAt: 1_000 }), msg({ id: 'b', createdAt: 2_000 })];
        expect(mergeMessages(prev, [msg({ id: 'b', createdAt: 2_000 })])).toBe(prev);
        expect(mergeMessages(prev, [])).toBe(prev);
    });

    it('ignores rows with no usable id rather than rendering a keyless bubble', () => {
        const prev: ChatThreadMessage[] = [];
        expect(mergeMessages(prev, [msg({ id: '' }), msg({ id: 'ok' })]).map(m => m.id)).toEqual(['ok']);
    });

    it('tolerates a non-array payload from a degraded response', () => {
        const prev = [msg({ id: 'a' })];
        expect(mergeMessages(prev, undefined)).toBe(prev);
        expect(mergeMessages(prev, null)).toBe(prev);
    });
});

describe('nextSince', () => {
    it('is the newest timestamp held, not the last element', () => {
        // Defensive: the cursor must not walk backwards if the array is ever
        // handed to us unsorted.
        const messages = [msg({ id: 'a', createdAt: 5_000 }), msg({ id: 'b', createdAt: 2_000 })];
        expect(nextSince(messages)).toBe(5_000);
    });

    it('is 0 for an empty thread so the first fetch asks for all history', () => {
        expect(nextSince([])).toBe(0);
    });

    it('ignores timestamps that are not finite numbers', () => {
        const messages = [msg({ id: 'a', createdAt: 3_000 }), msg({ id: 'b', createdAt: NaN })];
        expect(nextSince(messages)).toBe(3_000);
    });
});

describe('unreadAdminCount', () => {
    it('counts admin replies newer than what the viewer has seen', () => {
        const messages = [
            msg({ id: 'u', direction: 'user', createdAt: 1_000 }),
            msg({ id: 'a1', direction: 'admin', createdAt: 2_000 }),
            msg({ id: 'a2', direction: 'admin', createdAt: 3_000 }),
        ];
        expect(unreadAdminCount(messages, 1_000)).toBe(2);
        expect(unreadAdminCount(messages, 2_000)).toBe(1);
        expect(unreadAdminCount(messages, 3_000)).toBe(0);
    });

    it('never counts the viewer\'s own messages', () => {
        const messages = [msg({ id: 'u', direction: 'user', createdAt: 9_000 })];
        expect(unreadAdminCount(messages, 0)).toBe(0);
    });

    it('still reports a reply when last-seen is a poisoned future value', () => {
        // Bug 3's silent half. Builds before this fix persisted last-seen from
        // the optimistic bubble's CLIENT clock. A viewer whose clock ran 30s
        // fast stored a timestamp no server row will ever exceed, so the
        // indicator stayed dark forever. A last-seen ahead of everything we
        // hold cannot be true, so it is not trusted.
        const messages = [
            msg({ id: 'u', direction: 'user', createdAt: 1_790_286_049_000 }),
            msg({ id: 'a', direction: 'admin', createdAt: 1_790_286_089_000 }),
        ];
        const poisoned = 1_790_286_049_000 + 30_000; // clock 30s fast, > the reply
        expect(unreadAdminCount(messages, poisoned)).toBe(1);
    });

    it('treats a last-seen equal to the newest reply as read', () => {
        const messages = [msg({ id: 'a', direction: 'admin', createdAt: 4_000 })];
        expect(unreadAdminCount(messages, 4_000)).toBe(0);
    });

    it('counts everything when nothing has been seen yet', () => {
        const messages = [msg({ id: 'a', direction: 'admin', createdAt: 4_000 })];
        expect(unreadAdminCount(messages, 0)).toBe(1);
    });
});

/**
 * The reported sequence, end to end, in the units the wire actually carries.
 *
 * `POST /api/chat` now answers `{ id, createdAt }` where `createdAt` is the
 * whole second the row holds, and `GET` filters `created_at >= since`. Those two
 * facts are what make this walk through cleanly; before them, step 2 produced a
 * second bubble and step 4 could never light the indicator.
 */
describe('the reported sequence', () => {
    const SENT_AT = 1_790_286_049_000;   // whole second, as the route returns it
    const REPLIED_AT = 1_790_286_089_000; // admin, 40s later — the real staging case

    it('sends, polls, reloads and is answered without ever duplicating', () => {
        // 1. Visitor sends. The bubble carries the SERVER id and timestamp.
        const sentRow: ChatThreadMessage = { id: 'srv-user-1', direction: 'user', body: '¿Que países cubre?', createdAt: SENT_AT };
        let thread = mergeMessages([], [sentRow]);
        expect(thread).toHaveLength(1);

        // 2. Next poll. The cursor is inclusive, so the server re-sends that very
        //    row — the case that used to duplicate. Identity-stable no-op now.
        expect(nextSince(thread)).toBe(SENT_AT);
        const afterPoll = mergeMessages(thread, [sentRow]);
        expect(afterPoll).toBe(thread);

        // 3. Visitor reloads, or navigates and the widget refetches from scratch.
        const afterReload = mergeMessages(thread, [sentRow]);
        expect(afterReload).toHaveLength(1);

        // 4. Admin replies 40s later, panel CLOSED. The background poll picks it
        //    up and the indicator lights — the visitor reads nothing yet.
        const reply: ChatThreadMessage = { id: 'srv-admin-1', direction: 'admin', body: 'Cualquier país', createdAt: REPLIED_AT };
        thread = mergeMessages(thread, [reply]);
        expect(thread).toHaveLength(2);
        expect(unreadAdminCount(thread, SENT_AT)).toBe(1);

        // 5. Visitor opens the panel: read, cursor advanced, no re-duplication.
        const seen = nextSince(thread);
        expect(seen).toBe(REPLIED_AT);
        expect(unreadAdminCount(thread, seen)).toBe(0);
        expect(mergeMessages(thread, [reply])).toBe(thread);
    });

    it('delivers a second reply written in the same whole second as the first', () => {
        // `created_at` has one-second resolution. With an exclusive cursor this
        // reply was unreachable by polling for the life of the conversation.
        const first: ChatThreadMessage = { id: 'a1', direction: 'admin', body: 'una', createdAt: REPLIED_AT };
        const second: ChatThreadMessage = { id: 'a2', direction: 'admin', body: 'dos', createdAt: REPLIED_AT };
        const thread = mergeMessages([first], [first, second]); // what `>=` returns
        expect(thread.map(m => m.id)).toEqual(['a1', 'a2']);
        expect(unreadAdminCount(thread, 0)).toBe(2);
    });
});
