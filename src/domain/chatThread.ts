/**
 * Support-chat thread arithmetic: how incoming rows join the thread, where the
 * poll cursor sits, and what counts as unread.
 *
 * Pure by design, for the same reason `chatAccess.ts` is: these three rules are
 * where all three bugs reported on 2026-09-24 lived, and none of them could be
 * exercised while they were inline in a component with no DOM test harness.
 *
 * One invariant runs through all of it: **every timestamp here is server time,
 * in milliseconds.** The widget must never mix in a `Date.now()` of its own.
 * `chat_messages.created_at` defaults to `strftime('%s','now')` — whole seconds
 * of SERVER clock — and a visitor's clock is routinely tens of seconds off. A
 * client-clock value in this arithmetic silently breaks the cursor (replies
 * excluded by a `since` in the future) and the indicator (a last-seen no row
 * will ever exceed).
 */

export interface ChatThreadMessage {
    id: string;
    direction: 'user' | 'admin';
    body: string;
    /** Server time, milliseconds. Never the client's clock. */
    createdAt: number;
}

/**
 * Fold server rows into the thread, deduping by id.
 *
 * Returns `prev` **by identity** when nothing is new. The poll cursor is
 * inclusive, so a steady-state tick re-returns the message it points at; a
 * fresh array every time would retrigger every effect keyed on the thread.
 */
export function mergeMessages(
    prev: ChatThreadMessage[],
    incoming: ChatThreadMessage[] | null | undefined,
): ChatThreadMessage[] {
    if (!Array.isArray(incoming) || incoming.length === 0) return prev;

    const seen = new Set(prev.map(m => m.id));
    const added: ChatThreadMessage[] = [];
    for (const m of incoming) {
        if (!m?.id || seen.has(m.id)) continue;
        seen.add(m.id);
        added.push(m);
    }
    if (added.length === 0) return prev;

    return [...prev, ...added].sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * The `since` to ask for next: the newest server timestamp the client holds.
 *
 * Max rather than the last element, so the cursor cannot walk backwards if the
 * array ever reaches us unsorted. The server filter is inclusive (`>=`), which
 * costs one re-sent row per poll and in exchange stops dropping a message
 * written in the same whole second as the cursor — two admin replies inside one
 * second used to mean the second one was never delivered by polling at all.
 */
export function nextSince(messages: ChatThreadMessage[]): number {
    let newest = 0;
    for (const m of messages) {
        if (Number.isFinite(m.createdAt) && m.createdAt > newest) newest = m.createdAt;
    }
    return newest;
}

/**
 * How many admin replies the viewer has not seen.
 *
 * `lastSeenAt` is clamped to the newest message we actually hold. A last-seen
 * ahead of the whole thread cannot be true — it is what older builds wrote from
 * the optimistic bubble's client clock — and trusting it left the indicator dark
 * for every reply that followed. Erring towards showing the indicator once is
 * the right way to be wrong here: an extra dot is noise, a missed reply is a
 * visitor who thinks nobody answered.
 */
export function unreadAdminCount(messages: ChatThreadMessage[], lastSeenAt: number): number {
    const newest = nextSince(messages);
    const seenUpTo = Number.isFinite(lastSeenAt) ? Math.min(Math.max(lastSeenAt, 0), newest) : 0;
    let count = 0;
    for (const m of messages) {
        if (m.direction === 'admin' && m.createdAt > seenUpTo) count++;
    }
    return count;
}
