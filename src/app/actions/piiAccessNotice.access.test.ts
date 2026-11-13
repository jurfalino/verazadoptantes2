/**
 * H3 — the turn-down note and «El responsable quitó tu acceso» live on the
 * profile, not in the notice. With every notification row deleted, the viewer
 * still gets the note / the revoke date from getAdopterPiiContext, and can
 * still ask again. Real SQL, real resolve / revoke / request actions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { session, OWNER, STRANGER, ADMIN } = mocks;

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));

vi.mock('@/auth', () => ({ auth: vi.fn(async () => null) }));
vi.mock('./_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser, checkIsAdminAsync: mocks.isAdmin }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/config/admins', async (orig) => ({ ...(await orig()), isAdminAsync: mocks.isAdmin, isModeratorOrAdminAsync: mocks.isAdmin }));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOrgMate: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    isOwnerOrOrgMate: (v: string | null | undefined, o: string | null | undefined) => mocks.isOwnerOrOrgMate(v?.trim().toLowerCase(), o?.trim().toLowerCase()),
    getOrgMatesOf: async () => [],
}));
vi.mock('@/config/features', async (orig) => ({
    ...(await orig()),
    getFeatureFlag: vi.fn(async (flag: string) => flag === 'ENABLE_PII_ACCESS_GATING'),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
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

import { getAdopterPiiContext, resolvePiiAccessRequest, revokePiiAccessGrant, requestPiiAccess } from './piiAccess';
import { revokeContributionGrants } from '@/lib/contributionSideEffects';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };
let db: unknown;

const as = async <T>(user: string | null, fn: () => Promise<T>): Promise<T> => {
    const before = session.user;
    session.user = user;
    try { return await fn(); } finally { session.user = before; }
};
const DAY = 86_400_000;
const noNotices = () => {
    sqlite.prepare('DELETE FROM notifications').run();
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM notifications').get()!.n).toBe(0);
};
const ctx = () => as(STRANGER, () => getAdopterPiiContext('p1'));

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    session.user = STRANGER;
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at, contact_entries) VALUES ('p1', 'Pedro Paez', '5', ?, 1000, 1000, ?)`)
        .run(OWNER, JSON.stringify([{ id: 'e1', type: 'phone', value: '351-555-0101', addedBy: OWNER }]));
});

describe('H3: the turn-down note lives on the profile (notice deleted)', () => {
    it('owner turns the request down with a note → the viewer sees it with the notice gone, and can ask again after the wait', async () => {
        expect((await as(STRANGER, () => requestPiiAccess('p1', { justification: 'adoptante en común' }))).status).toBe('created');
        const reqId = sqlite.prepare(`SELECT id FROM pii_access_requests WHERE adopter_id = 'p1'`).get()!.id as string;
        expect(await as(OWNER, () => resolvePiiAccessRequest(reqId, 'denied', 'Solo compartimos con refugios de Córdoba.'))).toEqual({ ok: true });
        noNotices();

        const c = await ctx();
        expect(c.masked).toBe(true);
        expect(c.requestState).toMatchObject({
            pending: false, denied: true, lastResolutionNote: 'Solo compartimos con refugios de Córdoba.', accessRevokedAt: null,
        });
        expect(c.requestState.cooldownUntil).toBeGreaterThan(Date.now());

        // After the 14-day wait the note is still there and the request action works.
        sqlite.prepare(`UPDATE pii_access_requests SET resolved_at = ? WHERE id = ?`).run(Math.floor((Date.now() - 20 * DAY) / 1000), reqId);
        const later = await ctx();
        expect(later.requestState).toMatchObject({ denied: true, cooldownUntil: null, lastResolutionNote: 'Solo compartimos con refugios de Córdoba.' });
        expect((await as(STRANGER, () => requestPiiAccess('p1', { justification: 'de nuevo' }))).status).toBe('created');

        // Asking again hides the note.
        expect((await ctx()).requestState).toMatchObject({ pending: true, denied: false, lastResolutionNote: null });
    });

    it('a denial with no note still says it was not approved', async () => {
        await as(STRANGER, () => requestPiiAccess('p1', { justification: 'x' }));
        const reqId = sqlite.prepare(`SELECT id FROM pii_access_requests WHERE adopter_id = 'p1'`).get()!.id as string;
        await as(OWNER, () => resolvePiiAccessRequest(reqId, 'denied'));
        noNotices();
        expect((await ctx()).requestState).toMatchObject({ denied: true, lastResolutionNote: null });
    });
});

describe('H3: «El responsable quitó tu acceso» lives on the profile (notice deleted)', () => {
    async function approveThenRevoke(revoker: string) {
        await as(STRANGER, () => requestPiiAccess('p1', { justification: 'x' }));
        const reqId = sqlite.prepare(`SELECT id FROM pii_access_requests WHERE adopter_id = 'p1'`).get()!.id as string;
        await as(OWNER, () => resolvePiiAccessRequest(reqId, 'approved'));
        const grantId = sqlite.prepare(`SELECT id FROM pii_access_grants WHERE adopter_id = 'p1' AND scope = 'all_contact'`).get()!.id as string;
        // Approve and revoke land in the same second otherwise; make the revoke the later event.
        sqlite.prepare(`UPDATE pii_access_grants SET created_at = created_at - 10 WHERE id = ?`).run(grantId);
        sqlite.prepare(`UPDATE pii_access_requests SET created_at = created_at - 20, resolved_at = resolved_at - 10 WHERE id = ?`).run(reqId);
        expect((await ctx()).hasFullAccess).toBe(true);
        expect(await as(revoker, () => revokePiiAccessGrant(grantId))).toEqual({ ok: true });
    }

    it('the owner takes access back → the line shows with the notice gone, and the viewer can ask again', async () => {
        await approveThenRevoke(OWNER);
        noNotices();
        const c = await ctx();
        expect(c.masked).toBe(true);
        expect(c.requestState.denied).toBe(false);
        expect(c.requestState.accessRevokedAt).toEqual(expect.any(Number));
        expect(c.requestState.revokedByAdmin).toBe(false);
        expect(c.requestState.cooldownUntil).toBeNull();

        expect((await as(STRANGER, () => requestPiiAccess('p1', { justification: 'por favor' }))).status).toBe('created');
        expect((await ctx()).requestState).toMatchObject({ pending: true, accessRevokedAt: null });
    });

    it('an admin revoke reads «Un administrador quitó tu acceso» (Jon 2026-11-09)', async () => {
        await approveThenRevoke(ADMIN);
        noNotices();
        const c = await ctx();
        expect(c.requestState.accessRevokedAt).toEqual(expect.any(Number));
        expect(c.requestState.revokedByAdmin).toBe(true);
    });

    it('TRAP: a contributor taking back their own contacts never shows the line', async () => {
        sqlite.prepare(`INSERT INTO pii_access_grants (id, adopter_id, grantee_email, scope, entry_ref, origin, granted_by_email, created_at) VALUES ('gc', 'p1', ?, 'entry', 'ref-x', 'contribution', ?, 1000)`).run(STRANGER, STRANGER);
        // Same writer the household «take back» path uses.
        sqlite.prepare(`UPDATE pii_access_grants SET entry_ref = ? WHERE id = 'gc'`).run((await import('@/lib/piiAccess')).hashEntryValue('phone', '351-555-9999'));
        await revokeContributionGrants(db as never, { op: 't', adopterId: 'p1', actor: STRANGER, removed: [{ type: 'phone', value: '351-555-9999' }], stillOnProfile: new Set() });
        expect(sqlite.prepare(`SELECT revoked_by_email FROM pii_access_grants WHERE id = 'gc'`).get()!.revoked_by_email).toBe(STRANGER);
        noNotices();
        expect((await ctx()).requestState.accessRevokedAt).toBeNull();
    });
});

/**
 * Notifications cleanup, Phase 1 (change 2): «answer once, cleared everywhere» for
 * contact-access requests. When ANY approver approves or denies, every approver's
 * `pii_access_request` notice about that request is read — the owner's and each
 * editor's. Other requests, and the requester's own answer, are untouched.
 */
