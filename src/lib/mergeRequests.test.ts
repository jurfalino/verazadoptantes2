/**
 * Merge requests between rescuers: create, answer (accept / decline / cancel),
 * close on stale profiles, admin list. Real SQL (migrated in-memory SQLite);
 * the merge is the REAL mergeAdopters behind a passthrough spy, so call counts
 * and failure injection work while the soft-delete is the real one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { OWNER, MATE, STRANGER, ADMIN } = mocks;
const REQUESTER = STRANGER;

const { state, notify, logs, admins, team } = vi.hoisted(() => ({
    state: { db: null as unknown, onAdminCheck: null as null | ((email: string | null | undefined) => Promise<void>) },
    notify: { create: [] as Array<Record<string, unknown>>, admins: [] as Array<Record<string, unknown>> },
    logs: { warn: [] as Array<[string, Record<string, unknown>]> },
    admins: { check: null as unknown },
    team: { isOwnerOrOrgMate: null as unknown },
}));

vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/config/admins', () => {
    admins.check = vi.fn(async (email: string | null | undefined) => {
        const hook = state.onAdminCheck;
        if (hook) await hook(email);
        return mocks.isAdmin(email);
    });
    return { isAdminAsync: admins.check, isModeratorOrAdminAsync: admins.check };
});
vi.mock('@/lib/orgMembership', async (orig) => {
    team.isOwnerOrOrgMate = vi.fn(mocks.isOwnerOrOrgMate);
    return { ...(await orig()), isOrgMate: mocks.isOrgMate, isOwnerOrOrgMate: team.isOwnerOrOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor };
});
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async () => undefined) }));
vi.mock('@/app/actions/notifications', () => ({
    createNotification: vi.fn(async (d: Record<string, unknown>) => { notify.create.push(d); return 'n'; }),
    notifyAdmins: vi.fn(async (d: Record<string, unknown>) => { notify.admins.push(d); }),
    resolveDisplayName: vi.fn(async (email: string) => email.split('@')[0]),
}));
vi.mock('@/lib/adopterMerge', async (orig) => {
    const actual = await orig<typeof import('@/lib/adopterMerge')>();
    return { ...actual, mergeAdopters: vi.fn(actual.mergeAdopters) };
});
vi.mock('@/lib/logger', () => ({
    logger: {
        warn: vi.fn((m: string, ctx: Record<string, unknown>) => { logs.warn.push([m, ctx]); }),
        info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345'),
    },
    generateErrorId: () => 'gen12345',
}));

import { createMergeRequest, answerMergeRequest, listMergeRequestsForAdmin } from './mergeRequests';
import { closeRequestsForAdopter, closeRequestsForDeletedAdopter } from './mergeRequestClose';
import { mergeAdopters } from '@/lib/adopterMerge';
import { isOpenDuplicateFlag, KEPT_SEPARATE_FLAG_DETAILS_PREFIX } from '@/domain/dedupPair';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };
const mergeSpy = vi.mocked(mergeAdopters);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the drizzle handle under test
const db = () => state.db as any;

const request = (id: string) => sqlite.prepare('SELECT * FROM merge_requests WHERE id = ?').get(id)!;
const requestCount = () => sqlite.prepare('SELECT COUNT(*) AS n FROM merge_requests').get()!.n as number;
const adopter = (id: string) => sqlite.prepare('SELECT deleted_at, token_hash FROM adopters WHERE id = ?').get(id)!;
const candidate = (id: string) => sqlite.prepare('SELECT status, resolved_by FROM duplicate_candidates WHERE id = ?').get(id)!;
const recipients = () => notify.create.map(n => n.userId);

/** The requester's OLDER profile vs OWNER's newer one: OWNER is asked. */
const detectedInput: Parameters<typeof createMergeRequest>[1] = { primaryId: 'r-old', secondaryId: 'o-new', candidateId: 'cand-1', flagId: null, requesterEmail: REQUESTER, ownerEmail: OWNER };

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    state.onAdminCheck = null;
    sqlite = m.sqlite as unknown as typeof sqlite;
    notify.create.length = 0;
    notify.admins.length = 0;
    logs.warn.length = 0;
    mergeSpy.mockClear();
    vi.mocked(team.isOwnerOrOrgMate as typeof mocks.isOwnerOrOrgMate).mockClear();
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES
        ('r-old', 'Carla Gómez', '5', ?, 1000, 1000), ('o-new', 'Carla Gomez', '5', ?, 2000, 2000),
        ('third', 'Otra', '5', ?, 3000, 3000), ('anon-new', 'Anónima', '5', 'anonymous', 4000, 4000)`).run(REQUESTER, OWNER, OWNER);
    sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at)
        VALUES ('cand-1', 'o-new', 'r-old', '["phone"]', 90, 'high', 'pending', 1)`).run();
    sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason, target_adopter_id, details, created_at)
        VALUES ('flag-1', 'o-new', ?, 'duplicate', 'r-old', NULL, 1)`).run(REQUESTER);
});

async function pending(input: Partial<typeof detectedInput> = {}) {
    const { id } = await createMergeRequest(db(), { ...detectedInput, ...input });
    notify.create.length = 0;
    notify.admins.length = 0;
    return id;
}

describe('createMergeRequest', () => {
    it('one pending row; the owner and their teammate are notified, the requester is not', async () => {
        const res = await createMergeRequest(db(), detectedInput);
        expect(res.created).toBe(true);
        expect(request(res.id)).toMatchObject({
            primary_id: 'r-old', secondary_id: 'o-new', candidate_id: 'cand-1', flag_id: null,
            requester_email: REQUESTER, owner_email: OWNER, status: 'pending',
        });
        expect(recipients().sort()).toEqual([MATE, OWNER].sort());
        for (const n of notify.create) {
            expect(n).toMatchObject({ type: 'merge_request', url: '/my-adopters#pendientes', title: 'stranger pidió combinar dos perfiles' });
            expect(n.body).toContain('Carla Gómez');
            expect(n.body).toContain('Carla Gomez');
            expect(JSON.stringify(n)).not.toContain(REQUESTER);
        }
        expect(notify.admins).toEqual([]);
    });

    it('asking twice (either orientation) returns the same request with its requester: still one row, nobody re-notified', async () => {
        const first = await createMergeRequest(db(), detectedInput);
        expect(first).toMatchObject({ created: true, requesterEmail: REQUESTER });
        notify.create.length = 0;
        const again = await createMergeRequest(db(), detectedInput);
        const flipped = await createMergeRequest(db(), { ...detectedInput, primaryId: 'o-new', secondaryId: 'r-old', requesterEmail: OWNER });
        expect(again).toEqual({ id: first.id, created: false, requesterEmail: REQUESTER });
        expect(flipped).toEqual({ id: first.id, created: false, requesterEmail: REQUESTER });
        expect(requestCount()).toBe(1);
        expect(notify.create).toEqual([]);
    });

    it('a declined request is not "already asked": filing again makes a new pending request and notifies', async () => {
        const first = await createMergeRequest(db(), detectedInput);
        await answerMergeRequest(db(), first.id, OWNER, 'decline');
        notify.create.length = 0;
        const again = await createMergeRequest(db(), detectedInput);
        expect(again.created).toBe(true);
        expect(again.id).not.toBe(first.id);
        expect([request(first.id).status, request(again.id).status]).toEqual(['declined', 'pending']);
        expect(recipients().sort()).toEqual([MATE, OWNER].sort());
    });

    it('the requester is left out of the asked team, whatever the case of their email', async () => {
        await createMergeRequest(db(), { ...detectedInput, requesterEmail: 'Mate@Example.com' });
        expect(recipients()).toEqual([OWNER]);
    });

    it('requester and owner are stored normalized, whatever case they arrive in', async () => {
        const { id } = await createMergeRequest(db(), { ...detectedInput, requesterEmail: ' Stranger@Example.COM ', ownerEmail: 'Owner@Example.com' });
        expect(request(id)).toMatchObject({ requester_email: STRANGER, owner_email: OWNER });
    });

    it('no real owner: the row has a null owner and the admins are notified instead', async () => {
        const res = await createMergeRequest(db(), { ...detectedInput, secondaryId: 'anon-new', candidateId: null, ownerEmail: null });
        expect(request(res.id).owner_email).toBeNull();
        expect(notify.create).toEqual([]);
        expect(notify.admins).toHaveLength(1);
        expect(notify.admins[0]).toMatchObject({ actorEmail: REQUESTER, type: 'merge_request', title: 'stranger pidió combinar dos perfiles' });
    });
});

describe('answerMergeRequest — who may answer', () => {
    it('the owner accepts: merged for real (secondary soft-deleted as MERGED), requester notified, actor not', async () => {
        const id = await pending();
        expect(await answerMergeRequest(db(), id, OWNER, 'accept')).toEqual({ ok: true, status: 'accepted' });
        expect(mergeSpy).toHaveBeenCalledTimes(1);
        expect(mergeSpy).toHaveBeenCalledWith('r-old', 'o-new', OWNER);
        expect(adopter('o-new')).toMatchObject({ token_hash: 'MERGED' });
        expect(adopter('o-new').deleted_at).not.toBeNull();
        expect(adopter('r-old').deleted_at).toBeNull();
        expect(request(id)).toMatchObject({ status: 'accepted', resolved_by_email: OWNER });
        expect(request(id).resolved_at).not.toBeNull();
        expect(recipients()).toEqual([REQUESTER]);
        expect(notify.create[0]).toMatchObject({ type: 'merge_request_resolved', url: '/adopter/r-old' });
    });

    it("a teammate of the owner may accept for them", async () => {
        const id = await pending();
        expect(await answerMergeRequest(db(), id, MATE, 'accept')).toEqual({ ok: true, status: 'accepted' });
        expect(mergeSpy).toHaveBeenCalledTimes(1);
    });

    it('the requester (not an admin) can neither accept nor decline their own request', async () => {
        const id = await pending();
        expect(await answerMergeRequest(db(), id, REQUESTER, 'accept')).toEqual({ ok: false, reason: 'not_allowed' });
        expect(await answerMergeRequest(db(), id, REQUESTER.toUpperCase(), 'accept')).toEqual({ ok: false, reason: 'not_allowed' });
        expect(await answerMergeRequest(db(), id, REQUESTER, 'decline')).toEqual({ ok: false, reason: 'not_allowed' });
        expect(request(id).status).toBe('pending');
        expect(mergeSpy).not.toHaveBeenCalled();
    });

    it('a stranger to both sides is refused every decision', async () => {
        const id = await pending();
        for (const d of ['accept', 'decline', 'cancel'] as const) {
            expect(await answerMergeRequest(db(), id, 'nobody@example.com', d)).toEqual({ ok: false, reason: 'not_allowed' });
        }
        expect(request(id).status).toBe('pending');
        expect(mergeSpy).not.toHaveBeenCalled();
    });

    it('only the requester cancels (email case ignored); nobody is notified, the pair is untouched', async () => {
        const id = await pending();
        expect(await answerMergeRequest(db(), id, OWNER, 'cancel')).toEqual({ ok: false, reason: 'not_allowed' });
        expect(await answerMergeRequest(db(), id, 'Stranger@Example.com', 'cancel')).toEqual({ ok: true, status: 'cancelled' });
        expect(request(id).status).toBe('cancelled');
        expect(candidate('cand-1').status).toBe('pending');
        expect(notify.create).toEqual([]);
    });

    it('no real owner: only an admin can answer, even if the team check would say yes', async () => {
        const id = await pending({ secondaryId: 'anon-new', candidateId: null, ownerEmail: null });
        vi.mocked(team.isOwnerOrOrgMate as typeof mocks.isOwnerOrOrgMate).mockResolvedValue(true);
        try {
            expect(await answerMergeRequest(db(), id, OWNER, 'accept')).toEqual({ ok: false, reason: 'not_allowed' });
        } finally {
            vi.mocked(team.isOwnerOrOrgMate as typeof mocks.isOwnerOrOrgMate).mockImplementation(mocks.isOwnerOrOrgMate);
        }
        expect(await answerMergeRequest(db(), id, ADMIN, 'accept')).toEqual({ ok: true, status: 'admin_approved' });
        expect(mergeSpy).toHaveBeenCalledWith('r-old', 'anon-new', ADMIN);
    });

    it('an unknown request id: not_found', async () => {
        expect(await answerMergeRequest(db(), 'nope', OWNER, 'accept')).toEqual({ ok: false, reason: 'not_found' });
    });
});

describe('answerMergeRequest — decline and admin decisions', () => {
    it('the owner declines: candidate dismissed by them, requester notified, nothing merged', async () => {
        const id = await pending();
        expect(await answerMergeRequest(db(), id, OWNER, 'decline')).toEqual({ ok: true, status: 'declined' });
        expect(candidate('cand-1')).toEqual({ status: 'dismissed', resolved_by: OWNER });
        expect(recipients()).toEqual([REQUESTER]);
        expect(notify.create[0]).toMatchObject({ type: 'merge_request_resolved', url: '/my-adopters' });
        expect(mergeSpy).not.toHaveBeenCalled();
    });

    it('an admin approves after the owner declined: merged, requester and owner notified', async () => {
        const id = await pending();
        await answerMergeRequest(db(), id, OWNER, 'decline');
        notify.create.length = 0;
        expect(await answerMergeRequest(db(), id, ADMIN, 'accept')).toEqual({ ok: true, status: 'admin_approved' });
        expect(adopter('o-new')).toMatchObject({ token_hash: 'MERGED' });
        expect(candidate('cand-1').status).toBe('merged');
        expect(recipients().sort()).toEqual([OWNER, REQUESTER].sort());
    });

    it('after a decline only an accept is still possible: the owner team changing its mind (D43) or an admin', async () => {
        const id = await pending();
        await answerMergeRequest(db(), id, OWNER, 'decline');
        expect(await answerMergeRequest(db(), id, REQUESTER, 'cancel')).toEqual({ ok: false, reason: 'not_open' });
        expect(await answerMergeRequest(db(), id, REQUESTER, 'accept')).toEqual({ ok: false, reason: 'not_open' });
        expect(await answerMergeRequest(db(), id, ADMIN, 'decline')).toEqual({ ok: false, reason: 'not_open' });
        expect(await answerMergeRequest(db(), id, MATE, 'accept')).toEqual({ ok: true, status: 'accepted' });
    });

    it('an admin declines a pending request: kept separate, requester and owner notified', async () => {
        const id = await pending();
        expect(await answerMergeRequest(db(), id, ADMIN, 'decline')).toEqual({ ok: true, status: 'admin_declined' });
        expect(candidate('cand-1')).toEqual({ status: 'dismissed', resolved_by: ADMIN });
        expect(recipients().sort()).toEqual([OWNER, REQUESTER].sort());
    });

    it('an admin may approve a request they filed themselves; they are not notified about it', async () => {
        const id = await pending({ requesterEmail: ADMIN });
        expect(await answerMergeRequest(db(), id, ADMIN, 'accept')).toEqual({ ok: true, status: 'admin_approved' });
        expect(recipients()).toEqual([OWNER]);
    });

    it('a declined FLAG request annotates the flag, which then stops being an open duplicate', async () => {
        const id = await pending({ candidateId: null, flagId: 'flag-1' });
        expect(await answerMergeRequest(db(), id, OWNER, 'decline')).toEqual({ ok: true, status: 'declined' });
        const flag = sqlite.prepare('SELECT adopter_id AS adopterId, target_adopter_id AS targetAdopterId, reason, details FROM adopter_flags WHERE id = ?')
            .get('flag-1') as { adopterId: string; targetAdopterId: string; reason: string; details: string };
        // The request id, never who declined: flag details render to every viewer.
        expect(flag.details).toBe(`${KEPT_SEPARATE_FLAG_DETAILS_PREFIX}${id}`);
        expect(flag.details).not.toContain('@');
        expect(isOpenDuplicateFlag(flag)).toBe(false);
        // The same pair's detected candidate leaves the lists too.
        expect(candidate('cand-1')).toEqual({ status: 'dismissed', resolved_by: OWNER });
    });

    it('a declined CANDIDATE request also closes a flag on the same pair, and leaves other pairs alone', async () => {
        sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at)
            VALUES ('cand-other', 'o-new', 'third', '["phone"]', 90, 'high', 'pending', 1)`).run();
        sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason, target_adopter_id, details, created_at)
            VALUES ('flag-other', 'third', ?, 'duplicate', 'o-new', NULL, 1)`).run(OWNER);
        const id = await pending();
        expect(await answerMergeRequest(db(), id, OWNER, 'decline')).toEqual({ ok: true, status: 'declined' });
        const details = (fid: string) => sqlite.prepare('SELECT details FROM adopter_flags WHERE id = ?').get(fid)!.details;
        expect(details('flag-1')).toBe(`${KEPT_SEPARATE_FLAG_DETAILS_PREFIX}${id}`);
        expect(details('flag-1')).not.toContain('@');
        expect(details('flag-other')).toBeNull();
        expect(candidate('cand-other').status).toBe('pending');
    });
});

describe('answerMergeRequest — races and stale profiles', () => {
    it('owner accept and admin approve at once: one merge, the other call gets not_open', async () => {
        const id = await pending();
        const results = await Promise.all([
            answerMergeRequest(db(), id, OWNER, 'accept'),
            answerMergeRequest(db(), id, ADMIN, 'accept'),
        ]);
        expect(mergeSpy).toHaveBeenCalledTimes(1);
        expect(results.filter(r => r.ok)).toHaveLength(1);
        expect(results.filter(r => !r.ok)).toEqual([{ ok: false, reason: 'not_open' }]);
    });

    it('the owner wins between the admin reading the request and writing it: the compare-and-set refuses the admin', async () => {
        const id = await pending();
        let ownerResult: unknown = null;
        state.onAdminCheck = async (email) => {
            if (email !== ADMIN) return;
            state.onAdminCheck = null;
            ownerResult = await answerMergeRequest(db(), id, OWNER, 'accept');
        };
        expect(await answerMergeRequest(db(), id, ADMIN, 'accept')).toEqual({ ok: false, reason: 'not_open' });
        expect(ownerResult).toEqual({ ok: true, status: 'accepted' });
        expect(mergeSpy).toHaveBeenCalledTimes(1);
        expect(request(id)).toMatchObject({ status: 'accepted', resolved_by_email: OWNER });
    });

    it('the compare-and-set itself loses (status moved after the request was read): not_open, no merge', async () => {
        const id = await pending();
        state.onAdminCheck = async () => {
            state.onAdminCheck = null;
            sqlite.prepare(`UPDATE merge_requests SET status = 'cancelled' WHERE id = ?`).run(id);
        };
        expect(await answerMergeRequest(db(), id, OWNER, 'accept')).toEqual({ ok: false, reason: 'not_open' });
        expect(mergeSpy).not.toHaveBeenCalled();
        expect(request(id).status).toBe('cancelled');
        expect(logs.warn.map(([m]) => m)).toContain('answerMergeRequest: lost the race');
    });

    it('the absorbed profile was removed elsewhere: profiles_changed, request closed, no merge', async () => {
        const id = await pending();
        sqlite.prepare('UPDATE adopters SET deleted_at = 5000 WHERE id = ?').run('o-new');
        expect(await answerMergeRequest(db(), id, OWNER, 'accept')).toEqual({ ok: false, reason: 'profiles_changed' });
        expect(request(id).status).toBe('closed');
        expect(mergeSpy).not.toHaveBeenCalled();
    });

    it('a late second click after a merge never overwrites the accepted status', async () => {
        const id = await pending();
        await answerMergeRequest(db(), id, OWNER, 'accept');
        expect(await answerMergeRequest(db(), id, ADMIN, 'accept')).toEqual({ ok: false, reason: 'not_open' });
        expect(request(id).status).toBe('accepted');
    });

    it('the merge fails: the request goes back to pending, resolution cleared', async () => {
        const id = await pending();
        mergeSpy.mockResolvedValueOnce({ success: false, error: 'SQLITE_BUSY' });
        expect(await answerMergeRequest(db(), id, OWNER, 'accept')).toEqual({ ok: false, reason: 'merge_failed' });
        expect(request(id)).toMatchObject({ status: 'pending', resolved_by_email: null, resolved_at: null });
        expect(notify.create).toEqual([]);
    });

    it('the merge fails because a profile was merged away meanwhile: closed, not reopened', async () => {
        const id = await pending();
        mergeSpy.mockImplementationOnce(async () => {
            sqlite.prepare('UPDATE adopters SET deleted_at = 5000 WHERE id = ?').run('o-new');
            return { success: false, error: 'Cannot merge already-deleted profiles' };
        });
        expect(await answerMergeRequest(db(), id, OWNER, 'accept')).toEqual({ ok: false, reason: 'profiles_changed' });
        expect(request(id).status).toBe('closed');
    });

    it("an admin approval of a declined request fails to merge: back to declined, the owner's decline kept", async () => {
        const id = await pending();
        await answerMergeRequest(db(), id, OWNER, 'decline');
        const declinedAt = request(id).resolved_at;
        mergeSpy.mockResolvedValueOnce({ success: false, error: 'boom' });
        expect(await answerMergeRequest(db(), id, ADMIN, 'accept')).toEqual({ ok: false, reason: 'merge_failed' });
        expect(request(id)).toMatchObject({ status: 'declined', resolved_by_email: OWNER, resolved_at: declinedAt });
    });
});

describe('closeRequestsForAdopter', () => {
    it('closes pending and declined requests naming the profile on either side, nothing else', async () => {
        const ins = sqlite.prepare(`INSERT INTO merge_requests (id, primary_id, secondary_id, requester_email, owner_email, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 1)`);
        ins.run('p1', 'r-old', 'o-new', REQUESTER, OWNER, 'pending');
        ins.run('p2', 'third', 'r-old', REQUESTER, OWNER, 'declined');
        ins.run('p3', 'r-old', 'third', REQUESTER, OWNER, 'accepted');
        ins.run('p4', 'third', 'anon-new', REQUESTER, null, 'pending');
        expect(await closeRequestsForAdopter(db(), 'r-old')).toBe(2);
        expect(['p1', 'p2', 'p3', 'p4'].map(id => request(id).status)).toEqual(['closed', 'closed', 'accepted', 'pending']);
        expect(request('p1').resolved_at).not.toBeNull();
    });

    it("a merge closes the ABSORBED profile's open requests; the survivor's requests with other profiles stay open", async () => {
        const id = await pending();
        const absorbedElsewhere = await pending({ primaryId: 'third', secondaryId: 'o-new', candidateId: null });
        const survivorElsewhere = await pending({ primaryId: 'r-old', secondaryId: 'third', candidateId: null });
        const unrelated = await pending({ primaryId: 'third', secondaryId: 'anon-new', candidateId: null, ownerEmail: null });
        expect((await mergeAdopters('r-old', 'o-new', ADMIN)).success).toBe(true);
        expect(request(id).status).toBe('closed');
        expect(request(absorbedElsewhere).status).toBe('closed');
        expect(request(survivorElsewhere).status).toBe('pending');
        expect(request(unrelated).status).toBe('pending');
        expect(await answerMergeRequest(db(), id, OWNER, 'accept')).toEqual({ ok: false, reason: 'not_open' });
    });
});

describe('closeRequestsForDeletedAdopter', () => {
    it("closes the deleted profile's open requests", async () => {
        const { id } = await createMergeRequest(db(), detectedInput);
        await closeRequestsForDeletedAdopter(db(), 'o-new', ADMIN);
        expect(request(id).status).toBe('closed');
    });

    it('a DB failure is logged with the profile and actor, never thrown (the delete stands)', async () => {
        sqlite.prepare('DROP TABLE merge_requests').run();
        await expect(closeRequestsForDeletedAdopter(db(), 'o-new', ADMIN)).resolves.toBeUndefined();
        expect(logs.warn).toContainEqual(['closeRequestsForDeletedAdopter: open requests left open', expect.objectContaining({ adopterId: 'o-new', actor: ADMIN })]);
    });
});

describe('listMergeRequestsForAdmin', () => {
    it('pending first, then declined, each oldest first; other states left out; names attached', async () => {
        const ins = sqlite.prepare(`INSERT INTO merge_requests (id, primary_id, secondary_id, requester_email, owner_email, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        ins.run('d-old', 'r-old', 'o-new', REQUESTER, OWNER, 'declined', 100);
        ins.run('p-new', 'r-old', 'third', REQUESTER, OWNER, 'pending', 300);
        ins.run('p-old', 'third', 'anon-new', REQUESTER, null, 'pending', 200);
        ins.run('done', 'r-old', 'o-new', REQUESTER, OWNER, 'accepted', 50);
        ins.run('gone', 'r-old', 'o-new', REQUESTER, OWNER, 'closed', 60);
        const rows = await listMergeRequestsForAdmin(db());
        expect(rows.map(r => r.id)).toEqual(['p-old', 'p-new', 'd-old']);
        expect(rows[0]).toEqual({
            id: 'p-old', status: 'pending', createdAt: 200_000,
            primary: { id: 'third', name: 'Otra' }, secondary: { id: 'anon-new', name: 'Anónima' },
            requesterEmail: REQUESTER, ownerEmail: null,
        });
        expect(rows[2]).toMatchObject({ status: 'declined', primary: { name: 'Carla Gómez' }, secondary: { name: 'Carla Gomez' }, ownerEmail: OWNER });
    });
});
