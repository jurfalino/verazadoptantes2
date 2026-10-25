/**
 * The only browser door to a merge. Real SQL (in-memory SQLite) for the
 * candidate / flag / adopter lookups; the merge and the merge request are
 * spies (the request flow end to end: mergePendingDedupPair.request.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

const { state, mergeSpy, requestSpy, notifySpy, grantSpy } = vi.hoisted(() => ({
    state: { db: null as unknown, user: null as string | null },
    mergeSpy: vi.fn(),
    requestSpy: vi.fn(),
    notifySpy: vi.fn(),
    grantSpy: vi.fn(async () => 0),
}));

vi.mock('./_db', () => ({
    getDb: async () => state.db,
    getUser: async () => { if (!state.user) throw new Error('Authentication required'); return state.user; },
}));
vi.mock('@/lib/adopterMerge', () => ({ mergeAdopters: mergeSpy, notifyMergeOwners: vi.fn() }));
vi.mock('@/lib/mergeRequests', () => ({ createMergeRequest: requestSpy, keepSeparate: vi.fn(), declinedForViewer: async () => false }));
vi.mock('@/lib/mergeAccess', () => ({ grantAccessAfterFold: grantSpy }));
vi.mock('@/config/admins', () => ({ isAdminAsync: async () => false }));
vi.mock('./householdMembers', () => ({ addHouseholdMember: vi.fn() }));
vi.mock('./notifications', () => ({
    createNotification: notifySpy,
    resolveDisplayName: async (e: string) => e.split('@')[0],
    resolveDisplayNames: async (emails: string[]) => new Map(emails.map(e => [e.toLowerCase(), e.split('@')[0]])),
}));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn() }));
// Team rule: the owner plus one teammate.
vi.mock('@/lib/orgMembership', () => ({
    isOwnerOrOrgMate: async (viewer: string, owner: string | null) =>
        viewer === owner || (viewer === 'me@example.com' && owner === 'mate@example.com'),
    normEmail: (e: string | null | undefined) => (e ?? '').trim().toLowerCase(),
}));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(() => 'err12345'), debug: vi.fn() },
    generateErrorId: () => 'gen12345',
}));

import { mergePendingDedupPair } from './duplicates';

const OWNER = 'me@example.com';
function seed() {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
        CREATE TABLE adopters (id TEXT, name TEXT, added_by TEXT, created_at INTEGER, deleted_at INTEGER);
        CREATE TABLE duplicate_candidates (id TEXT, adopter1_id TEXT, adopter2_id TEXT, status TEXT, match_types TEXT);
        CREATE TABLE adopter_flags (id TEXT, adopter_id TEXT, target_adopter_id TEXT, reason TEXT, details TEXT);
        INSERT INTO adopters VALUES ('mine-new', 'Eva', '${OWNER}', 2000, NULL), ('other-old', 'Eva', 'other@example.com', 1000, NULL),
                                    ('mine-old', 'Eva', '${OWNER}', 100, NULL), ('other-new', 'Eva', 'other@example.com', 5000, NULL),
                                    ('mate-new', 'Eva', 'mate@example.com', 3000, NULL),
                                    ('x', 'Eva', 'a@example.com', 1, NULL), ('y', 'Eva', 'b@example.com', 2, NULL);
        INSERT INTO duplicate_candidates VALUES ('cand-mine', 'mine-new', 'other-old', 'pending', '["phone"]'),
                                                ('cand-absorb-foreign', 'mine-old', 'other-new', 'pending', '["phone"]'),
                                                ('cand-foreign', 'x', 'y', 'pending', '["phone"]'),
                                                ('cand-done', 'mine-new', 'other-old', 'merged', '["phone"]');
        INSERT INTO adopter_flags VALUES ('flag-cross', 'other-old', 'mine-new', 'duplicate', NULL),
                                         ('flag-team', 'mine-old', 'mate-new', 'duplicate', NULL);
    `);
    state.db = drizzle(sqlite);
}

describe('mergePendingDedupPair', () => {
    beforeEach(() => {
        seed();
        mergeSpy.mockReset().mockResolvedValue({ success: true, primaryName: 'Vieja', secondaryName: 'Nueva', auditId: 'audit-1' });
        requestSpy.mockReset().mockResolvedValue({ id: 'req-1', created: true });
        notifySpy.mockReset();
        grantSpy.mockClear();
        state.user = OWNER;
    });

    it('anonymous: refused with an errorId, nothing merged', async () => {
        state.user = null;
        expect(await mergePendingDedupPair('cand-mine')).toEqual({ success: false, error: 'unauthenticated', errorId: 'gen12345' });
        expect(mergeSpy).not.toHaveBeenCalled();
    });

    it('a rescuer who owns neither side: refused', async () => {
        state.user = 'stranger@example.com';
        expect(await mergePendingDedupPair('cand-mine')).toMatchObject({ success: false, error: 'not_yours' });
        expect(await mergePendingDedupPair('cand-foreign')).toMatchObject({ success: false, error: 'not_yours' });
        expect(mergeSpy).not.toHaveBeenCalled();
    });

    it('her newer record folds into a foreign older one: merged, the foreign record survives, actor from the session', async () => {
        expect(await mergePendingDedupPair('cand-mine')).toEqual({ success: true, outcome: 'merged' });
        expect(mergeSpy).toHaveBeenCalledWith('other-old', 'mine-new', OWNER);
        expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'adopter_merged', userId: 'other@example.com', url: '/adopter/other-old' }));
        expect(requestSpy).not.toHaveBeenCalled();
        // D40: the absorbed side's owner keeps seeing what their profile brought
        // (not the whole survivor: the other rescuer never agreed — final review C1).
        expect(grantSpy).toHaveBeenCalledWith(state.db, {
            survivorId: 'other-old', absorbedOwnerEmail: OWNER, actor: OWNER, mergeAuditId: 'audit-1',
            access: { scope: 'absorbed_entries', absorbedId: 'mine-new' },
        });
    });

    // Since merge requests (spec D2/D10/D14) these two ask the other owner
    // instead of refusing — still never absorbing another rescuer's profile.
    it('her record is older and the other is foreign: a merge request, never a merge', async () => {
        expect(await mergePendingDedupPair('cand-absorb-foreign')).toMatchObject({ success: true, outcome: 'requested' });
        expect(requestSpy).toHaveBeenCalledWith(state.db, {
            primaryId: 'mine-old', secondaryId: 'other-new', candidateId: 'cand-absorb-foreign', flagId: null,
            requesterEmail: OWNER, ownerEmail: 'other@example.com',
        });
        expect(mergeSpy).not.toHaveBeenCalled();
    });

    it('a self-filed flag across owners, keeping mine: a merge request (carrying the flag id), never a merge', async () => {
        expect(await mergePendingDedupPair('flag-cross', { keepId: 'mine-new' })).toMatchObject({ success: true, outcome: 'requested' });
        expect(requestSpy).toHaveBeenCalledWith(state.db, {
            primaryId: 'mine-new', secondaryId: 'other-old', candidateId: null, flagId: 'flag-cross',
            requesterEmail: OWNER, ownerEmail: 'other@example.com',
        });
        expect(mergeSpy).not.toHaveBeenCalled();
    });

    it("a self-filed flag across owners, keeping the other's (the default, older): merged now (D41)", async () => {
        expect(await mergePendingDedupPair('flag-cross')).toEqual({ success: true, outcome: 'merged' });
        expect(mergeSpy).toHaveBeenCalledWith('other-old', 'mine-new', OWNER);
        expect(requestSpy).not.toHaveBeenCalled();
    });

    it('a flag inside her team: merged, her older record survives, nobody to notify', async () => {
        expect(await mergePendingDedupPair('flag-team')).toEqual({ success: true, outcome: 'merged' });
        expect(mergeSpy).toHaveBeenCalledWith('mine-old', 'mate-new', OWNER);
        expect(notifySpy).not.toHaveBeenCalled();
    });

    it('unknown or already-resolved candidate: refused', async () => {
        expect(await mergePendingDedupPair('nope')).toMatchObject({ success: false, error: 'not_found' });
        expect(await mergePendingDedupPair('cand-done')).toMatchObject({ success: false, error: 'not_found' });
        expect(mergeSpy).not.toHaveBeenCalled();
    });

    it('a failed merge returns an errorId, never the raw error', async () => {
        mergeSpy.mockResolvedValue({ success: false, error: 'SQLITE_BUSY internal detail' });
        expect(await mergePendingDedupPair('cand-mine')).toEqual({ success: false, error: 'merge_failed', errorId: 'err12345' });
    });
});
