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
import { getAdopterApprovers, resolvePiiAccessRequest, revokePiiAccessGrant } from './piiAccess';
import { loadApprovers } from '@/lib/piiAccessRequest';

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
        expect(editRowsBy(STRANGER)).toEqual([{ kind: 'edit' }]);
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
