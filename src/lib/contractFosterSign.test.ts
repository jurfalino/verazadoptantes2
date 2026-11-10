/**
 * Fostered animals take contracts; signing is compare-and-swap. Real SQL on the
 * real schema (migratedDb), `updateRecord` called with the submit route's exact
 * arguments and the adoptions-view row as `existing`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { session, getUser, isAdmin, OWNER } from '@/test-utils/actionMocks';
import * as mocks from '@/test-utils/actionMocks';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));
vi.mock('@/lib/orgMembership', () => ({
    isOrgMate: mocks.isOrgMate,
    getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    isOwnerOrOrgMate: mocks.isOwnerOrOrgMate,
    getTeamEmails: async (e: string) => mocks.getOrgMemberEmailsFor(e),
}));
vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser }));
vi.mock('@/auth', () => ({ auth: async () => (session.user ? { user: { email: session.user } } : null) }));
vi.mock('@/config/admins', () => ({ isAdminAsync: isAdmin, isModeratorOrAdminAsync: isAdmin }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/contractUrl', () => ({ getContractBaseUrl: async () => 'https://contract.example' }));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn(async () => undefined) }));
vi.mock('@/lib/pendingSearchLog', () => ({ closePendingSearchesForAdopter: vi.fn(async () => undefined) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'errid') },
    generateErrorId: () => 'errid',
}));

import { updateRecord } from '@/app/actions/_recordWrite';
import { createContractInvitation } from '@/app/actions/contract';
import { signRefused } from '@/domain/placements';
import { adoptions } from '@/db/schema';
import { eq } from 'drizzle-orm';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] }; exec: (s: string) => void };

const app = (id: string) => sqlite.prepare('SELECT * FROM applications WHERE id = ?').get(id)!;
const active = () => sqlite.prepare("SELECT * FROM placements WHERE animal_id = 'an1' AND ended_at IS NULL").all();
/** The view row the submit route reads. */
function viewRow(): Record<string, unknown> {
    return (state.db as { select: () => { from: (t: unknown) => { where: (c: unknown) => { get: () => Record<string, unknown> } } } })
        .select().from(adoptions).where(eq(adoptions.id, 'an1')).get();
}
/** The submit route's call, verbatim. */
const sign = (adopterId: string, invitation: boolean, existing = viewRow()) => updateRecord(state.db, {
    id: 'an1', adopterId, recordType: 'adoption', date: new Date(), status: 'active', rating: null, comments: null,
    deliveredToHome: null, verifiedAddress: null, identityVerified: null, onBehalfOf: null, sourceUrl: null,
}, existing, 'contract', { cas: true, adoptionVia: invitation ? 'invitation' : 'open_link' });

function candidate(id: string, adopterId: string) {
    sqlite.prepare('INSERT INTO form_submissions (id, user_id, name, linked_adopter_id, selected_animal_id, created_at) VALUES (?, ?, ?, ?, ?, 1000)').run(id, OWNER, id, adopterId, 'an1');
    sqlite.prepare('INSERT INTO applications (id, submission_id, animal_id, origin, state, created_at) VALUES (?, ?, ?, ?, ?, 1000)').run(`app-${id}`, id, 'an1', 'form', 'open');
}

describe('fostered animals take contracts', () => {
    beforeEach(() => {
        const m = migratedDb();
        state.db = m.db;
        sqlite = m.sqlite as unknown as typeof sqlite;
        session.user = OWNER;
        for (const id of ['fo', 'a', 'b', 'c']) {
            sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES (?, ?, '5', ?, 1000, 1000)`).run(id, id, OWNER);
        }
        sqlite.prepare(`INSERT INTO animals (id, name, species, sex, added_by, created_at, updated_at) VALUES ('an1', 'Nina', 'cat', 'hembra', ?, 1000, 1000)`).run(OWNER);
        sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at, verified_address, delivered_to_home, identity_verified, on_behalf_of, source_url)
            VALUES ('f1', 'an1', 'fo', 'foster', 1000, 'Casa tránsito 1', 1, 1, 'X', 'https://example.com/foster')`).run();
        candidate('sa', 'a');
        candidate('sc', 'c');
    });

    it('signing for a fostered animal ends the foster and opens the adoption — one active placement', async () => {
        const res = await sign('a', true);
        expect(res.lost).toBe(false);
        const rows = active();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ adopter_id: 'a', record_type: 'adoption' });
        expect(sqlite.prepare("SELECT ended_at FROM placements WHERE id = 'f1'").get()!.ended_at).not.toBeNull();
    });

    it('the new adoption placement inherits nothing from the foster home', async () => {
        await sign('a', true);
        expect(active()[0]).toMatchObject({
            verified_address: null, delivered_to_home: null, identity_verified: null, on_behalf_of: null, source_url: null,
        });
    });

    it('an open-link signature closes the other candidates as adopted_open_link with offer_done_at set', async () => {
        const res = await sign('a', false);
        expect(res.closedApplications).toBe(1);
        expect(app('app-sc')).toMatchObject({ state: 'closed', close_reason: 'adopted_open_link' });
        expect(app('app-sc').offer_done_at).toEqual(expect.any(Number));
    });

    it('an invitation signature closes the other candidates as adopted_other', async () => {
        await sign('a', true);
        expect(app('app-sc')).toMatchObject({ state: 'closed', close_reason: 'adopted_other' });
        expect(app('app-sa').state).toBe('adopted');
    });

    it('the tokenless open link still refuses a fostered animal; only a token signs it', () => {
        const fostered = { adopterId: 'fo', recordType: 'foster' };
        expect(signRefused({ invitation: null, animal: fostered })).toBe(true);
        expect(signRefused({ invitation: {}, animal: fostered })).toBe(false);
        expect(signRefused({ invitation: null, animal: { adopterId: null, recordType: 'available' } })).toBe(false);
        expect(signRefused({ invitation: {}, animal: { adopterId: 'x', recordType: 'adoption' } })).toBe(true);
        expect(signRefused({ invitation: null, animal: { adopterId: 'x', recordType: 'adoption' } })).toBe(true);
    });

    it('a signature on a fostered animal loses to a concurrent adoption: lost=true, the other adoption stays active', async () => {
        const stale = viewRow(); // read while fostered
        sqlite.prepare("UPDATE placements SET ended_at = 2000 WHERE id = 'f1'").run();
        sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at) VALUES ('p9', 'an1', 'b', 'adoption', 2000)`).run();
        const res = await sign('a', true, stale);
        expect(res.lost).toBe(true);
        const rows = active();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ id: 'p9', adopter_id: 'b', record_type: 'adoption' });
    });

    it('createContractInvitation accepts a fostered animal and refuses an adopted one', async () => {
        const ok = await createContractInvitation('an1', 'a');
        expect(ok).toMatchObject({ success: true });
        sqlite.prepare("UPDATE placements SET ended_at = 2000 WHERE id = 'f1'").run();
        sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at) VALUES ('p9', 'an1', 'b', 'adoption', 2000)`).run();
        const refused = await createContractInvitation('an1', 'a');
        expect(refused).toMatchObject({ success: false, error: 'Animal already adopted' });
    });
});
