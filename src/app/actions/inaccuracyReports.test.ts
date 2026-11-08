/**
 * H4: «Reportar inexactitud» gets a home on the profile. The owner team reads
 * the open reports there (loadPendingInaccuracyReports, gated by
 * canSeeInaccuracyReports) and closes them with «Ya lo corregí»
 * (markInaccuracyReportsFixed) — with or without the `inaccuracy_reported`
 * notice, which is only a shortcut.
 *
 * Real SQL (every drizzle/*.sql replayed); the session is the only actor.
 * OWNER and MATE share a team; ADMIN is staff; STRANGER is another rescuer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { session, OWNER, MATE, STRANGER, ADMIN } = mocks;
const MODERATOR = 'moderator@example.com';
const REPORTER = 'reporter@example.com';

const { state, audit } = vi.hoisted(() => ({ state: { db: null as unknown }, audit: [] as Array<Record<string, unknown>> }));

vi.mock('./_db', () => ({
    getDb: async () => state.db,
    getUser: mocks.getUser,
    checkIsModeratorOrAdminAsync: async (email: string | null | undefined) => email === ADMIN || email === MODERATOR,
}));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/orgMembership', async (orig) => ({ ...(await orig()), isOrgMate: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async (e: Record<string, unknown>) => { audit.push(e); }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: (_op: string, fn: () => unknown) => fn(),
}));

import { markInaccuracyReportsFixed } from './inaccuracyReports';
import { loadPendingInaccuracyReports, PENDING_INACCURACY_REPORTS_MAX } from '@/lib/inaccuracyReports';
import { canSeeInaccuracyReports } from '@/domain/inaccuracyReports';
import { NOTICE_DETAILS_MAX } from '@/lib/inaccuracyReportNotices';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };

const as = async <T>(user: string | null, fn: () => Promise<T>): Promise<T> => {
    const before = session.user;
    session.user = user;
    try { return await fn(); } finally { session.user = before; }
};
const report = (id: string, opts: { adopterId?: string; type?: string; status?: string; details?: string | null; at?: number; resolvedBy?: string } = {}) =>
    sqlite.prepare(`INSERT INTO data_requests (id, adopter_id, requester_name, requester_email, request_type, details, status, created_at, resolved_by)
                    VALUES (?, ?, 'Marta', ?, ?, ?, ?, ?, ?)`)
        .run(id, opts.adopterId ?? 'juan', REPORTER, opts.type ?? 'inaccuracy', opts.details === undefined ? 'El teléfono es de la hermana, no de él.' : opts.details,
            opts.status ?? 'pending', opts.at ?? 1_762_400_000, opts.resolvedBy ?? null);
const rowOf = (id: string) => sqlite.prepare('SELECT status, resolved_at, resolved_by FROM data_requests WHERE id = ?').get(id)!;

/** What the page decides for a viewer (mirrors src/app/adopter/[id]/page.tsx). */
const pageShows = async (viewer: string) => canSeeInaccuracyReports({
    viewer, owner: OWNER, viewerIsOrgMateOfOwner: await mocks.isOrgMate(viewer, OWNER), viewerIsModeratorOrAdmin: viewer === ADMIN || viewer === MODERATOR,
});

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    audit.length = 0;
    session.user = OWNER;
    const insert = sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES (?, ?, '5', ?, 1000, 1000)`);
    insert.run('juan', 'Juan Pérez', OWNER);
    insert.run('otro', 'Otro Perfil', OWNER);
});

describe('the profile is the home: with the notice deleted (or never written), the report and «Ya lo corregí» still work', () => {
    it('no notification row at all → the banner still reads the report, and the owner closes it', async () => {
        report('r1');
        // The notice is gone — the home does not depend on it.
        sqlite.prepare('DELETE FROM notifications').run();
        expect(sqlite.prepare('SELECT COUNT(*) AS n FROM notifications').get()!.n).toBe(0);

        expect(await pageShows(OWNER)).toBe(true);
        const shown = await loadPendingInaccuracyReports('juan');
        expect(shown).toEqual([{ id: 'r1', reporterName: 'Marta', createdAt: 1_762_400_000_000, details: 'El teléfono es de la hermana, no de él.' }]);

        expect(await markInaccuracyReportsFixed('juan')).toEqual({ ok: true, resolved: 1 });
        expect(rowOf('r1')).toMatchObject({ status: 'resolved', resolved_by: OWNER });
        expect(rowOf('r1').resolved_at).not.toBeNull();
        expect(await loadPendingInaccuracyReports('juan')).toEqual([]);
    });
});

describe('loadPendingInaccuracyReports — one bounded read of the open reports', () => {
    it('newest first; only this profile\'s open inaccuracy reports', async () => {
        report('old', { at: 1000 });
        report('new', { at: 2000, details: null });
        report('done', { status: 'resolved' });
        report('deletion', { type: 'deletion' });
        report('elsewhere', { adopterId: 'otro' });
        const shown = await loadPendingInaccuracyReports('juan');
        expect(shown.map(r => r.id)).toEqual(['new', 'old']);
        // Nothing written → no quote.
        expect(shown[0]).not.toHaveProperty('details');
        // Never the reporter's email.
        expect(JSON.stringify(shown)).not.toContain(REPORTER);
    });

    it('long text is cut the way the notice cuts it', async () => {
        report('long', { details: `x`.repeat(NOTICE_DETAILS_MAX + 50) });
        const [r] = await loadPendingInaccuracyReports('juan');
        expect(r.details!.length).toBe(NOTICE_DETAILS_MAX);
        expect(r.details!.endsWith('…')).toBe(true);
    });

    it(`at most ${PENDING_INACCURACY_REPORTS_MAX} lines`, async () => {
        for (let i = 0; i < PENDING_INACCURACY_REPORTS_MAX + 3; i++) report(`r${i}`, { at: 1000 + i });
        expect(await loadPendingInaccuracyReports('juan')).toHaveLength(PENDING_INACCURACY_REPORTS_MAX);
    });
});

describe('who sees the banner (the page) and who may close the reports (the server) — the same people', () => {
    for (const who of [OWNER, MATE, ADMIN, MODERATOR]) {
        it(`${who}: sees it and closes every open report`, async () => {
            report('a'); report('b', { at: 1_762_500_000 });
            expect(await pageShows(who)).toBe(true);
            expect(await as(who, () => markInaccuracyReportsFixed('juan'))).toEqual({ ok: true, resolved: 2 });
            expect(rowOf('a')).toMatchObject({ status: 'resolved', resolved_by: who });
            expect(rowOf('b')).toMatchObject({ status: 'resolved', resolved_by: who });
            expect(audit).toEqual([expect.objectContaining({ userEmail: who, action: 'inaccuracy_reports_resolved', target: 'juan', details: { requestIds: expect.arrayContaining(['a', 'b']) } })]);
        });
    }

    for (const who of [STRANGER, REPORTER]) {
        it(`${who}: does not see it, and closes nothing`, async () => {
            report('a');
            expect(await pageShows(who)).toBe(false);
            expect(await as(who, () => markInaccuracyReportsFixed('juan'))).toEqual({ ok: false, error: 'not_authorized', errorId: 'gen12345' });
            expect(rowOf('a')).toMatchObject({ status: 'pending', resolved_by: null });
            expect(audit).toEqual([]);
        });
    }

    it('signed out: refused', async () => {
        report('a');
        expect(await as(null, () => markInaccuracyReportsFixed('juan'))).toMatchObject({ ok: false, error: 'unauthenticated' });
        expect(rowOf('a').status).toBe('pending');
    });

    it('an ownerless (imported) profile: only staff close', async () => {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('imp', 'Importado', '5', 'import', 1000, 1000)`).run();
        report('i', { adopterId: 'imp' });
        expect(await as(OWNER, () => markInaccuracyReportsFixed('imp'))).toMatchObject({ ok: false, error: 'not_authorized' });
        expect(await as(ADMIN, () => markInaccuracyReportsFixed('imp'))).toEqual({ ok: true, resolved: 1 });
    });

    it('a missing or deleted profile: not_found', async () => {
        expect(await markInaccuracyReportsFixed('nope')).toMatchObject({ ok: false, error: 'not_found' });
        sqlite.prepare(`UPDATE adopters SET deleted_at = 2000 WHERE id = 'juan'`).run();
        report('a');
        expect(await markInaccuracyReportsFixed('juan')).toMatchObject({ ok: false, error: 'not_found' });
        expect(rowOf('a').status).toBe('pending');
    });
});

describe('«Ya lo corregí» touches only this profile\'s open inaccuracy reports', () => {
    it('leaves a deletion request, another profile\'s report, and an already-closed one (with who closed it) alone', async () => {
        report('mine');
        report('deletion', { type: 'deletion' });
        report('elsewhere', { adopterId: 'otro' });
        report('closed', { status: 'resolved', resolvedBy: ADMIN });
        expect(await as(MATE, () => markInaccuracyReportsFixed('juan'))).toEqual({ ok: true, resolved: 1 });
        expect(rowOf('mine')).toMatchObject({ status: 'resolved', resolved_by: MATE });
        expect(rowOf('deletion')).toMatchObject({ status: 'pending', resolved_by: null });
        expect(rowOf('elsewhere')).toMatchObject({ status: 'pending', resolved_by: null });
        expect(rowOf('closed')).toMatchObject({ status: 'resolved', resolved_by: ADMIN });
    });

    it('nothing open: succeeds with 0 and writes no audit entry', async () => {
        expect(await markInaccuracyReportsFixed('juan')).toEqual({ ok: true, resolved: 0 });
        expect(audit).toEqual([]);
    });
});