describe('a request answered by one approver is cleared for every approver', () => {
    const { MATE } = mocks;
    const readOf = (id: string) => sqlite.prepare('SELECT read FROM notifications WHERE id = ?').get(id)!.read;
    const notice = (id: string, userId: string, requestId: string, type = 'pii_access_request') =>
        sqlite.prepare(`INSERT INTO notifications (id, user_id, type, title, body, url, read, metadata) VALUES (?, ?, ?, 't', 'b', '/adopter/p1', 0, ?)`)
            .run(id, userId, type, JSON.stringify({ adopterId: 'p1', requestId }));

    async function pendingRequest(): Promise<string> {
        // MATE edited the profile and is OWNER's teammate: an approver (loadApprovers).
        sqlite.prepare(`INSERT INTO adopter_history (id, adopter_id, changed_by, kind, changes, changed_at) VALUES ('h-mate', 'p1', ?, 'edit', '{}', 1000)`).run(MATE);
        expect((await as(STRANGER, () => requestPiiAccess('p1', { justification: 'adoptante en común' }))).status).toBe('created');
        const reqId = sqlite.prepare(`SELECT id FROM pii_access_requests WHERE adopter_id = 'p1'`).get()!.id as string;
        // createNotification is mocked here: the two approvers' copies, as the writer stores them.
        notice('n-owner', OWNER, reqId);
        notice('n-mate', MATE, reqId);
        notice('n-other-request', OWNER, 'another-request');
        notice('n-old-answer', STRANGER, reqId, 'pii_access_denied');
        return reqId;
    }

    it.each(['approved', 'denied'] as const)('the teammate %s → the owner\'s copy is read too', async (decision) => {
        const reqId = await pendingRequest();
        expect(await as(MATE, () => resolvePiiAccessRequest(reqId, decision))).toEqual({ ok: true });
        expect(readOf('n-owner')).toBe(1);
        expect(readOf('n-mate')).toBe(1);
        expect(readOf('n-other-request')).toBe(0);
        expect(readOf('n-old-answer')).toBe(0);
    });

    it('an admin answers → every approver\'s copy is read', async () => {
        const reqId = await pendingRequest();
        expect(await as(ADMIN, () => resolvePiiAccessRequest(reqId, 'approved'))).toEqual({ ok: true });
        expect([readOf('n-owner'), readOf('n-mate')]).toEqual([1, 1]);
    });

    it('a refused answer clears nothing', async () => {
        const reqId = await pendingRequest();
        expect((await as(STRANGER, () => resolvePiiAccessRequest(reqId, 'approved'))).ok).toBe(false);
        expect([readOf('n-owner'), readOf('n-mate')]).toEqual([0, 0]);
    });

    it('clearing failing never blocks the answer: still ok, the grant is written, logged at warn with context', async () => {
        const { logger } = await import('@/lib/logger');
        vi.mocked(logger.warn).mockClear();
        const reqId = await pendingRequest();
        sqlite.prepare('DROP TABLE notifications').run();
        expect(await as(OWNER, () => resolvePiiAccessRequest(reqId, 'approved'))).toEqual({ ok: true });
        expect(sqlite.prepare(`SELECT status FROM pii_access_requests WHERE id = ?`).get(reqId)!.status).toBe('approved');
        expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM pii_access_grants WHERE request_id = ?`).get(reqId)!.n).toBe(1);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('clearPiiRequestNotices'),
            expect.objectContaining({ requestId: reqId, adopterId: 'p1', actor: OWNER }));
    });
});
