/**
 * An adoption closes the other candidates of the animal — at the single write
 * point (`updateRecord`). Real SQL on the real schema (migratedDb).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { session, getUser, isAdmin, OWNER, MATE, STRANGER } from '@/test-utils/actionMocks';
import * as mocks from '@/test-utils/actionMocks';

const { state, log } = vi.hoisted(() => ({
    state: { db: null as unknown },
    log: { error: vi.fn(() => 'errid') },
}));
vi.mock('@/lib/orgMembership', () => ({
    isOrgMate: mocks.isOrgMate,
    getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    isOwnerOrOrgMate: mocks.isOwnerOrOrgMate,
    getTeamEmails: async (e: string) => mocks.getOrgMemberEmailsFor(e),
}));
vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser }));
vi.mock('@/config/admins', () => ({ isAdminAsync: isAdmin, isModeratorOrAdminAsync: isAdmin }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn(async () => undefined) }));
vi.mock('@/lib/pendingSearchLog', () => ({ closePendingSearchesForAdopter: vi.fn(async () => undefined) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: log.error },
}));

import { updateRecord } from '@/app/actions/_recordWrite';
import { saveRecordFor } from '@/lib/recordSave';
import { APPLICATION_AUTO_ACTOR } from '@/domain/constants';
import { adoptions } from '@/db/schema';
import { eq } from 'drizzle-orm';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] }; exec: (s: string) => void };

const app = (id: string) => sqlite.prepare('SELECT * FROM applications WHERE id = ?').get(id)!;
const history = (adopterId: string) => sqlite.prepare("SELECT * FROM adopter_history WHERE adopter_id = ? AND changes LIKE '%application_closed%'").all(adopterId);

/** A form (owned by `owner`'s link) from an applicant profile, with its application. */
function candidate(id: string, adopterId: string | null, owner = OWNER, animalId: string | null = 'an1', state = 'open') {
    sqlite.prepare('INSERT INTO form_submissions (id, user_id, name, linked_adopter_id, selected_animal_id, created_at) VALUES (?, ?, ?, ?, ?, 1000)').run(id, owner, id, adopterId, animalId);
    sqlite.prepare('INSERT INTO applications (id, submission_id, animal_id, origin, state, created_at) VALUES (?, ?, ?, ?, ?, 1000)').run(`app-${id}`, id, animalId, 'form', state);
}
/** The record as saveRecordFor reads it: the drizzle row of the adoptions view. */
function existing(): Record<string, unknown> {
    return (state.db as { select: () => { from: (t: unknown) => { where: (c: unknown) => { get: () => Record<string, unknown> } } } })
        .select().from(adoptions).where(eq(adoptions.id, 'an1')).get();
}
const adopt = (adopterId: string, opts: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
    updateRecord(state.db, { id: 'an1', recordType: 'adoption', adopterId, ...extra }, existing(), OWNER, { cas: true, ...opts });

describe('an adoption closes the other candidates', () => {
    beforeEach(() => {
        const m = migratedDb();
        state.db = m.db;
        sqlite = m.sqlite as unknown as typeof sqlite;
        session.user = OWNER;
        log.error.mockClear();
        for (const id of ['ad1', 'ad2', 'ad3']) {
            sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES (?, ?, '5', ?, 1000, 1000)`).run(id, id, OWNER);
        }
        sqlite.prepare(`INSERT INTO animals (id, name, species, sex, added_by, created_at, updated_at) VALUES ('an1', 'Nina', 'cat', 'hembra', ?, 1000, 1000)`).run(OWNER);
        candidate('s1', 'ad1');            // the adopter's own
        candidate('s2', 'ad2');            // another candidate
        candidate('s3', 'ad3', MATE);      // another candidate, via a teammate's link
    });

    it('available → adoption: others close (adopted_other), the adopter\'s own → adopted, a history row each by the automatic actor, kind contribution', async () => {
        const res = await adopt('ad1');
        expect(res).toMatchObject({ lost: false, closedApplications: 2 });
        expect(app('app-s1')).toMatchObject({ state: 'adopted', close_reason: null });
        for (const id of ['app-s2', 'app-s3']) {
            expect(app(id)).toMatchObject({ state: 'closed', close_reason: 'adopted_other', closed_by: APPLICATION_AUTO_ACTOR });
            expect(app(id).closed_at).toEqual(expect.any(Number));
        }
        for (const ad of ['ad2', 'ad3']) {
            const rows = history(ad);
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({ changed_by: APPLICATION_AUTO_ACTOR, kind: 'contribution' });
            expect(JSON.parse(rows[0].changes as string)).toEqual({
                application_closed: { animalId: 'an1', animalName: 'Nina', animalSex: 'hembra', reason: 'adopted_other' },
            });
        }
        expect(history('ad1')).toHaveLength(0);
    });

    it('foster → adoption (ended then opened) closes them too', async () => {
        sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at) VALUES ('f1', 'an1', 'ad1', 'foster', 1000)`).run();
        const res = await adopt('ad1');
        expect(res).toMatchObject({ lost: false, closedApplications: 2 });
        expect(app('app-s2').state).toBe('closed');
    });

    it('the adoption clears every bell notice of the forms it decided (closed and adopted), for everyone; another form\'s stays', async () => {
        const notice = (id: string, userId: string, submissionId: string) => sqlite.prepare(`INSERT INTO notifications (id, user_id, type, title, body, read, metadata) VALUES (?, ?, 'form_submission', 't', 'b', 0, ?)`)
            .run(id, userId, JSON.stringify({ submissionId }));
        notice('n-s1', OWNER, 's1');
        notice('n-s2', OWNER, 's2');
        notice('n-s3-mate', MATE, 's3');
        notice('n-s3-owner', OWNER, 's3');
        candidate('s4', null, OWNER, null); // a general form: not this animal's
        notice('n-s4', OWNER, 's4');
        await adopt('ad1');
        const unread = sqlite.prepare('SELECT id FROM notifications WHERE read = 0 ORDER BY id').all().map(r => r.id);
        expect(unread).toEqual(['n-s4']);
    });

    it('a FOSTER placement closes nothing', async () => {
        const res = await updateRecord(state.db, { id: 'an1', recordType: 'foster', adopterId: 'ad1' }, existing(), OWNER, { cas: true });
        expect(res.lost).toBe(false);
        expect(res.closedApplications ?? 0).toBe(0);
        expect(sqlite.prepare("SELECT COUNT(*) AS n FROM applications WHERE state = 'open'").get()!.n).toBe(3);
    });

    it('a lost CAS race (someone else holds the animal) closes nothing and returns lost', async () => {
        const stale = existing(); // planned against «available»
        sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at) VALUES ('p9', 'an1', 'ad2', 'adoption', 1000)`).run();
        const res = await updateRecord(state.db, { id: 'an1', recordType: 'adoption', adopterId: 'ad1' }, stale, OWNER, { cas: true });
        expect(res.lost).toBe(true);
        expect(res.closedApplications ?? 0).toBe(0);
        expect(sqlite.prepare("SELECT COUNT(*) AS n FROM applications WHERE state = 'open'").get()!.n).toBe(3);
    });

    it('via open_link (anyone can sign it): the other candidates stay open and nothing lands on their profiles (review S1)', async () => {
        const res = await adopt('ad1', { adoptionVia: 'open_link' });
        expect(res.closedApplications ?? 0).toBe(0);
        for (const id of ['app-s2', 'app-s3']) {
            expect(app(id)).toMatchObject({ state: 'open', close_reason: null });
            expect(app(id).offer_done_at).toBeNull();
        }
        expect(history('ad2')).toEqual([]);
    });

    it('a forged outsider row (form link outside the owner\'s team) is left untouched', async () => {
        candidate('s4', 'ad3', STRANGER);
        sqlite.prepare("INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('ad4', 'ad4', '5', 'x', 1000, 1000)").run();
        await adopt('ad1');
        expect(app('app-s4')).toMatchObject({ state: 'open', close_reason: null });
    });

    it('a form whose application row is missing is healed and closed too', async () => {
        sqlite.prepare('INSERT INTO form_submissions (id, user_id, name, linked_adopter_id, selected_animal_id, created_at) VALUES (?, ?, ?, ?, ?, 1000)').run('s5', OWNER, 's5', 'ad2', 'an1');
        const res = await adopt('ad1');
        expect(res.closedApplications).toBe(3);
        expect(app('app-s5').state).toBe('closed');
    });

    it('a failure inside the close never throws into the adoption: placement landed, logger.error called with { animalId, adopterId }', async () => {
        sqlite.exec('DROP TABLE applications');
        const res = await adopt('ad1');
        expect(res.lost).toBe(false);
        expect(res.closedApplications ?? 0).toBe(0);
        expect(sqlite.prepare("SELECT adopter_id FROM placements WHERE animal_id = 'an1' AND ended_at IS NULL").get()).toEqual({ adopter_id: 'ad1' });
        expect(log.error).toHaveBeenCalledWith('closeApplicationsOnAdoption failed', expect.anything(), expect.objectContaining({ animalId: 'an1', adopterId: 'ad1' }));
    });

    it('saveRecordFor reports closedApplications for the in-app adoption of an inventory animal', async () => {
        const res = await saveRecordFor({ id: 'an1', recordType: 'adoption', adopterId: 'ad1' } as never, undefined, { notifyOwnerTeam: false });
        expect(res.closedApplications).toEqual({ animalId: 'an1', count: 2 });
        expect(app('app-s2').state).toBe('closed');
    });
});
