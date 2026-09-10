/**
 * Who may read and append to a support conversation.
 *
 * Pure by design: this is the rule that stops one account reading another's
 * support thread, and it belongs somewhere it can be tested exhaustively rather
 * than inline in two route handlers that are awkward to exercise.
 *
 * Background (v2.56.44): the conversation id lived in localStorage keyed to the
 * browser, and `GET /api/chat` performed no authorization at all. Logging out
 * and in as someone else on the same device showed the second account the
 * first account's conversation.
 */

function normaliseEmail(value: string | null | undefined): string {
    return (value || '').trim().toLowerCase();
}

/**
 * A conversation with no owner is an anonymous one: its only gate ever was the
 * unguessable UUID, and tightening that would lock visitors out of a thread
 * they are in the middle of. A conversation WITH an owner requires an exact
 * match on the signed-in address.
 */
export function canAccessConversation(opts: {
    conversationUserEmail: string | null | undefined;
    sessionEmail: string | null | undefined;
}): boolean {
    const owner = normaliseEmail(opts.conversationUserEmail);
    if (!owner) return true;
    return owner === normaliseEmail(opts.sessionEmail);
}

/**
 * The identity a stored conversation is filed under on the client. Signing in
 * yields a different key from being signed out, so the widget starts a fresh
 * conversation instead of carrying an anonymous one into an account.
 */
export function conversationOwnerKey(email: string | null | undefined): string {
    return normaliseEmail(email) || 'anon';
}
