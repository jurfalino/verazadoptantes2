/**
 * The only browser door to a merge. Real SQL (in-memory SQLite) for the
 * candidate / flag / adopter lookups; the merge itself is a spy.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

const { state, mergeSpy } = vi.hoisted(() => ({
    state: { db: null as unknown, user: null as string | null },
    mergeSpy: vi.fn(),
}));

vi.mock('./_db', () => ({
    getDb: async () => state.db,
    getUser: async () => { if (!state.user) throw new Error('Authentication required'); return state.user; },
}));
vi.mock('@/lib/adopterMerge', () => ({ mergeAdopters: mergeSpy }));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn() }));
// Team rule: the owner plus one teammate.
vi.mock('@/lib/orgMembership', () => ({
    isOwnerOrOrgMate: async (viewer: string, owner: string | null) =>
        viewer === owner || (viewer === 'me@example.com' && owner === 'mate@example.com'),
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
        CREATE TABLE adopters (id TEXT, added_by TEXT, created_at INTEGER, deleted_at INTEGER);
        CREATE TABLE duplicate_candidates (id TEXT, adopter1_id TEXT, adopter2_id TEXT, status TEXT);
        CREATE TABLE adopter_flags (id TEXT, adopter_id TEXT, target_adopter_id TEXT, reason TEXT);
        INSERT INTO adopters VALUES ('mine-new', '${OWNER}', 2000, NULL), ('other-old', 'other@example.com', 1000, NULL),
                                    ('mine-old', '${OWNER}', 100, NULL), ('other-new', 'other@example.com', 5000, NULL),
                                    ('mate-new', 'mate@example.com', 3000, NULL),
                                    ('x', 'a@example.com', 1, NULL), ('y', 'b@example.com', 2, NULL);
        INSERT INTO duplicate_candidates VALUES ('cand-mine', 'mine-new', 'other-old', 'pending'),
                                                ('cand-absorb-foreign', 'mine-old', 'other-new', 'pending'),
                                                ('cand-foreign', 'x', 'y', 'pending'),
                                                ('cand-done', 'mine-new', 'other-old', 'merged');
        INSERT INTO adopter_flags VALUES ('flag-cross', 'other-old', 'mine-new', 'duplicate'),
                                         ('flag-team', 'mine-old', 'mate-new', 'duplicate');
    `);
    state.db = drizzle(sqlite);
}

describe('mergePendingDedupPair', () => {
    beforeEach(() => {
        seed();
        mergeSpy.mockReset().mockResolvedValue({ success: true });
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
        expect(await mergePendingDedupPair('cand-mine')).toEqual({ success: true });
        expect(mergeSpy).toHaveBeenCalledWith('other-old', 'mine-new', OWNER);
    });

    it('her record is older and the other is foreign: refused — never absorbs another rescuer\'s profile', async () => {
        expect(await mergePendingDedupPair('cand-absorb-foreign')).toMatchObject({ success: false, error: 'other_owner' });
        expect(mergeSpy).not.toHaveBeenCalled();
    });

    it('a self-filed flag across owners: refused', async () => {
        expect(await mergePendingDedupPair('flag-cross')).toMatchObject({ success: false, error: 'flag_cross_owner' });
        expect(mergeSpy).not.toHaveBeenCalled();
    });

    it('a flag inside her team: merged, her older record survives', async () => {
        expect(await mergePendingDedupPair('flag-team')).toEqual({ success: true });
        expect(mergeSpy).toHaveBeenCalledWith('mine-old', 'mate-new', OWNER);
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
