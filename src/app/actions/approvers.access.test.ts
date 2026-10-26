/**
 * Who may approve contact-access requests on a profile (fix round 2, A).
 * Many open paths (flagging, logging an adoption, adding images, merges…) write
 * an `adopter_history` kind='edit' row. Writing one must not make a stranger
 * an approver: an editor counts only while privileged on the profile (the
 * owner's teammate, an admin or a moderator); the owner always does.
 * Real SQL, real flagAdopter / saveAdoption / loadApprovers /
 * resolvePiiAccessRequest / revokePiiAccessGrant; the session is the actor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { session, OWNER, MATE, STRANGER, ADMIN } = mocks;
const REQUESTER = 'requester@example.com';
const MODERATOR = 'moderator@example.com';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));

vi.mock('@/auth', () => ({ auth: vi.fn(async () => null) }));
vi.mock('./_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser, checkIsAdminAsync: mocks.isAdmin }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/config/admins', () => ({
    isAdminAsync: mocks.isAdmin,
    isModeratorOrAdminAsync: async (e: string | null | undefined) => (await mocks.isAdmin(e)) || e === 'moderator@example.com',
}));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOrgMate: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    isOwnerOrOrgMate: (v: string | null | undefined, o: string | null | undefined) => mocks.isOwnerOrOrgMate(v?.trim().toLowerCase(), o?.trim().toLowerCase()),
}));
vi.mock('@/config/features', async (orig) => ({
    ...(await orig()),
    getFeatureFlag: vi.fn(async (flag: string) => flag === 'ENABLE_PII_ACCESS_GATING'),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/pendingSearchLog', () => ({ closePendingSearchesForAdopter: vi.fn(async () => undefined) }));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async () => undefined) }));
vi.mock('./notifications', () => ({
    createNotification: vi.fn(async () => 'n'),
    notifyAdmins: vi.fn(async () => undefined),
    resolveDisplayName: vi.fn(async (email: string) => email.split('@')[0]),
    resolveDisplayNames: vi.fn(async (emails: string[]) => new Map(emails.map(e => [e, e.split('@')[0]]))),
}));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: (_op: string, fn: () => unknown) => fn(),
}));

import { flagAdopter } from './flags';
import { saveAdoption } from './adoptions';
import { getAdopterApprovers, resolvePiiAccessRequest, revokePiiAccessGrant, getPiiAccessRequestsForApprover } from './piiAccess';
import { notifyApprovers } from '@/lib/contributionSideEffects';
import { createNotification } from './notifications';
import { loadApprovers } from '@/lib/piiAccessRequest';
import { removeVerification } from './flags';
import { deleteAdoption } from './adoptions';
import { deleteImage } from './images';
import { mergeAdopters } from '@/lib/adopterMerge';
import { voidApiRecord } from '@/lib/api/records';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };

const as = async <T>(user: string | null, fn: () => Promise<T>): Promise<T> => {
    const before = session.user;
    session.user = user;
    try { return await fn(); } finally { session.user = before; }
};

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    session.user = STRANGER;
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('p1', 'Pedro Paez', '5', ?, 1000, 1000)`).run(OWNER);
    sqlite.prepare(`INSERT INTO pii_access_requests (id, adopter_id, requester_email, status, justification, created_at) VALUES ('r1', 'p1', ?, 'pending', 'please', 1000)`).run(REQUESTER);
    sqlite.prepare(`INSERT INTO pii_access_grants (id, adopter_id, grantee_email, scope, origin, granted_by_email) VALUES ('g1', 'p1', ?, 'all_contact', 'request', ?)`).run(REQUESTER, OWNER);
});

const editRowsBy = (email: string) => sqlite.prepare(`SELECT kind FROM adopter_history WHERE adopter_id = 'p1' AND changed_by = ?`).all(email);

async function expectNoApproverRights(email: string) {
    expect((await loadApprovers('p1')).all).not.toContain(email);
    const { owner, editors } = await getAdopterApprovers('p1');
    expect([owner, ...editors]).not.toContain(email);
    expect(await as(email, () => resolvePiiAccessRequest('r1', 'approved'))).toEqual({ ok: false, error: 'Not authorized to resolve this request' });
    expect(await as(email, () => revokePiiAccessGrant('g1'))).toEqual({ ok: false, error: 'Not authorized' });
    expect(sqlite.prepare(`SELECT status FROM pii_access_requests WHERE id = 'r1'`).get()!.status).toBe('pending');
    expect(sqlite.prepare(`SELECT revoked_at FROM pii_access_grants WHERE id = 'g1'`).get()!.revoked_at).toBeNull();
}

describe('editors are approvers only while privileged on the profile', () => {
    it('a stranger who flags the profile is not an approver', async () => {
        await flagAdopter('p1', 'inaccurate_information', 'datos raros');
        expect(editRowsBy(STRANGER)).toEqual([{ kind: 'contribution' }]);
        await expectNoApproverRights(STRANGER);
    });

    it("an 'edit' row an older build wrote for a stranger still makes them no approver", async () => {
        // Rows written before the final fix wave (any open path wrote 'edit').
        sqlite.prepare(`INSERT INTO adopter_history (id, adopter_id, changed_by, kind, changes, changed_at) VALUES ('h-old', 'p1', ?, 'edit', '{"flag_added":{}}', 1000)`).run(STRANGER);
        await expectNoApproverRights(STRANGER);
    });

    it('a stranger who logs an adoption on the profile is not an approver', async () => {
        await saveAdoption({ adopterId: 'p1', animalName: 'Luna', species: 'cat', recordType: 'observation', details: 'la vi' } as never);
        expect(editRowsBy(STRANGER).length).toBeGreaterThan(0);
        await expectNoApproverRights(STRANGER);
    });

    it('an org-mate who edited is, the owner always is, and so is an editing moderator', async () => {
        await as(MATE, () => flagAdopter('p1', 'inaccurate_information'));
        await as(MODERATOR, () => flagAdopter('p1', 'inaccurate_information'));
        const { owner, editors, all } = await loadApprovers('p1');
        expect(owner).toBe(OWNER);
        expect(editors.sort()).toEqual([MATE, MODERATOR].sort());
        expect(all.sort()).toEqual([MATE, MODERATOR, OWNER].sort());
        expect(await as(MATE, () => resolvePiiAccessRequest('r1', 'denied'))).toEqual({ ok: true });
    });

    it('the owner keeps approving with no history at all; an admin still may', async () => {
        expect((await loadApprovers('p1')).all).toEqual([OWNER]);
        expect(await as(OWNER, () => revokePiiAccessGrant('g1'))).toEqual({ ok: true });
        sqlite.prepare(`INSERT INTO pii_access_requests (id, adopter_id, requester_email, status, justification, created_at) VALUES ('r2', 'p1', ?, 'pending', 'again', 2000)`).run('x@example.com');
        expect(await as(ADMIN, () => resolvePiiAccessRequest('r2', 'approved'))).toEqual({ ok: true });
    });
});

/**
 * Defense in depth for deploy skew (final fix wave I2): old deployments still
 * count ANY kind='edit' writer as an approver, so a path open to someone with
 * no standing on the profile writes kind='contribution' for them. The owner,
 * a teammate, an admin or a moderator still writes 'edit'.
 */
