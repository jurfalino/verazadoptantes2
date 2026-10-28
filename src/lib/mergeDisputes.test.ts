/**
 * Disputes about a merge that already happened (D50, spec 2026-10-25
 * pendientes D, addendum 2026-10-26): the owner team of either profile says
 * «No es la misma persona», the admins see it and undo the merge (the existing
 * unmergeAdopters, by the merge's audit id) or keep it; both rescuers hear the
 * outcome. Real SQL, the real immediate merge (mergePendingDedupPair), real
 * mergeAdopters / unmergeAdopters behind passthrough spies; the session is the
 * only source of the actor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { session, OWNER, MATE, STRANGER, ADMIN } = mocks;

const { state, notify } = vi.hoisted(() => ({
    state: { db: null as unknown },
    notify: { create: [] as Array<Record<string, unknown>>, admins: [] as Array<Record<string, unknown>> },
}));

vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/config/admins', () => ({ isAdminAsync: mocks.isAdmin, isModeratorOrAdminAsync: mocks.isAdmin }));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOrgMate: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    isOwnerOrOrgMate: (v: string | null | undefined, o: string | null | undefined) => mocks.isOwnerOrOrgMate(v?.trim().toLowerCase(), o?.trim().toLowerCase()),
    getTeamEmails: async (email: string) => mocks.getOrgMemberEmailsFor((email ?? '').trim().toLowerCase()),
}));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async () => undefined) }));
vi.mock('@/app/actions/notifications', () => ({
    createNotification: vi.fn(async (d: Record<string, unknown>) => { notify.create.push(d); return 'n'; }),
    notifyAdmins: vi.fn(async (d: Record<string, unknown>) => { notify.admins.push(d); }),
    resolveDisplayName: vi.fn(async (email: string) => email.split('@')[0]),
    resolveDisplayNames: vi.fn(async (emails: string[]) => new Map(emails.map(e => [e.toLowerCase(), e.split('@')[0]]))),
}));
vi.mock('@/lib/adopterMerge', async (orig) => {
    const actual = await orig<typeof import('@/lib/adopterMerge')>();
    return { ...actual, mergeAdopters: vi.fn(actual.mergeAdopters), unmergeAdopters: vi.fn(actual.unmergeAdopters) };
});
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
}));

import { mergePendingDedupPair } from '@/app/actions/duplicates';
import { getMergeDisputeOption, raiseMergeDispute, resolveMergeDispute } from '@/app/actions/mergeDisputes';
import { listMergeDisputesForAdmin } from '@/lib/mergeDisputes';
import { unmergeAdopters } from '@/lib/adopterMerge';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };
const unmergeSpy = vi.mocked(unmergeAdopters);
const disputes = () => sqlite.prepare('SELECT * FROM merge_disputes').all();
const deleted = (id: string) => sqlite.prepare('SELECT deleted_at FROM adopters WHERE id = ?').get(id)!.deleted_at !== null;
const candidate = (id: string) => sqlite.prepare('SELECT status FROM duplicate_candidates WHERE id = ?').get(id)!.status;
const liveGrantsOn = (id: string) => sqlite.prepare(`SELECT grantee_email AS email FROM pii_access_grants WHERE adopter_id = ? AND revoked_at IS NULL ORDER BY grantee_email`).all(id).map(r => r.email);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the drizzle handle under test
const db = () => state.db as any;

const as = async <T>(user: string | null, fn: () => Promise<T>): Promise<T> => {
    const before = session.user;
    session.user = user;
    try { return await fn(); } finally { session.user = before; }
};

/** OWNER folds their «theirs-new» into STRANGER's «mine-old» straight away (D24): the merge STRANGER may dispute. */
async function ownerMergesIntoMine(): Promise<string> {
    expect(await as(OWNER, () => mergePendingDedupPair('cand-a', { keepId: 'mine-old' }))).toEqual({ success: true, outcome: 'merged' });
    const notice = notify.create.find(n => n.type === 'adopter_merged')!;
    const auditId = (notice.metadata as { auditId: string }).auditId;
    expect(auditId).toEqual(expect.any(String));
    notify.create.length = 0;
    notify.admins.length = 0;
    return auditId;
}

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    notify.create.length = 0;
    notify.admins.length = 0;
    unmergeSpy.mockClear();
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at, contact_entries) VALUES
        ('mine-old', 'Carla Gómez', '5', ?, 1000, 1000, NULL),
        ('theirs-new', 'Carla Gomez', '5', ?, 2000, 2000, ?),
        ('team-old', 'Ana Díaz', '5', ?, 1000, 1000, NULL), ('team-new', 'Ana Diaz', '5', ?, 2000, 2000, NULL)`)
        .run(STRANGER, OWNER, JSON.stringify([{ id: 'p1', type: 'phone', value: '+54 11 5555 0001' }]), OWNER, MATE);
    sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at) VALUES
        ('cand-a', 'theirs-new', 'mine-old', '["phone","name_full"]', 90, 'high', 'pending', 1),
        ('cand-team', 'team-new', 'team-old', '["phone","name_full"]', 90, 'high', 'pending', 1)`).run();
    session.user = STRANGER;
});

