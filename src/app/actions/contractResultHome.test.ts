/**
 * H1: a contract result has a home that does not depend on the notice.
 * With NO notification row, the signed contract alone still gives:
 *   - the content: what the adopter typed and the match count;
 *   - the action: «Sí, es la misma persona» (attachContractToExistingAdopter);
 *   - the door: the record carries the signed-contract id its
 *     «Datos y posibles duplicados» button opens.
 * And the old notice id keeps today's (wider) rule. Real SQL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { session, OWNER, MATE, STRANGER, ADMIN } = mocks;

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));

vi.mock('./_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/config/admins', () => ({ isAdminAsync: mocks.isAdmin, isAdminAsyncStrict: mocks.isAdmin, isModeratorOrAdminAsync: mocks.isAdmin, isAdmin: (e: string) => e === ADMIN, BOOTSTRAP_ADMIN_EMAILS: [] }));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOrgMate: mocks.isOrgMate, isOrgMateStrict: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    isOwnerOrOrgMate: (v: string | null | undefined, o: string | null | undefined) => mocks.isOwnerOrOrgMate(v?.trim().toLowerCase(), o?.trim().toLowerCase()),
    getTeamEmails: async (email: string) => mocks.getOrgMemberEmailsFor((email ?? '').trim().toLowerCase()),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async () => undefined) }));
vi.mock('./notifications', () => ({
    createNotification: vi.fn(async () => 'n'),
    notifyAdmins: vi.fn(async () => undefined),
    resolveDisplayName: vi.fn(async (email: string) => email.split('@')[0]),
    resolveDisplayNames: vi.fn(async (emails: string[]) => new Map(emails.map(e => [e.toLowerCase(), e.split('@')[0]]))),
}));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
}));

import { attachContractToExistingAdopter } from './duplicates';
import { loadContractResult } from '@/lib/contractResult';
import { attachSignedContractIds } from '@/lib/signedContractIds';
import { contractResultsHref } from '@/lib/contractLink';
import { adoptions } from '@/db/schema';

type Stmt = { get: (...a: unknown[]) => Record<string, unknown> | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Record<string, unknown>[] };
let sqlite: { prepare: (s: string) => Stmt };
let db: unknown;
const as = async <T>(user: string, fn: () => Promise<T>): Promise<T> => {
    const before = session.user;
    session.user = user;
    try { return await fn(); } finally { session.user = before; }
};

const TYPED = { name: 'Juan Pérez', phone: '+54 11 5555 0101', email: 'juan@example.com', dni: '30111222', address: 'Calle 1', socialNetworks: '' };

beforeEach(() => {
    const m = migratedDb();
    state.db = db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    // The H1 columns, until their migration is in drizzle/ (the integrator numbers it).
    const cols = new Set(sqlite.prepare(`PRAGMA table_info(signed_contracts)`).all().map(c => c.name));
    if (!cols.has('submitted_json')) sqlite.prepare(`ALTER TABLE signed_contracts ADD COLUMN submitted_json TEXT`).run();
    if (!cols.has('match_count')) sqlite.prepare(`ALTER TABLE signed_contracts ADD COLUMN match_count INTEGER`).run();
    if (!cols.has('placement_id')) sqlite.prepare(`ALTER TABLE signed_contracts ADD COLUMN placement_id TEXT`).run();

    // OWNER's animal Luna, adopted through an open contract link: the signing
    // created OWNER's profile s-orphan, which looks like o-match (another rescue's).
    sqlite.prepare(`INSERT INTO org_members (id, org_id, user_email) VALUES ('om1', 'org-1', ?), ('om2', 'org-1', ?)`).run(OWNER, MATE);
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES
        ('o-match', 'Juan Perez', '5', ?, 1000, 1000), ('s-orphan', 'Juan Pérez', '5', ?, 2000, 2000)`).run(STRANGER, OWNER);
    sqlite.prepare(`INSERT INTO animals (id, name, species, added_by, created_at, updated_at) VALUES ('an-1', 'Luna', 'cat', ?, 1, 1)`).run(OWNER);
    sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, status, started_at, contract_key, recorded_by)
        VALUES ('pl-1', 'an-1', 's-orphan', 'adoption', 'active', 3000, 'contracts/an-1/k1.pdf', 'contract')`).run();
    sqlite.prepare(`INSERT INTO signed_contracts (id, animal_id, adopter_id, file_key, via, signed_at, submitted_json, match_count, placement_id)
        VALUES ('sc-1', 'an-1', 's-orphan', 'contracts/an-1/k1.pdf', 'open', 3000, ?, 1, 'pl-1')`).run(JSON.stringify(TYPED));
    sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, match_values, score, confidence, status, detected_at)
        VALUES ('dc-1', 's-orphan', 'o-match', '["name_full"]', '{}', 30, 'medium', 'pending', 1)`).run();
    // No notification row at all: deleted, or never written.
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM notifications`).get()!.n).toBe(0);
});

describe('the notice deleted: the signed contract is the home', () => {
    it('content: what the adopter typed and the match count, for the rescue and its teammate', async () => {
        for (const viewer of [OWNER, MATE]) {
            const r = await loadContractResult(db, 'sc-1', viewer);
            expect(r.status).toBe('found');
            if (r.status !== 'found') return;
            expect(r.view).toMatchObject({ kind: 'signed', notificationId: null, signedContractId: 'sc-1', animalId: 'an-1', animalName: 'Luna', adopterId: 's-orphan', adopterName: 'Juan Pérez', matchCount: 1 });
            expect(r.view.submittedData).toEqual(TYPED);
        }
    });

    it('action: «Sí, es la misma persona» works by the signed-contract id (a teammate)', async () => {
        const res = await as(MATE, () => attachContractToExistingAdopter('sc-1', 'o-match'));
        expect(res).toMatchObject({ success: true, matchedProfileUrl: '/adopter/o-match' });
        expect(sqlite.prepare('SELECT deleted_at FROM adopters WHERE id = ?').get('s-orphan')!.deleted_at).not.toBeNull();
    });

    it('door: the record carries the id its «Datos y posibles duplicados» button opens', async () => {
        const rows = await (db as { select: () => { from: (t: unknown) => { where: (w: unknown) => { all: () => Promise<Array<{ id: string; hasContract: number | null }>> } } } })
            .select().from(adoptions).where(eq(adoptions.adopterId, 's-orphan')).all();
        const [rec] = await attachSignedContractIds(db, rows, { op: 'test' });
        expect(rec).toMatchObject({ id: 'an-1', hasContract: 1, signedContractId: 'sc-1' });
        expect(contractResultsHref(rec.signedContractId, { adopter: 's-orphan' })).toBe('/contract-results/sc-1?from=adopter%3As-orphan');
    });

    it('another rescue gets nothing: not the content, not the action', async () => {
        expect((await loadContractResult(db, 'sc-1', STRANGER)).status).toBe('denied');
        expect(await as(STRANGER, () => attachContractToExistingAdopter('sc-1', 'o-match'))).toMatchObject({ success: false, error: 'Not authorized for this notification' });
        expect(sqlite.prepare('SELECT deleted_at FROM adopters WHERE id = ?').get('s-orphan')!.deleted_at).toBeNull();
    });

    it('an admin opens it; an unknown id and a deleted animal are simply not found', async () => {
        expect((await loadContractResult(db, 'sc-1', ADMIN)).status).toBe('found');
        expect((await loadContractResult(db, 'nope', OWNER)).status).toBe('not_found');
        sqlite.prepare(`UPDATE animals SET deleted_at = 5 WHERE id = 'an-1'`).run();
        expect((await loadContractResult(db, 'sc-1', OWNER)).status).toBe('not_found');
    });

    it('an older contract without a signed_contracts row: no id, so only the PDF button', async () => {
        sqlite.prepare(`DELETE FROM signed_contracts`).run();
        const [rec] = await attachSignedContractIds(db, [{ id: 'an-1', hasContract: 1 }], { op: 'test' });
        expect(rec.signedContractId).toBeUndefined();
    });
});

describe('the old notice id keeps today\'s rule (never narrower)', () => {
    beforeEach(() => {
        sqlite.prepare(`INSERT INTO notifications (id, user_id, type, title, body, metadata, created_at) VALUES ('n-1', ?, 'contract_result', 't', 'b', ?, 1)`)
            .run(OWNER, JSON.stringify({ notificationId: 'n-1', signedContractId: 'sc-1', animalId: 'an-1', animalName: 'Luna', adopterId: 's-orphan', adopterName: 'Juan Pérez', matchCount: 1, submittedData: TYPED }));
    });

    it('read from the notice, as before', async () => {
        const r = await loadContractResult(db, 'n-1', MATE);
        expect(r).toMatchObject({ status: 'found', view: { kind: 'notice', notificationId: 'n-1', signedContractId: 'sc-1', matchCount: 1 } });
        expect((await loadContractResult(db, 'n-1', STRANGER)).status).toBe('denied');
    });

    it('after a transfer: the recipient keeps the notice, the signed id follows the animal\'s new rescue', async () => {
        sqlite.prepare(`UPDATE animals SET added_by = ? WHERE id = 'an-1'`).run(STRANGER);
        expect((await loadContractResult(db, 'n-1', OWNER)).status).toBe('found');
        expect((await loadContractResult(db, 'sc-1', OWNER)).status).toBe('denied');
        expect((await loadContractResult(db, 'sc-1', STRANGER)).status).toBe('found');
    });

    it('a notice that is not a contract result is never opened as one', async () => {
        sqlite.prepare(`INSERT INTO notifications (id, user_id, type, title, body, metadata, created_at) VALUES ('n-other', ?, 'form_submission', 't', 'b', '{}', 1)`).run(OWNER);
        expect((await loadContractResult(db, 'n-other', OWNER)).status).toBe('not_contract');
        expect((await loadContractResult(db, 'n-other', MATE)).status).toBe('denied');
    });

    it('the action by the notice id still works', async () => {
        expect(await as(OWNER, () => attachContractToExistingAdopter('n-1', 'o-match'))).toMatchObject({ success: true });
    });
});