describe('open history writers: a contribution unless privileged on the profile', () => {
    const kindsBy = (email: string, key: string) => sqlite.prepare(
        `SELECT kind FROM adopter_history WHERE adopter_id = 'p1' AND changed_by = ? AND changes LIKE ?`,
    ).all(email, `%"${key}"%`).map(r => r.kind);

    it('flagging: a stranger contributes; the owner, a teammate, a moderator and an admin edit', async () => {
        for (const who of [STRANGER, OWNER, MATE, MODERATOR, ADMIN]) await as(who, () => flagAdopter('p1', 'inaccurate_information'));
        expect(kindsBy(STRANGER, 'flag_added')).toEqual(['contribution']);
        for (const who of [OWNER, MATE, MODERATOR, ADMIN]) expect(kindsBy(who, 'flag_added')).toEqual(['edit']);
    });

    it('the owner\'s case does not matter (added_by written mixed-case)', async () => {
        sqlite.prepare(`UPDATE adopters SET added_by = 'Owner@Example.com' WHERE id = 'p1'`).run();
        await as(OWNER, () => flagAdopter('p1', 'inaccurate_information'));
        expect(kindsBy(OWNER, 'flag_added')).toEqual(['edit']);
    });

    it('removing their own verification: a stranger contributes', async () => {
        sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason, created_at) VALUES ('f1', 'p1', ?, 'verified_identity', 1000)`).run(STRANGER);
        expect(await removeVerification('p1', 'verified_identity')).toEqual({ success: true });
        expect(kindsBy(STRANGER, 'flag_removed')).toEqual(['contribution']);
    });

    it('an activity record: a stranger logs, edits and deletes it as contributions; the owner as edits', async () => {
        const rec = await saveAdoption({ adopterId: 'p1', animalName: 'Luna', species: 'cat', recordType: 'observation', details: 'la vi' } as never);
        await saveAdoption({ id: rec.id, adopterId: 'p1', animalName: 'Luna', species: 'cat', recordType: 'observation', details: 'la vi de nuevo' } as never);
        await deleteAdoption(rec.id, 'p1');
        expect(kindsBy(STRANGER, 'adoption_added')).toEqual(['contribution']);
        expect(kindsBy(STRANGER, 'adoption_updated')).toEqual(['contribution']);
        expect(kindsBy(STRANGER, 'adoption_deleted')).toEqual(['contribution']);

        const own = await as(OWNER, () => saveAdoption({ adopterId: 'p1', animalName: 'Tom', species: 'cat', recordType: 'observation', details: 'visita' } as never));
        await as(OWNER, () => deleteAdoption(own.id, 'p1'));
        expect(kindsBy(OWNER, 'adoption_added')).toEqual(['edit']);
        expect(kindsBy(OWNER, 'adoption_deleted')).toEqual(['edit']);
        await expectNoApproverRights(STRANGER);
    });

    it('a delivered-home verified address: the contact history row follows the same rule', async () => {
        await saveAdoption({ adopterId: 'p1', animalName: 'Mia', species: 'cat', recordType: 'adoption', deliveredToHome: 1, verifiedAddress: 'Calle Falsa 123' } as never);
        expect(kindsBy(STRANGER, 'adoption_added')).toEqual(['contribution']);
        expect(kindsBy(STRANGER, 'contactInfo')).toEqual(['contribution']);
    });

    it('deleting their own image: a stranger contributes; the owner edits', async () => {
        sqlite.prepare(`INSERT INTO adopter_images (id, adopter_id, url, added_by) VALUES ('i1', 'p1', 'u1', ?), ('i2', 'p1', 'u2', ?)`).run(STRANGER, OWNER);
        await deleteImage('i1', 'p1');
        await as(OWNER, () => deleteImage('i2', 'p1'));
        expect(kindsBy(STRANGER, 'image_deleted')).toEqual(['contribution']);
        expect(kindsBy(OWNER, 'image_deleted')).toEqual(['edit']);
    });

    it("a stranger folding their own profile into the owner's: the survivor's history row is a contribution; an admin's is an edit", async () => {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('s1', 'Pedro P', '5', ?, 1000, 1000), ('s2', 'Pedro Pa', '5', ?, 1000, 1000)`).run(STRANGER, STRANGER);
        expect((await mergeAdopters('p1', 's1', STRANGER)).success).toBe(true);
        expect((await mergeAdopters('p1', 's2', ADMIN)).success).toBe(true);
        expect(kindsBy(STRANGER, 'profiles_merged')).toEqual(['contribution']);
        expect(kindsBy(ADMIN, 'profiles_merged')).toEqual(['edit']);
        await expectNoApproverRights(STRANGER);
    });

    it("voiding an API record that sits on someone else's profile: a contribution for the rescuer", async () => {
        sqlite.prepare(`INSERT INTO adopter_events (id, adopter_id, event_type, recorded_by) VALUES ('ev1', 'p1', 'observation', ?)`).run(STRANGER);
        sqlite.prepare(`INSERT INTO api_requests (id, key_id, owner_email, endpoint, http_status, record_id, created_at) VALUES ('ar1', 'k1', ?, 'search', 200, 'ev1', 1000)`).run(STRANGER);
        const done = await voidApiRecord(state.db as never, 'ev1', { keyId: 'k1', actor: STRANGER, requestId: 'rq1' });
        expect(done?.profileId).toBe('p1');
        expect(kindsBy(STRANGER, 'api_record_voided')).toEqual(['contribution']);
    });
});

