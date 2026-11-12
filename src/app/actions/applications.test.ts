/**
 * The evaluation actions (spec 2026-11-10): «No avanzar» as a regular
 * observation, «Proponer un animal» for a general application, the
 * possible-duplicate cards inside the panel, and the offer to tell the other
 * candidates after an adoption. Real SQL on the real schema (migratedDb).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';
import {
    asyncDb, seedEvaluation, snapshot, adopter, animal, placement, form, application, invitation, formNotice, unreadNotices, NOW, DAY, type Sqlite,
} from '@/test-utils/applicationFixtures';

const { session, OWNER, MATE, STRANGER } = mocks;

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));

vi.mock('./_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/config/admins', () => ({ isAdminAsync: mocks.isAdmin, isAdminAsyncStrict: mocks.isAdmin, isModeratorOrAdminAsync: mocks.isAdmin, isAdmin: (e: string) => e === mocks.ADMIN }));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOrgMate: mocks.isOrgMate, isOrgMateStrict: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    isOwnerOrOrgMate: mocks.isOwnerOrOrgMate,
    getTeamEmails: async (email: string) => mocks.getOrgMemberEmailsFor((email ?? '').trim().toLowerCase()),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn(async () => undefined) }));
vi.mock('@/lib/pendingSearchLog', () => ({ closePendingSearchesForAdopter: vi.fn(async () => undefined) }));
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

import { declineApplication, proposeAnimal, getProposalAnimals, getAdoptionOffer, markOfferDone, getApplicationDuplicates } from './applications';
import { loadApplicantsForAnimal } from './_applicants';
import { applications as applicationsTable, adopterEvents as adopterEventsTable, adoptions as adoptionsView } from '@/db/schema';
import { GET as contractByToken } from '@/app/api/contract/by-token/[token]/route';

let sqlite: Sqlite;
const appRow = (id: string) => sqlite.prepare('SELECT * FROM applications WHERE id = ?').get(id)!;
const events = (id: string) => sqlite.prepare('SELECT * FROM adopter_events WHERE id = ?').all(id);

beforeEach(() => {
    const m = migratedDb();
    state.db = asyncDb(m.db);
    sqlite = m.sqlite as unknown as Sqlite;
    session.user = OWNER;
    seedEvaluation(sqlite);
});
afterEach(() => { vi.useRealTimers(); });

const DECLINE = { text: 'No avanzamos con su solicitud para Luna.', reason: 'Vive en un departamento sin red en el balcón', rating: 4 };

describe('declineApplication («No avanzar»)', () => {
    it('declineApplication writes one observation (rating, text\\nreason, animalId) and marks the application declined with its record id', async () => {
        const res = await declineApplication('app-s-luna', DECLINE);
        expect(res).toEqual({ ok: true, recordId: 'decline-app-s-luna' });
        const rows = events('decline-app-s-luna');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            adopter_id: 'ana', event_type: 'observation', rating: 4, animal_id: 'luna', animal_name: 'Luna',
            details: `${DECLINE.text}\n${DECLINE.reason}`, recorded_by: OWNER,
        });
        expect(appRow('app-s-luna')).toMatchObject({ state: 'declined', decline_record_id: 'decline-app-s-luna', closed_by: OWNER });
        expect(appRow('app-s-luna').closed_at).toEqual(expect.any(Number));
        // A regular observation: it lands in the profile's history like any other record.
        expect(sqlite.prepare("SELECT * FROM adopter_history WHERE adopter_id = 'ana' AND changes LIKE '%adoption_added%'").all()).toHaveLength(1);
    });

    it('a general application: the observation names no animal', async () => {
        expect(await declineApplication('app-s-gen', { ...DECLINE, text: 'No avanzamos con su solicitud.' })).toEqual({ ok: true, recordId: 'decline-app-s-gen' });
        expect(events('decline-app-s-gen')[0]).toMatchObject({ adopter_id: 'beto', animal_id: null, animal_name: null });
        expect(appRow('app-s-gen')).toMatchObject({ state: 'declined', decline_record_id: 'decline-app-s-gen' });
    });

    it('declineApplication twice → one adopter_events row, state declined once', async () => {
        // A retry after the first landed (the client saw a timeout): the same viewer is told it worked —
        // never «No se guardó tu observación»; a teammate after it is told it is already decided.
        expect(await declineApplication('app-s-luna', DECLINE)).toMatchObject({ ok: true });
        expect(await declineApplication('app-s-luna', DECLINE)).toEqual({ ok: true, recordId: 'decline-app-s-luna' });
        session.user = MATE;
        expect(await declineApplication('app-s-luna', { ...DECLINE, rating: 1 })).toEqual({ ok: false, error: 'already_decided' });
        session.user = OWNER;
        expect(events('decline-app-s-luna')).toHaveLength(1);
        expect(events('decline-app-s-luna')[0]).toMatchObject({ rating: 4, recorded_by: OWNER });
        const closedAt = appRow('app-s-luna').closed_at;

        // A network retry after the observation landed but the application did not
        // close (timeout between write 1 and write 3): the pre-seeded id makes the
        // retry the SAME record, never a second observation.
        sqlite.prepare("UPDATE applications SET state = 'open', decline_record_id = NULL, closed_at = NULL, closed_by = NULL WHERE id = 'app-s-luna'").run();
        expect(await declineApplication('app-s-luna', DECLINE)).toEqual({ ok: true, recordId: 'decline-app-s-luna' });
        expect(events('decline-app-s-luna')).toHaveLength(1);
        expect(sqlite.prepare("SELECT COUNT(*) AS n FROM adopter_events WHERE adopter_id = 'ana'").get()!.n).toBe(1);
        expect(appRow('app-s-luna')).toMatchObject({ state: 'declined', decline_record_id: 'decline-app-s-luna' });
        expect(closedAt).toEqual(expect.any(Number));
    });

    it('two concurrent taps → one observation, the application declined once', async () => {
        const results = await Promise.all([declineApplication('app-s-gen', DECLINE), declineApplication('app-s-gen', DECLINE)]);
        expect(results.filter(r => r.ok)).not.toHaveLength(0);
        for (const r of results) if (!r.ok) expect(r.error).toBe('already_decided');
        expect(events('decline-app-s-gen')).toHaveLength(1);
        expect(appRow('app-s-gen')).toMatchObject({ state: 'declined', decline_record_id: 'decline-app-s-gen' });
    });

    it("a second decliner with different text, while the first one's observation is written but the application not yet closed → the first one's text intact, already_decided (final review M8)", async () => {
        // MATE's «No avanzar» wrote its observation; its close has not landed (in flight, or a timeout).
        sqlite.prepare(`INSERT INTO adopter_events (id, adopter_id, event_type, animal_id, animal_name, rating, details, recorded_by, created_at)
            VALUES ('decline-app-s-luna', 'ana', 'observation', 'luna', 'Luna', 2, 'Texto de Mate\nMotivo de Mate', ?, 1000)`).run(MATE);
        const before = events('decline-app-s-luna');
        expect(await declineApplication('app-s-luna', { ...DECLINE, rating: 5 })).toEqual({ ok: false, error: 'already_decided' });
        // Nothing of OWNER's was written over MATE's observation.
        expect(events('decline-app-s-luna')).toEqual(before);
        expect(sqlite.prepare("SELECT COUNT(*) AS n FROM adopter_events WHERE adopter_id = 'ana'").get()!.n).toBe(1);
        // The application ends with MATE's observation (never stuck open behind a record only MATE could finish).
        expect(appRow('app-s-luna')).toMatchObject({ state: 'declined', decline_record_id: 'decline-app-s-luna', closed_by: MATE });
    });

    it('the first decliner, whose close another tap finished with ITS OWN observation, is told it worked (final review M8)', async () => {
        // Between this call's observation and its close, a teammate's call finished the decline with that observation.
        const real = (state.db as { update: (t: unknown) => unknown }).update.bind(state.db);
        let raced = false;
        state.db = new Proxy(state.db as object, {
            get(t, p, r) {
                if (p === 'update') return (table: unknown) => {
                    if (!raced && table === applicationsTable) {
                        raced = true;
                        sqlite.prepare(`UPDATE applications SET state = 'declined', decline_record_id = 'decline-app-s-luna', closed_by = ? WHERE id = 'app-s-luna'`).run(MATE);
                    }
                    return real(table);
                };
                return Reflect.get(t, p, r);
            },
        });
        expect(await declineApplication('app-s-luna', DECLINE)).toEqual({ ok: true, recordId: 'decline-app-s-luna' });
        expect(events('decline-app-s-luna')[0]).toMatchObject({ details: `${DECLINE.text}\n${DECLINE.reason}`, recorded_by: OWNER });
    });

    it('the observation landed, then the application closed another way before its own close → «quedó guardada» (review M1)', async () => {
        // Between this call's observation and its close, the animal was adopted by another candidate.
        const real = (state.db as { update: (t: unknown) => unknown }).update.bind(state.db);
        let raced = false;
        state.db = new Proxy(state.db as object, {
            get(t, p, r) {
                if (p === 'update') return (table: unknown) => {
                    if (!raced && table === applicationsTable) {
                        raced = true;
                        sqlite.prepare(`UPDATE applications SET state = 'closed', close_reason = 'adopted_other', closed_by = 'automatic' WHERE id = 'app-s-luna'`).run();
                    }
                    return real(table);
                };
                return Reflect.get(t, p, r);
            },
        });
        expect(await declineApplication('app-s-luna', DECLINE)).toEqual({ ok: false, error: 'observation_saved_already_decided' });
        // It IS on the profile — what the copy now says.
        expect(events('decline-app-s-luna')).toHaveLength(1);
        expect(events('decline-app-s-luna')[0]).toMatchObject({ rating: 4, recorded_by: OWNER });
        expect(appRow('app-s-luna')).toMatchObject({ state: 'closed', decline_record_id: null });
    });

    const mateWrites = () => sqlite.prepare(`INSERT INTO adopter_events (id, adopter_id, event_type, animal_id, animal_name, rating, details, recorded_by, created_at)
        VALUES ('decline-app-s-luna', 'ana', 'observation', 'luna', 'Luna', 2, 'Texto de Mate\nMotivo de Mate', ?, 1000)`).run(MATE);

    it('two decliners at once, the other\'s observation written between our check and our insert → theirs intact, already_decided (review M2)', async () => {
        const real = (state.db as { insert: (t: unknown) => unknown }).insert.bind(state.db);
        let raced = false;
        state.db = new Proxy(state.db as object, {
            get(t, p, r) {
                if (p === 'insert') return (table: unknown) => {
                    if (!raced && table === adopterEventsTable) { raced = true; mateWrites(); }
                    return real(table);
                };
                return Reflect.get(t, p, r);
            },
        });
        const before = () => events('decline-app-s-luna');
        expect(await declineApplication('app-s-luna', { ...DECLINE, rating: 5 })).toEqual({ ok: false, error: 'already_decided' });
        expect(before()).toHaveLength(1);
        expect(before()[0]).toMatchObject({ rating: 2, details: 'Texto de Mate\nMotivo de Mate', recorded_by: MATE });
        // No history row or notice of OWNER's (nothing of this call was written); the application ends with MATE's.
        expect(sqlite.prepare("SELECT * FROM adopter_history WHERE adopter_id = 'ana' AND changes LIKE '%adoption_added%'").all()).toHaveLength(0);
        expect(appRow('app-s-luna')).toMatchObject({ state: 'declined', decline_record_id: 'decline-app-s-luna', closed_by: MATE });
    });

    it('two decliners at once, the other\'s observation written before our save reads it → never the edit branch over it (review M2)', async () => {
        // The window the edit branch used to take: after step 0, before saveRecordFor's read.
        const real = (state.db as { select: (...a: unknown[]) => unknown }).select.bind(state.db);
        let raced = false;
        state.db = new Proxy(state.db as object, {
            get(t, p, r) {
                if (p === 'select') return (...args: unknown[]) => {
                    const builder = real(...args) as { from: (tbl: unknown) => unknown };
                    return new Proxy(builder as object, {
                        get(bt, bp, br) {
                            if (bp === 'from') return (tbl: unknown) => {
                                if (!raced && tbl === adoptionsView) { raced = true; mateWrites(); }
                                return (bt as { from: (x: unknown) => unknown }).from(tbl);
                            };
                            return Reflect.get(bt, bp, br);
                        },
                    });
                };
                return Reflect.get(t, p, r);
            },
        });
        expect(await declineApplication('app-s-luna', { ...DECLINE, rating: 5 })).toEqual({ ok: false, error: 'already_decided' });
        expect(raced).toBe(true);
        expect(events('decline-app-s-luna')[0]).toMatchObject({ rating: 2, details: 'Texto de Mate\nMotivo de Mate', recorded_by: MATE });
        expect(appRow('app-s-luna')).toMatchObject({ state: 'declined', decline_record_id: 'decline-app-s-luna', closed_by: MATE });
    });

    it('declineApplication on a live contract retires the link (by-token would answer expired)', async () => {
        animal(sqlite, 'kira', 'Kira', OWNER);
        invitation(sqlite, 't-live', 'luna', 'ana', NOW + 29 * DAY);
        invitation(sqlite, 't-open-ended', 'luna', 'ana', null);
        invitation(sqlite, 't-other-animal', 'kira', 'ana', NOW + 29 * DAY);
        invitation(sqlite, 't-used', 'luna', 'ana', NOW + 29 * DAY, NOW - 10);
        const ask = (token: string) => contractByToken(new Request(`http://localhost/api/contract/by-token/${token}`), { params: Promise.resolve({ token }) });
        const codeOf = async (res: Response) => ((await res.json()) as { code?: string }).code;
        expect(await codeOf(await ask('t-live'))).not.toBe('expired');

        expect(await declineApplication('app-s-luna', DECLINE)).toMatchObject({ ok: true });
        const inv = (t: string) => sqlite.prepare('SELECT * FROM contract_invitations WHERE token = ?').get(t)!;
        const now = Math.floor(Date.now() / 1000);
        for (const t of ['t-live', 't-open-ended']) expect(inv(t).expires_at as number).toBeLessThanOrEqual(now);
        // Another animal's link and a used link are not this decision's.
        expect(inv('t-other-animal').expires_at).toBe(NOW + 29 * DAY);
        expect(inv('t-used').expires_at).toBe(NOW + 29 * DAY);

        // by-token reads a link as expired once its second has passed (expires_at < now).
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime((now + 1) * 1000);
        for (const t of ['t-live', 't-open-ended']) {
            const res = await ask(t);
            expect(res.status).toBe(410);
            expect(await codeOf(res)).toBe('expired');
        }
        // And the panel no longer reads «Contrato enviado»: the application is declined.
        vi.useRealTimers();
        const list = await loadApplicantsForAnimal(state.db, { id: 'luna', adopterId: null }, [OWNER, MATE], OWNER);
        expect(list.find(a => a.applicationId === 'app-s-luna')!.status).toMatchObject({ kind: 'declined' });
    });

    it('declineApplication refuses rating 0, rating 6, a blank reason', async () => {
        const before = snapshot(sqlite);
        for (const input of [
            { ...DECLINE, rating: 0 }, { ...DECLINE, rating: 6 }, { ...DECLINE, rating: 3.5 }, { ...DECLINE, rating: '4' as unknown as number },
            { ...DECLINE, reason: '   ' }, { ...DECLINE, reason: 'x'.repeat(2001) },
            { ...DECLINE, text: '' }, { ...DECLINE, text: 'x'.repeat(501) },
        ]) {
            expect(await declineApplication('app-s-luna', input)).toEqual({ ok: false, error: 'invalid' });
        }
        expect(snapshot(sqlite)).toEqual(before);
        // Trimmed values at the limits are fine.
        expect(await declineApplication('app-s-luna', { text: ` ${'t'.repeat(500)} `, reason: ` ${'r'.repeat(2000)} `, rating: 1 })).toMatchObject({ ok: true });
        expect(events('decline-app-s-luna')[0].details).toBe(`${'t'.repeat(500)}\n${'r'.repeat(2000)}`);
    });

    it('a form with no profile (auto-create failed) cannot be declined: not_allowed, nothing written', async () => {
        form(sqlite, 's-orphan', { animal: 'luna', adopter: null });
        application(sqlite, 'app-s-orphan', 's-orphan', 'luna');
        const before = snapshot(sqlite);
        expect(await declineApplication('app-s-orphan', DECLINE)).toEqual({ ok: false, error: 'not_allowed' });
        expect(snapshot(sqlite)).toEqual(before);
    });
});

describe('an outcome clears the form\'s bell notices, for everyone («answer once, cleared everywhere»)', () => {
    beforeEach(() => {
        formNotice(sqlite, 'n-luna-owner', OWNER, 's-luna');
        formNotice(sqlite, 'n-luna-mate', MATE, 's-luna');
        formNotice(sqlite, 'n-gen-owner', OWNER, 's-gen');
        formNotice(sqlite, 'n-gen-mate', MATE, 's-gen');
    });

    it('after «No avanzar», every notice for that form is read; another form\'s stays unread', async () => {
        expect(await declineApplication('app-s-luna', DECLINE)).toMatchObject({ ok: true });
        expect(unreadNotices(sqlite)).toEqual(['n-gen-mate', 'n-gen-owner']);
    });

    it('after «Proponer un animal», every notice for the general form is read; another form\'s stays unread', async () => {
        expect(await proposeAnimal('app-s-gen', 'luna')).toMatchObject({ ok: true });
        expect(unreadNotices(sqlite)).toEqual(['n-luna-mate', 'n-luna-owner']);
    });

    it('a refused outcome clears nothing', async () => {
        expect(await declineApplication('app-s-luna', { ...DECLINE, rating: 0 })).toMatchObject({ ok: false });
        expect(unreadNotices(sqlite)).toHaveLength(4);
    });
});

describe('proposeAnimal / getProposalAnimals («Proponer un animal»)', () => {
    beforeEach(() => {
        adopter(sqlite, 'fosterer', 'Hogar Tránsito', OWNER);
        adopter(sqlite, 'owner-of-mora', 'Familia Mora', OWNER);
        animal(sqlite, 'tito', 'Tito', OWNER, { species: 'dog', sex: 'macho' });
        placement(sqlite, 'p-tito', 'tito', 'fosterer', 'foster');
        animal(sqlite, 'mora', 'Mora', OWNER, { species: 'dog' });
        placement(sqlite, 'p-mora', 'mora', 'owner-of-mora', 'adoption');
        animal(sqlite, 'kira', 'Kira', MATE, { species: 'dog' });
        // Beto already applied for Kira through another form.
        form(sqlite, 's-beto-kira', { adopter: 'beto', animal: 'kira' });
        application(sqlite, 'app-s-beto-kira', 's-beto-kira', 'kira');
        // Someone else is a candidate of Tito.
        adopter(sqlite, 'dani', 'Dani', OWNER);
        form(sqlite, 's-dani', { adopter: 'dani', animal: 'tito' });
        application(sqlite, 'app-s-dani', 's-dani', 'tito');
        sqlite.prepare(`INSERT INTO adopter_images (id, adopter_id, adoption_id, url, is_primary, uploaded_at) VALUES ('img-tito-2', 'tito', 'tito', 'https://img/tito-2.jpg', 0, 1000), ('img-tito-1', 'tito', 'tito', 'https://img/tito-1.jpg', 1, 1001)`).run();
    });

    it('proposeAnimal creates a proposed candidate visible in loadApplicantsForAnimal and ends the general one as proposed', async () => {
        const res = await proposeAnimal('app-s-gen', 'luna');
        expect(res).toEqual({ ok: true, applicationId: expect.any(String) });
        const proposedId = (res as { applicationId: string }).applicationId;
        expect(proposedId.length + 'decline-'.length).toBeLessThanOrEqual(64); // a later «No avanzar» on it still fits the record id
        expect(appRow(proposedId)).toMatchObject({ submission_id: 's-gen', animal_id: 'luna', origin: 'proposed', state: 'open' });
        expect(appRow('app-s-gen')).toMatchObject({ state: 'proposed', proposed_application_id: proposedId, closed_by: OWNER });

        const list = await loadApplicantsForAnimal(state.db, { id: 'luna', adopterId: null }, [OWNER, MATE], OWNER);
        expect(list.find(a => a.applicationId === proposedId)).toMatchObject({ origin: 'proposed', adopterId: 'beto', status: { kind: 'to_evaluate' } });
    });

    it('a fostered animal takes a proposal; an adopted one answers animal_adopted; an open candidate already_candidate', async () => {
        const before = snapshot(sqlite);
        expect(await proposeAnimal('app-s-gen', 'mora')).toEqual({ ok: false, error: 'animal_adopted' });
        expect(await proposeAnimal('app-s-gen', 'kira')).toEqual({ ok: false, error: 'already_candidate' });
        expect(snapshot(sqlite)).toEqual(before);
        expect(await proposeAnimal('app-s-gen', 'tito')).toMatchObject({ ok: true });
    });

    it('only a general, open application is proposed: an animal application → not_allowed', async () => {
        expect(await proposeAnimal('app-s-luna', 'tito')).toEqual({ ok: false, error: 'not_allowed' });
    });

    it('proposeAnimal on an already-decided general application → already_decided, no stray proposed row', async () => {
        sqlite.prepare("UPDATE applications SET state = 'declined' WHERE id = 'app-s-gen'").run();
        expect(await proposeAnimal('app-s-gen', 'luna')).toEqual({ ok: false, error: 'already_decided' });
        expect(sqlite.prepare("SELECT * FROM applications WHERE origin = 'proposed'").all()).toHaveLength(0);
    });

    it('two concurrent proposals: one wins, the loser leaves no stray proposed row', async () => {
        const results = await Promise.all([proposeAnimal('app-s-gen', 'luna'), proposeAnimal('app-s-gen', 'tito')]);
        const won = results.filter(r => r.ok) as Array<{ ok: true; applicationId: string }>;
        expect(won).toHaveLength(1);
        for (const r of results) if (!r.ok) expect(r.error).toBe('already_decided');
        const proposed = sqlite.prepare("SELECT id FROM applications WHERE origin = 'proposed'").all();
        expect(proposed).toEqual([{ id: won[0].applicationId }]);
        expect(appRow('app-s-gen')).toMatchObject({ state: 'proposed', proposed_application_id: won[0].applicationId });
    });

    it('getProposalAnimals: fostered animals included, adopted excluded, matching species/life stage first, candidates count', async () => {
        const res = await getProposalAnimals('app-s-gen');
        expect(res).toEqual({
            ok: true,
            animals: [
                // «Prefiere» dog: Tito (fostered dog) first; Kira left out — Beto already applied for her.
                { id: 'tito', name: 'Tito', species: 'dog', photo: 'https://img/tito-1.jpg', matches: true, candidates: 1 },
                { id: 'luna', name: 'Luna', species: 'cat', photo: null, matches: false, candidates: 1 },
            ],
        });
    });

    it('getProposalAnimals for an animal application → not_allowed', async () => {
        expect(await getProposalAnimals('app-s-luna')).toEqual({ ok: false, error: 'not_allowed' });
    });
});

describe('getAdoptionOffer / markOfferDone (the offer to tell the others)', () => {
    beforeEach(() => {
        adopter(sqlite, 'cami', 'Cami Ruiz', OWNER);
        form(sqlite, 's-cami', { name: '  Cami  Ruiz ', adopter: 'cami', animal: 'luna', phone: '11 5555-0303', email: 'cami@example.com' });
        application(sqlite, 'app-s-cami', 's-cami', 'luna', { state: 'closed', closeReason: 'adopted_other' });
        adopter(sqlite, 'eva', 'Eva', OWNER);
        form(sqlite, 's-eva', { name: 'Eva', adopter: 'eva', animal: 'luna' });
        application(sqlite, 'app-s-eva', 's-eva', 'luna', { state: 'closed', closeReason: 'adopted_other', offerDoneAt: NOW - 10 });
        adopter(sqlite, 'fede', 'Fede', OWNER);
        form(sqlite, 's-fede', { name: 'Fede', adopter: 'fede', animal: 'luna' });
        application(sqlite, 'app-s-fede', 's-fede', 'luna', { state: 'closed', closeReason: 'adopted_open_link' });
        form(sqlite, 's-orphan', { name: 'Orphan', adopter: null, animal: 'luna' });
        application(sqlite, 'app-s-orphan', 's-orphan', 'luna', { state: 'closed', closeReason: 'adopted_other' });
    });

    it('getAdoptionOffer lists only adopted_other candidates not yet offered; markOfferDone empties it', async () => {
        expect(await getAdoptionOffer('luna')).toEqual({
            ok: true, animalName: 'Luna', animalSex: 'hembra',
            candidates: [{ applicationId: 'app-s-cami', firstName: 'Cami', phone: '11 5555-0303', email: 'cami@example.com' }],
        });
        expect(await markOfferDone('luna')).toEqual({ ok: true, count: 1 });
        expect(appRow('app-s-cami').offer_done_at).toEqual(expect.any(Number));
        expect(appRow('app-s-eva').offer_done_at).toBe(NOW - 10);
        expect(appRow('app-s-fede').offer_done_at).toBeNull();
        expect(await getAdoptionOffer('luna')).toMatchObject({ ok: true, candidates: [] });
        expect(await markOfferDone('luna')).toEqual({ ok: true, count: 0 });
    });

    it('the sheet lists exactly what the home row counts (offerCountsByAnimal)', async () => {
        const { offerCountsByAnimal } = await import('@/lib/applicationCounts');
        const counts = await offerCountsByAnimal(state.db, [OWNER, MATE]);
        const offer = await getAdoptionOffer('luna') as { candidates: unknown[] };
        expect(offer.candidates).toHaveLength(counts.get('luna') ?? 0);
    });
});

describe('getApplicationDuplicates (a possible duplicate inside the evaluation)', () => {
    const PHONE = '+54 9 11 5555-0109';
    const PRIVATE_EMAIL = 'carla.privada@example.com';

    beforeEach(() => {
        sqlite.prepare(`INSERT INTO app_config (key, value) VALUES ('ENABLE_PII_ACCESS_GATING', 'true')`).run();
        sqlite.prepare(`INSERT INTO user (id, name, email) VALUES ('u-stranger', 'Sofía Rescate', ?)`).run(STRANGER);
        // Another team's protected profile that looks like Ana: same phone, a private email.
        adopter(sqlite, 'carla', 'Ana P.', STRANGER, {
            contactInfo: `Tel: ${PHONE}\nEmail: ${PRIVATE_EMAIL}`,
            contactEntries: JSON.stringify([{ type: 'phone', value: PHONE }, { type: 'email', value: PRIVATE_EMAIL }]),
        });
        adopter(sqlite, 'nadie', 'Ana Anónima', 'anonymous');
        sqlite.prepare("UPDATE form_submissions SET phone = '11 5555-0109' WHERE id = 's-luna'").run();
        sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, match_values, score, confidence, status, detected_at)
            VALUES ('dc-1', 'ana', 'carla', '["phone"]', '{}', 80, 'high', 'pending', 1), ('dc-2', 'nadie', 'ana', '["name_full"]', '{}', 30, 'medium', 'pending', 1)`).run();
    });

    it('getApplicationDuplicates returns the open pairs of the applicant\'s auto-created profile, masked as /form-results masks them', async () => {
        const res = await getApplicationDuplicates('app-s-luna');
        expect(res).toMatchObject({
            ok: true, canLink: true, willMerge: true,
            applicant: { name: 'Ana Pérez', email: 'ana@example.com', phone: '11 5555-0109' },
        });
        const cards = (res as { cards: Array<{ match: Record<string, unknown>; profile: Record<string, unknown> }> }).cards;
        expect(cards.map(c => c.match.id)).toEqual(['carla', 'nadie']);
        expect(cards[0].match).toMatchObject({ name: 'Ana P.', matchTypes: ['phone'], candidateId: 'dc-1' });
        const carla = cards[0].profile;
        // Only what Ana typed is revealed on another team's protected profile.
        expect(carla.contactInfo).toContain(PHONE);
        expect(carla.contactInfo).not.toContain(PRIVATE_EMAIL);
        expect(carla.contactEntries).not.toContain(PRIVATE_EMAIL);
        // «Cargado por …»: the other profile's creator by name; null for an anonymous one.
        expect(carla.addedByName).toBe('Sofía Rescate');
        expect(cards[1].profile.addedByName).toBeNull();
        // Another rescuer's (or nobody's) profile is not «Tuyo».
        expect(carla.isMine).toBe(false);
        expect(cards[1].profile.isMine).toBe(false);
        // Masking inputs never leave the server.
        expect(carla).not.toHaveProperty('addedBy');
        expect(carla).not.toHaveProperty('isPublic');
    });

    it('the viewer\'s own other profile is «Tuyo» (isMine), still with their name for «Cargado por»', async () => {
        sqlite.prepare(`INSERT INTO user (id, name, email) VALUES ('u-owner', 'Olga Dueña', ?)`).run(OWNER.toUpperCase());
        adopter(sqlite, 'propia', 'Ana Propia', OWNER.toUpperCase());
        sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, match_values, score, confidence, status, detected_at)
            VALUES ('dc-3', 'ana', 'propia', '["phone","name_full"]', '{}', 90, 'high', 'pending', 1)`).run();
        const res = await getApplicationDuplicates('app-s-luna');
        const cards = (res as { cards: Array<{ match: { id: string }; profile: { isMine: boolean } }> }).cards;
        expect(cards.find(c => c.match.id === 'propia')!.profile.isMine).toBe(true);
        expect(cards.find(c => c.match.id === 'carla')!.profile.isMine).toBe(false);
    });

    it('a form linked to an existing profile lists THAT profile\'s open pairs (Q6 defers them), read-only — never a form re-link (final review M4)', async () => {
        adopter(sqlite, 'existente', 'Ana Pérez', OWNER);
        sqlite.prepare("UPDATE form_submissions SET linked_adopter_id = 'existente', auto_adopter_id = NULL WHERE id = 's-luna'").run();
        sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, match_values, score, confidence, status, detected_at)
            VALUES ('dc-4', 'existente', 'carla', '["phone"]', '{}', 80, 'high', 'pending', 1)`).run();
        const res = await getApplicationDuplicates('app-s-luna');
        expect(res).toMatchObject({ ok: true, canLink: false, willMerge: false });
        const cards = (res as { cards: Array<{ match: Record<string, unknown> }> }).cards;
        expect(cards.map(c => c.match.id)).toEqual(['carla']);
        expect(cards[0].match).toMatchObject({ candidateId: 'dc-4' });
    });

    it('a form with no profile has no cards', async () => {
        sqlite.prepare("UPDATE form_submissions SET linked_adopter_id = NULL, auto_adopter_id = NULL WHERE id = 's-luna'").run();
        expect(await getApplicationDuplicates('app-s-luna')).toMatchObject({ ok: true, cards: [], canLink: false });
    });
});