describe('the notice leads to the dispute (D50)', () => {
    it("the kept profile's owner gets adopter_merged with a link that opens «¿No es la misma persona?»", async () => {
        await as(OWNER, () => mergePendingDedupPair('cand-a', { keepId: 'mine-old' }));
        const notice = notify.create.find(n => n.type === 'adopter_merged')!;
        const { auditId } = notice.metadata as { auditId: string };
        expect(notice).toMatchObject({ userId: STRANGER, url: `/adopter/mine-old?dispute=${auditId}` });
        expect(notice.body).toMatch(/Avisale a un administrador desde el perfil\.$/);
    });
});

describe('raiseMergeDispute (D50)', () => {
    it('the kept profile\'s owner raises it: one open dispute, the admins hear it; raising again changes nothing', async () => {
        const auditId = await ownerMergesIntoMine();
        expect(await getMergeDisputeOption(auditId)).toEqual({ canRaise: true, status: 'none' });
        expect(await raiseMergeDispute(auditId)).toEqual({ success: true });
        expect(disputes()).toEqual([expect.objectContaining({
            audit_id: auditId, survivor_id: 'mine-old', absorbed_id: 'theirs-new', raised_by: STRANGER, status: 'open', resolved_by: null,
        })]);
        expect(notify.admins).toEqual([expect.objectContaining({
            type: 'merge_disputed', actorEmail: STRANGER, url: '/admin/merge-requests',
            title: 'stranger dice que no son la misma persona',
        })]);
        expect(notify.create).toEqual([]);
        expect(await raiseMergeDispute(auditId)).toEqual({ success: true });
        expect(disputes()).toHaveLength(1);
        expect(notify.admins).toHaveLength(1);
        expect(await getMergeDisputeOption(auditId)).toEqual({ canRaise: false, status: 'open' });
    });

    it("the absorbed profile's team may raise it too, but not the rescuer who merged", async () => {
        const auditId = await ownerMergesIntoMine();
        expect(await as(OWNER, () => raiseMergeDispute(auditId))).toMatchObject({ success: false, error: 'not_found', errorId: 'gen12345' });
        expect(await as(OWNER, () => getMergeDisputeOption(auditId))).toEqual({ canRaise: false, status: 'none' });
        expect(await as(MATE, () => raiseMergeDispute(auditId))).toEqual({ success: true });
        expect(disputes()).toEqual([expect.objectContaining({ raised_by: MATE })]);
    });

    it('a stranger, a guessed id, a logged-out caller: refused, nothing written or sent', async () => {
        const auditId = await ownerMergesIntoMine();
        expect(await as('nobody@example.com', () => raiseMergeDispute(auditId))).toMatchObject({ success: false, error: 'not_found' });
        expect(await as(ADMIN, () => raiseMergeDispute(auditId))).toMatchObject({ success: false, error: 'not_found' });
        expect(await raiseMergeDispute('no-such-audit')).toMatchObject({ success: false, error: 'not_found' });
        expect(await as(null, () => raiseMergeDispute(auditId))).toMatchObject({ success: false, error: 'unauthenticated' });
        expect(await as(null, () => getMergeDisputeOption(auditId))).toEqual({ canRaise: false, status: 'none' });
        expect(disputes()).toEqual([]);
        expect(notify.admins).toEqual([]);
    });

    it('(M1) superseded before anyone raised it: refused up front with a clear reason, no dispute row, no admin notice', async () => {
        const auditId = await ownerMergesIntoMine();
        sqlite.prepare(`UPDATE adopters SET deleted_at = 5000 WHERE id = 'mine-old'`).run();
        expect(await getMergeDisputeOption(auditId)).toEqual({ canRaise: false, status: 'none' });
        expect(await raiseMergeDispute(auditId)).toMatchObject({ success: false, error: 'superseded', errorId: 'gen12345' });
        expect(disputes()).toEqual([]);
        expect(notify.admins).toEqual([]);
    });

    it('a solo merge (both profiles in the merging team): no one to dispute it', async () => {
        expect(await as(OWNER, () => mergePendingDedupPair('cand-team'))).toEqual({ success: true, outcome: 'merged' });
        const auditId = sqlite.prepare(`SELECT id FROM audit_log WHERE action = 'adopter_merge' AND target = 'team-old'`).get()!.id as string;
        expect(await as(MATE, () => raiseMergeDispute(auditId))).toMatchObject({ success: false, error: 'not_found' });
        expect(disputes()).toEqual([]);
    });
});