/** Final review I1: the pending-request list follows the approver rule, not "any history row". */
describe('getPiiAccessRequestsForApprover lists only requests the caller may approve', () => {
    const listedFor = async (who: string) => (await as(who, () => getPiiAccessRequestsForApprover())).map(r => r.id);

    it('a stranger who contributed (and even holds an old edit row) gets nothing; the owner gets theirs', async () => {
        await flagAdopter('p1', 'inaccurate_information');
        sqlite.prepare(`INSERT INTO adopter_history (id, adopter_id, changed_by, kind, changes, changed_at) VALUES ('h-old', 'p1', ?, 'edit', '{"flag_added":{}}', 1000)`).run(STRANGER);
        expect(await listedFor(STRANGER)).toEqual([]);
        expect(await listedFor(OWNER)).toEqual(['r1']);
    });

    it('a teammate who edited sees it; an admin sees every request', async () => {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('p2', 'Otra', '5', ?, 1000, 1000)`).run('other@example.com');
        sqlite.prepare(`INSERT INTO pii_access_requests (id, adopter_id, requester_email, status, justification, created_at) VALUES ('r2', 'p2', ?, 'pending', 'x', 2000)`).run(REQUESTER);
        await as(MATE, () => flagAdopter('p1', 'inaccurate_information'));
        expect(await listedFor(MATE)).toEqual(['r1']);
        expect(await listedFor(OWNER)).toEqual(['r1']);
        expect(await listedFor(ADMIN)).toEqual(['r1', 'r2']);
    });
});

/** Final review M4: the approver paths ignore the case an email was written in. */
describe('approver emails compare case-insensitively', () => {
    beforeEach(() => {
        sqlite.prepare(`UPDATE adopters SET added_by = 'Owner@Example.com' WHERE id = 'p1'`).run();
    });

    it('a mixed-case added_by owner is listed lowercased and approves, revokes and sees the request', async () => {
        const { owner, all } = await loadApprovers('p1');
        expect(owner).toBe(OWNER);
        expect(all).toEqual([OWNER]);
        expect(await as(OWNER, () => getPiiAccessRequestsForApprover())).toHaveLength(1);
        expect(await as(OWNER, () => resolvePiiAccessRequest('r1', 'approved'))).toEqual({ ok: true });
        expect(await as(OWNER, () => revokePiiAccessGrant('g1'))).toEqual({ ok: true });
    });

    it('a contributing owner written in another case is not notified of their own contribution', async () => {
        vi.mocked(createNotification).mockClear();
        await notifyApprovers({
            op: 'test', adopterId: 'p1', actor: 'OWNER@example.com', type: 'household_contribution',
            build: (actorName) => ({ key: 'household_contribution', params: { actorName, what: 'member' } }),
        });
        expect(createNotification).not.toHaveBeenCalled();
    });
});
