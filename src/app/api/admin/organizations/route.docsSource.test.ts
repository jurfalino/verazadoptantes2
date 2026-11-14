/**
 * «Al cambiar de grupos» on the admin paths (R17/R18; review fix): removing a
 * member and deleting a whole group never switch anyone's shared links
 * silently — each affected member keeps what her links used. Real SQL: the
 * routes' D1 calls run through a thin shim over the same in-memory SQLite
 * the keep logic (drizzle) uses.
 *
 * org-1 «Michis» = { OWNER, MATE }    org-2 «Perris» = { MATE }
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { OWNER, MATE, STRANGER, ADMIN } from '@/test-utils/actionMocks';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown, d1: null as unknown, dbFails: false } }));

vi.mock('@/auth', () => ({ auth: async () => ({ user: { email: 'admin@example.com' } }) }));
vi.mock('@/config/admins', () => ({ isAdminAsync: async () => true }));
vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: { DB: state.d1 } }) }));
vi.mock('@/lib/db', () => ({ getDb: async () => { if (state.dbFails) throw new Error('db down'); return state.db; } }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('@/config/features', () => ({ getFeatureFlag: vi.fn(async () => true) }));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
}));

import { DELETE as deleteGroup } from './route';
import { DELETE as removeMember } from './[id]/route';
import { logAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';

type Row = Record<string, unknown>;
type Stmt = { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] };
let sqlite: { prepare: (s: string) => Stmt; exec: (s: string) => void };

/** The subset of the D1 binding the admin routes call. */
const d1Shim = () => ({
    prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
            run: async () => sqlite.prepare(sql).run(...args),
            first: async () => sqlite.prepare(sql).get(...args) ?? null,
            all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
        }),
    }),
});

const USER_ID: Record<string, string> = { [OWNER]: 'u-owner', [MATE]: 'u-mate', [STRANGER]: 'u-stranger' };
const source = (email: string) => sqlite.prepare('SELECT adoption_docs_source AS s FROM user_profiles WHERE user_id = ?').get(USER_ID[email])?.s ?? null;
const setSource = (email: string, value: string | null) =>
    sqlite.prepare('INSERT INTO user_profiles (user_id, adoption_docs_source) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET adoption_docs_source = excluded.adoption_docs_source').run(USER_ID[email], value);
const audits = () => vi.mocked(logAudit).mock.calls.filter(([e]) => e.action === 'adoption_docs_source_changed').map(([e]) => e);
const members = (orgId: string) => sqlite.prepare('SELECT user_email FROM org_members WHERE org_id = ? ORDER BY user_email').all(orgId).map(r => r.user_email);

const callRemove = (orgId: string, memberId: string) =>
    removeMember(new Request(`http://localhost/api/admin/organizations/${orgId}?memberId=${memberId}`, { method: 'DELETE' }), { params: Promise.resolve({ id: orgId }) });
const callDelete = (orgId: string) => deleteGroup(new Request(`http://localhost/api/admin/organizations?id=${orgId}`, { method: 'DELETE' }));

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    state.d1 = d1Shim();
    state.dbFails = false;
    vi.mocked(logAudit).mockClear();
    vi.mocked(logger.warn).mockClear();
    sqlite.prepare(`INSERT INTO user (id, email, name) VALUES ('u-owner', ?, 'Olga'), ('u-mate', ?, 'Mara'), ('u-stranger', ?, 'Sol')`).run(OWNER, MATE, STRANGER);
    sqlite.prepare(`INSERT INTO organizations (id, name, created_by) VALUES ('org-1', 'Michis', ?), ('org-2', 'Perris', ?)`).run(OWNER, MATE);
    sqlite.prepare(`INSERT INTO org_members (id, org_id, user_email, role) VALUES
        ('m-owner', 'org-1', ?, 'owner'), ('m-mate-1', 'org-1', ?, 'member'), ('m-mate-2', 'org-2', ?, 'owner')`).run(OWNER, MATE, MATE);
});

describe('admin removes a member (DELETE /api/admin/organizations/[id]?memberId=)', () => {
    it('never chosen, 2 → 1 groups: «Los míos» is kept for the removed person, audited with the admin as actor', async () => {
        const res = await callRemove('org-1', 'm-mate-1');
        expect(res.status).toBe(200);
        expect(members('org-1')).toEqual([OWNER]);
        expect(source(MATE)).toBe('self');
        expect(audits()).toEqual([{ userEmail: MATE, action: 'adoption_docs_source_changed', details: { source: 'self', reason: 'kept_on_removal', actorEmail: ADMIN } }]);
    });

    it('her stored group: becomes «Los míos» after the removal (left_group)', async () => {
        setSource(MATE, 'org:org-1');
        expect((await callRemove('org-1', 'm-mate-1')).status).toBe(200);
        expect(source(MATE)).toBe('self');
        expect(audits()).toEqual([{ userEmail: MATE, action: 'adoption_docs_source_changed', details: { source: 'self', reason: 'left_group', actorEmail: ADMIN } }]);
    });

    it('her used sole group: nothing stored', async () => {
        expect((await callRemove('org-1', 'm-owner')).status).toBe(200);
        expect(source(OWNER)).toBeNull();
        expect(audits()).toEqual([]);
    });

    it('a failure of the keep never fails the removal: logged with context', async () => {
        state.dbFails = true;
        expect((await callRemove('org-1', 'm-mate-1')).status).toBe(200);
        expect(members('org-1')).toEqual([OWNER]);
        expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(expect.stringContaining('adminRemoveOrgMember'), expect.objectContaining({ orgId: 'org-1', memberId: 'm-mate-1', actorEmail: ADMIN }));
    });
});

describe('admin deletes a group (DELETE /api/admin/organizations?id=)', () => {
    it('each member keeps what her links used: 2 → 1 never chosen → «Los míos»; stored group → «Los míos»; sole used group → nothing', async () => {
        sqlite.prepare(`INSERT INTO org_members (id, org_id, user_email, role) VALUES ('m-stranger-1', 'org-1', ?, 'member'), ('m-stranger-2', 'org-2', ?, 'member')`).run(STRANGER, STRANGER);
        setSource(STRANGER, 'org:org-1');
        const res = await callDelete('org-1');
        expect(res.status).toBe(200);
        expect(members('org-1')).toEqual([]);
        expect(source(MATE)).toBe('self');      // NULL, Michis + Perris → Perris alone would have switched her
        expect(source(STRANGER)).toBe('self');  // stored Michis, gone
        expect(source(OWNER)).toBeNull();       // NULL, Michis only → no group: nothing to keep
        const byWho = Object.fromEntries(audits().map(a => [a.userEmail, a.details]));
        expect(byWho).toEqual({
            [MATE]: { source: 'self', reason: 'kept_on_removal', actorEmail: ADMIN },
            [STRANGER]: { source: 'self', reason: 'left_group', actorEmail: ADMIN },
        });
    });

    it('a failure of the keep never fails the delete: logged with context', async () => {
        state.dbFails = true;
        expect((await callDelete('org-1')).status).toBe(200);
        expect(sqlite.prepare("SELECT 1 FROM organizations WHERE id = 'org-1'").get()).toBeUndefined();
        expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(expect.stringContaining('adminDeleteOrganization'), expect.objectContaining({ orgId: 'org-1', actorEmail: ADMIN }));
    });
});