describe('resolveMergeDispute (D50)', () => {
    let auditId: string;
    let disputeId: string;
    beforeEach(async () => {
        auditId = await ownerMergesIntoMine();
        expect(await raiseMergeDispute(auditId)).toEqual({ success: true });
        disputeId = disputes()[0].id as string;
        notify.admins.length = 0;
    });

    it('the admin list shows it: which profile stayed, which was absorbed, owners, who raised it', async () => {
        expect(await listMergeDisputesForAdmin(db())).toEqual([expect.objectContaining({
            id: disputeId, auditId, status: 'open', raisedBy: STRANGER, mergedBy: OWNER,
            survivor: expect.objectContaining({ id: 'mine-old', name: 'Carla Gómez', ownerEmail: STRANGER }),
            absorbed: expect.objectContaining({ id: 'theirs-new', name: 'Carla Gomez', ownerEmail: OWNER }),
        })]);
    });

    it('«Qué coincide y qué no» (audit A4): the survivor as it was BEFORE the merge (not with the absorbed contacts folded in), the absorbed as it is, the pair\'s match types', async () => {
        const [row] = await listMergeDisputesForAdmin(db());
        // mine-old had no contacts before; the merge copied theirs-new's phone onto it.
        expect(sqlite.prepare(`SELECT contact_entries FROM adopters WHERE id = 'mine-old'`).get()!.contact_entries).toContain('5555 0001');
        expect(row.survivor.entries).toEqual([]);
        expect(row.absorbed.entries).toEqual([{ type: 'phone', value: '+54 11 5555 0001' }]);
        expect(row.matchTypes).toEqual(['phone', 'name_full']);
    });

    it('«Deshacer combinación»: both profiles back, the fold grants revoked, the pair kept separate, both rescuers told', async () => {
        expect(liveGrantsOn('mine-old')).toEqual([MATE, OWNER]);
        expect(await as(ADMIN, () => resolveMergeDispute(disputeId, 'undo'))).toEqual({ success: true, status: 'undone' });
        expect(unmergeSpy).toHaveBeenCalledWith(auditId, ADMIN);
        expect(deleted('mine-old')).toBe(false);
        expect(deleted('theirs-new')).toBe(false);
        expect(liveGrantsOn('mine-old')).toEqual([]);
        // Admin decided they are two people: the pair leaves both lists instead of resurfacing.
        expect(candidate('cand-a')).toBe('dismissed');
        expect(disputes()[0]).toMatchObject({ status: 'undone', resolved_by: ADMIN });
        expect(notify.create.map(n => n.userId).sort()).toEqual([OWNER, STRANGER]);
        expect(notify.create.every(n => n.type === 'merge_dispute_resolved')).toBe(true);
        expect(notify.create[0]).toMatchObject({ title: 'Un administrador separó dos perfiles' });
        expect(await listMergeDisputesForAdmin(db())).toEqual([]);
        expect(await getMergeDisputeOption(auditId)).toEqual({ canRaise: false, status: 'undone' });
    });

    it('«Mantener»: the merge stands, the dispute is closed, both told; nobody can reopen it', async () => {
        expect(await as(ADMIN, () => resolveMergeDispute(disputeId, 'keep'))).toEqual({ success: true, status: 'kept' });
        expect(unmergeSpy).not.toHaveBeenCalled();
        expect(deleted('theirs-new')).toBe(true);
        expect(disputes()[0]).toMatchObject({ status: 'kept', resolved_by: ADMIN });
        expect(notify.create.map(n => n.userId).sort()).toEqual([OWNER, STRANGER]);
        expect(notify.create[0]).toMatchObject({ type: 'merge_dispute_resolved', title: 'Un administrador mantuvo una combinación' });
        expect(await raiseMergeDispute(auditId)).toMatchObject({ success: false, error: 'already_decided' });
        expect(await as(MATE, () => raiseMergeDispute(auditId))).toMatchObject({ success: false, error: 'already_decided' });
        expect(disputes()).toHaveLength(1);
        expect(await getMergeDisputeOption(auditId)).toEqual({ canRaise: false, status: 'kept' });
    });

    it('resolving twice, or two admins at once: one outcome, one undo, the other a no-op', async () => {
        const results = await Promise.all([
            as(ADMIN, () => resolveMergeDispute(disputeId, 'undo')),
            as(ADMIN, () => resolveMergeDispute(disputeId, 'keep')),
        ]);
        expect(results.filter(r => r.success)).toHaveLength(1);
        expect(results.filter(r => !r.success)).toEqual([expect.objectContaining({ success: false, error: 'not_open' })]);
        // Whichever claimed the dispute acted: one undo if «Deshacer» won, none if «Mantener» did.
        expect(unmergeSpy).toHaveBeenCalledTimes(results[0].success ? 1 : 0);
        expect(disputes()[0]).toMatchObject({ status: results[0].success ? 'undone' : 'kept' });
        const sent = notify.create.length;
        expect(await as(ADMIN, () => resolveMergeDispute(disputeId, 'undo'))).toMatchObject({ success: false, error: 'not_open' });
        expect(notify.create).toHaveLength(sent);
    });

    it('only an admin resolves it', async () => {
        for (const who of [STRANGER, OWNER, MATE]) {
            expect(await as(who, () => resolveMergeDispute(disputeId, 'undo'))).toMatchObject({ success: false, error: 'not_allowed' });
        }
        expect(await as(ADMIN, () => resolveMergeDispute(disputeId, 'sideways' as 'undo'))).toMatchObject({ success: false, error: 'invalid' });
        expect(await as(ADMIN, () => resolveMergeDispute('nope', 'undo'))).toMatchObject({ success: false, error: 'not_found' });
        expect(unmergeSpy).not.toHaveBeenCalled();
        expect(disputes()[0]).toMatchObject({ status: 'open' });
    });

    it('the undo fails: the dispute is open again and the admin gets an errorId', async () => {
        unmergeSpy.mockResolvedValueOnce({ success: false, error: 'A newer merge into this profile exists — undo that one first' });
        expect(await as(ADMIN, () => resolveMergeDispute(disputeId, 'undo'))).toEqual({
            success: false, error: 'A newer merge into this profile exists — undo that one first', errorId: 'err12345',
        });
        expect(disputes()[0]).toMatchObject({ status: 'open', resolved_by: null });
        expect(notify.create).toEqual([]);
    });

    it('the merge was already undone elsewhere (admin duplicates page): either answer closes it as moot, nobody told', async () => {
        expect((await unmergeAdopters(auditId, ADMIN)).success).toBe(true);
        unmergeSpy.mockClear();
        expect(await as(ADMIN, () => resolveMergeDispute(disputeId, 'keep'))).toEqual({ success: true, status: 'closed' });
        expect(unmergeSpy).not.toHaveBeenCalled();
        expect(disputes()[0]).toMatchObject({ status: 'closed', resolved_by: ADMIN });
        expect(notify.create).toEqual([]);
        expect(await raiseMergeDispute(auditId)).toMatchObject({ success: false, error: 'already_undone' });
    });

    it('superseded: the kept profile was merged away since — closed as moot, no «mantuvo / separó»', async () => {
        sqlite.prepare(`UPDATE adopters SET deleted_at = 5000 WHERE id = 'mine-old'`).run();
        expect(await as(ADMIN, () => resolveMergeDispute(disputeId, 'undo'))).toEqual({ success: true, status: 'closed' });
        expect(unmergeSpy).not.toHaveBeenCalled();
        expect(notify.create).toEqual([]);
        expect(await raiseMergeDispute(auditId)).toMatchObject({ success: false, error: 'superseded' });
    });

    it('after the admin undid it, the merging rescuer re-flags the pair: keeping the other profile is a dispute, never a merge', async () => {
        expect(await as(ADMIN, () => resolveMergeDispute(disputeId, 'undo'))).toEqual({ success: true, status: 'undone' });
        sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, target_adopter_id, reason, details, flagged_by, created_at)
            VALUES ('flag-again', 'theirs-new', 'mine-old', 'duplicate', NULL, ?, 9)`).run(OWNER);
        const merges = sqlite.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'adopter_merge'`).get()!.n;
        expect(await as(OWNER, () => mergePendingDedupPair('flag-again', { keepId: 'mine-old' }))).toEqual({ success: true, outcome: 'disputed' });
        // A rescan alike.
        sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at)
            VALUES ('cand-rescan', 'theirs-new', 'mine-old', '["phone","name_full"]', 90, 'high', 'pending', 9)`).run();
        expect(await as(STRANGER, () => mergePendingDedupPair('cand-rescan', { keepId: 'theirs-new' }))).toMatchObject({ success: false, error: 'request_pending' });
        expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'adopter_merge'`).get()!.n).toBe(merges);
        expect(deleted('mine-old') || deleted('theirs-new')).toBe(false);
    });
});
