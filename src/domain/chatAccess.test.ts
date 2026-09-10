import { describe, it, expect } from 'vitest';
import { canAccessConversation, conversationOwnerKey } from './chatAccess';

/**
 * The bug this exists to prevent (v2.56.44): the conversation id lived in
 * localStorage keyed to the BROWSER, and `GET /api/chat` never called `auth()`.
 * Signing out and back in as someone else on the same device handed the second
 * account the first account's support thread — on a platform whose whole
 * subject is sensitive information about named people.
 *
 * These are the rules that close it. They are deliberately boring: an
 * authorization check that is clever is an authorization check that is wrong.
 */

describe('canAccessConversation', () => {
    it('allows the owner', () => {
        expect(canAccessConversation({ conversationUserEmail: 'ana@example.org', sessionEmail: 'ana@example.org' })).toBe(true);
    });

    it('denies a different signed-in account — the account-switch leak', () => {
        expect(canAccessConversation({ conversationUserEmail: 'ana@example.org', sessionEmail: 'luis@example.org' })).toBe(false);
    });

    it('denies an anonymous viewer holding an owned conversation id', () => {
        expect(canAccessConversation({ conversationUserEmail: 'ana@example.org', sessionEmail: null })).toBe(false);
        expect(canAccessConversation({ conversationUserEmail: 'ana@example.org', sessionEmail: '' })).toBe(false);
    });

    // Anonymous threads have no identity to check against, so the unguessable
    // UUID is the only gate they ever had. Keep that behaviour rather than
    // locking visitors out of their own in-flight conversation.
    it('allows an unowned conversation for anyone holding the id', () => {
        expect(canAccessConversation({ conversationUserEmail: null, sessionEmail: null })).toBe(true);
        expect(canAccessConversation({ conversationUserEmail: null, sessionEmail: 'ana@example.org' })).toBe(true);
        expect(canAccessConversation({ conversationUserEmail: '', sessionEmail: null })).toBe(true);
        expect(canAccessConversation({ conversationUserEmail: undefined, sessionEmail: undefined })).toBe(true);
    });

    it('compares case-insensitively and ignores surrounding whitespace', () => {
        expect(canAccessConversation({ conversationUserEmail: 'Ana@Example.org', sessionEmail: 'ana@example.ORG' })).toBe(true);
        expect(canAccessConversation({ conversationUserEmail: ' ana@example.org ', sessionEmail: 'ana@example.org' })).toBe(true);
    });

    it('does not treat a whitespace-only owner as a real owner', () => {
        expect(canAccessConversation({ conversationUserEmail: '   ', sessionEmail: null })).toBe(true);
    });

    it('never matches on a prefix or substring', () => {
        expect(canAccessConversation({ conversationUserEmail: 'ana@example.org', sessionEmail: 'ana@example.org.attacker.com' })).toBe(false);
        expect(canAccessConversation({ conversationUserEmail: 'ana@example.org', sessionEmail: 'ana@example.or' })).toBe(false);
    });
});

describe('conversationOwnerKey', () => {
    it('normalises an email the same way the access check does', () => {
        expect(conversationOwnerKey(' Ana@Example.org ')).toBe('ana@example.org');
    });

    it('collapses every anonymous case to one key', () => {
        expect(conversationOwnerKey(null)).toBe('anon');
        expect(conversationOwnerKey(undefined)).toBe('anon');
        expect(conversationOwnerKey('')).toBe('anon');
        expect(conversationOwnerKey('   ')).toBe('anon');
    });

    // The client compares this key to decide whether to keep or discard a
    // stored conversation. Signing in has to count as a change of owner, or an
    // anonymous thread silently attaches itself to whoever logs in next.
    it('gives signing in a different key from being anonymous', () => {
        expect(conversationOwnerKey('ana@example.org')).not.toBe(conversationOwnerKey(null));
    });
});
