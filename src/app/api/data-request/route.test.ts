/**
 * POST /api/data-request — «Reportar inexactitud» / «Solicitar eliminación»
 * from a profile's «⋯» menu (EM review I5). Real route, real SQL (every
 * drizzle/*.sql replayed), the real editor fan-out (notifyInaccuracyReportEditors,
 * loadApprovers); only the session, the notices and the team/admin lookups
 * are mocked. `runAfterResponse` runs its task inline, so the notices are sent
 * before the response is read.
 *
 * OWNER (team: MATE) loaded Pedro; ADMIN once edited him (an approver);
 * STRANGER reports.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { OWNER, MATE, STRANGER, ADMIN } = mocks;

const { state, notify } = vi.hoisted(() => ({
    state: { db: null as unknown, sessionEmail: null as string | null },
    notify: { create: [] as Array<Record<string, unknown>>, admins: [] as Array<Record<string, unknown>> },
}));

vi.mock('@/auth', () => ({ auth: vi.fn(async () => (state.sessionEmail ? { user: { email: state.sessionEmail, name: 'Sesión' } } : null)) }));
vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/config/admins', async (orig) => ({ ...(await orig()), isAdminAsync: mocks.isAdmin, isModeratorOrAdminAsync: mocks.isAdmin }));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOrgMate: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    isOwnerOrOrgMate: mocks.isOwnerOrOrgMate,
}));
// The notices are what is tested: kept in memory. notifyAdmins itself (who the admins are) is not under test here.
vi.mock('@/app/actions/notifications', () => ({
    createNotification: vi.fn(async (d: Record<string, unknown>) => { notify.create.push(d); return 'n'; }),
    notifyAdmins: vi.fn(async (d: Record<string, unknown>) => { notify.admins.push(d); }),
    resolveDisplayName: vi.fn(async (email: string) => email.split('@')[0]),
    resolveDisplayNames: vi.fn(async (emails: string[]) => new Map(emails.map(e => [e.toLowerCase(), e.split('@')[0]]))),
}));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async (_n: string, task: () => Promise<unknown>) => { await task(); }) }));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: (_op: string, fn: () => unknown) => fn(),
}));

import { POST } from './route';
import { chooseProfileChangesFrom } from '@/test-utils/profileChangesFrom';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };

const post = (body: Record<string, unknown>) => POST(new Request('http://localhost/api/data-request', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}) as never);
const requests = () => sqlite.prepare('SELECT adopter_id, requester_name, requester_email, request_type, details, status FROM data_requests ORDER BY rowid').all();
const editorNotices = () => notify.create.filter(n => n.type === 'inaccuracy_reported');

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    state.sessionEmail = STRANGER;
    notify.create.length = 0;
    notify.admins.length = 0;
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('pedro', 'Pedro Paez', '5', ?, 1, 1), ('gone', 'Ya Unido', '5', ?, 1, 1)`).run(OWNER, OWNER);
    sqlite.prepare(`UPDATE adopters SET deleted_at = 2 WHERE id = 'gone'`).run();
    // An admin who once edited Pedro: one of his editors (loadApprovers), so told as an editor.
    sqlite.prepare(`INSERT INTO adopter_history (id, adopter_id, changed_by, kind, changes, changed_at) VALUES ('h1', 'pedro', ?, 'edit', '{}', 1)`).run(ADMIN);
});

describe('POST /api/data-request', () => {
    it('no session: 401, nothing stored, nobody told', async () => {
        state.sessionEmail = null;
        const res = await post({ adopterId: 'pedro', requestType: 'inaccuracy', details: 'x' });
        expect(res.status).toBe(401);
        expect(requests()).toEqual([]);
        expect(notify.create).toEqual([]);
        expect(notify.admins).toEqual([]);
    });

    it('who is asking comes from the session: the body\'s name and email are ignored', async () => {
        state.sessionEmail = ' Stranger@Example.com ';
        const res = await post({ adopterId: 'pedro', requestType: 'inaccuracy', details: 'El teléfono ya no es suyo.', requesterName: 'Otro Nombre', requesterEmail: 'otro@example.com', name: 'Otro', email: 'otro@example.com' });
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ success: true, id: expect.any(String) });
        expect(requests()).toEqual([{ adopter_id: 'pedro', requester_name: 'stranger', requester_email: STRANGER, request_type: 'inaccuracy', details: 'El teléfono ya no es suyo.', status: 'pending' }]);
        expect(JSON.stringify([notify.create, notify.admins])).not.toContain('otro@example.com');
        expect(JSON.stringify([notify.create, notify.admins])).not.toContain('Otro Nombre');
    });

    it.each([['an unknown profile', 'nobody'], ['a deleted (merged) profile', 'gone']])('%s: 404, nothing stored, nobody told', async (_label, adopterId) => {
        const res = await post({ adopterId, requestType: 'inaccuracy', details: 'x' });
        expect(res.status).toBe(404);
        expect(requests()).toEqual([]);
        expect(notify.create).toEqual([]);
        expect(notify.admins).toEqual([]);
    });

    it.each([['missing', undefined], ['unknown', 'access'], ['not a string', 7]])('a request type that is %s: 400, nothing stored', async (_label, requestType) => {
        const res = await post({ adopterId: 'pedro', requestType, details: 'x' });
        expect(res.status).toBe(400);
        expect(requests()).toEqual([]);
        expect(notify.admins).toEqual([]);
    });

    it('an inaccuracy report tells the owner, their team and the editors, then the admins — skipping an admin already told as an editor', async () => {
        const res = await post({ adopterId: 'pedro', requestType: 'inaccuracy', details: '  El teléfono\n ya no es suyo.  ' });
        expect(res.status).toBe(200);
        expect(editorNotices().map(n => n.userId).sort()).toEqual([ADMIN, MATE, OWNER].sort());
        expect(editorNotices()[0]).toMatchObject({ url: '/adopter/pedro', metadata: { adopterId: 'pedro' } });
        // The reporter is never told.
        expect(notify.create.some(n => n.userId === STRANGER)).toBe(false);
        // The admins' notice: once, opening the admin list, skipping everyone already told (the admin-editor included).
        expect(notify.admins).toHaveLength(1);
        expect(notify.admins[0]).toMatchObject({ type: 'inaccuracy_reported', actorEmail: STRANGER, url: '/admin/data-requests', metadata: { adopterId: 'pedro' } });
        expect([...(notify.admins[0].skip as string[])].sort()).toEqual([ADMIN, MATE, OWNER].sort());
        // It quotes the report on one line.
        expect(JSON.stringify(notify.admins[0])).toContain('El teléfono ya no es suyo.');
    });

    it("a teammate's report («Avisame de cambios hechos por:»): the owner, by default not told, and kept out of the admins' copy too; editors outside the team told", async () => {
        state.sessionEmail = MATE;
        expect((await post({ adopterId: 'pedro', requestType: 'inaccuracy', details: 'x' })).status).toBe(200);
        expect(editorNotices().map(n => n.userId)).toEqual([ADMIN]);
        // Skipped by their choice → skipped by the admins' notice as well (no notice at all).
        expect([...(notify.admins[0].skip as string[])].sort()).toEqual([ADMIN, OWNER].sort());
    });

    it("a teammate's report reaches the owner who chose «Otros rescatistas y mi equipo»", async () => {
        chooseProfileChangesFrom(sqlite, OWNER, 'team');
        state.sessionEmail = MATE;
        await post({ adopterId: 'pedro', requestType: 'inaccuracy', details: 'x' });
        expect(editorNotices().map(n => n.userId).sort()).toEqual([ADMIN, OWNER].sort());
        expect(notify.create.some(n => n.userId === MATE)).toBe(false);
    });

    it('a repeat report from the same person on the same profile is kept, succeeds, and tells no one', async () => {
        expect((await post({ adopterId: 'pedro', requestType: 'inaccuracy', details: 'primero' })).status).toBe(200);
        notify.create.length = 0;
        notify.admins.length = 0;
        const again = await post({ adopterId: 'pedro', requestType: 'inaccuracy', details: 'más detalle' });
        expect(again.status).toBe(200);
        expect(await again.json()).toMatchObject({ success: true });
        expect(requests().map(r => r.details)).toEqual(['primero', 'más detalle']);
        expect(notify.create).toEqual([]);
        expect(notify.admins).toEqual([]);
        // Someone else's first report on the same profile still tells people.
        state.sessionEmail = 'otra@example.com';
        await post({ adopterId: 'pedro', requestType: 'inaccuracy', details: 'otra persona' });
        expect(editorNotices().length).toBeGreaterThan(0);
        expect(notify.admins).toHaveLength(1);
    });

    it('a deletion request is stored and tells no one (current behaviour, kept by Jon)', async () => {
        const res = await post({ adopterId: 'pedro', requestType: 'deletion', details: 'Bórrenme' });
        expect(res.status).toBe(200);
        expect(requests()).toEqual([expect.objectContaining({ adopter_id: 'pedro', requester_email: STRANGER, request_type: 'deletion' })]);
        expect(notify.create).toEqual([]);
        expect(notify.admins).toEqual([]);
    });
});
