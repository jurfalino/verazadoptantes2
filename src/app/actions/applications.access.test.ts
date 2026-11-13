/**
 * The evaluation actions are browser-callable: a rescuer outside the animal
 * owner's team (or the form link's team, for a general application) gets
 * `not_found` — never a hint the application exists — and nothing is written.
 * Real SQL on the real schema; the session is the only source of the actor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';
import { asyncDb, seedEvaluation, snapshot, application, form, adopter, animal, placement, type Sqlite } from '@/test-utils/applicationFixtures';

const { session, OWNER, MATE, STRANGER, ADMIN } = mocks;

const { state, createNotification } = vi.hoisted(() => ({ state: { db: null as unknown }, createNotification: vi.fn(async () => 'n') }));

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
    createNotification,
    notifyAdmins: vi.fn(async () => undefined),
    resolveDisplayName: vi.fn(async (email: string) => email.split('@')[0]),
    resolveDisplayNames: vi.fn(async (emails: string[]) => new Map(emails.map(e => [e.toLowerCase(), e.split('@')[0]]))),
}));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
}));

import {
    getGeneralApplications, getApplicationDuplicates, declineApplication, getProposalAnimals, proposeAnimal, getAdoptionOffer, markOfferDone,
    getShareFormAnimals,
} from './applications';

let sqlite: Sqlite;

beforeEach(() => {
    const m = migratedDb();
    state.db = asyncDb(m.db);
    sqlite = m.sqlite as unknown as Sqlite;
    session.user = OWNER;
    createNotification.mockClear();
    seedEvaluation(sqlite);
    // A closed candidate of Luna waiting for the offer.
    adopter(sqlite, 'cami', 'Cami Ruiz', OWNER);
    form(sqlite, 's-cami', { name: 'Cami Ruiz', adopter: 'cami', animal: 'luna', phone: '11 5555-0303' });
    application(sqlite, 'app-s-cami', 's-cami', 'luna', { state: 'closed', closeReason: 'adopted_other' });
});

const DECLINE = { text: 'No avanzamos con su solicitud para Luna.', reason: 'No tiene patio', rating: 3 };

describe('evaluation actions — access', () => {
    const calls: Record<string, () => Promise<unknown>> = {
        getApplicationDuplicates: () => getApplicationDuplicates('app-s-luna'),
        declineApplication: () => declineApplication('app-s-luna', DECLINE),
        getProposalAnimals: () => getProposalAnimals('app-s-gen'),
        proposeAnimal: () => proposeAnimal('app-s-gen', 'luna'),
    };

    it.each(Object.keys(calls))('%s: a rescuer outside the owner\'s team gets not_found and nothing is written', async (name) => {
        session.user = STRANGER;
        const before = snapshot(sqlite);
        expect(await calls[name]()).toEqual({ ok: false, error: 'not_found' });
        expect(snapshot(sqlite)).toEqual(before);
        expect(createNotification).not.toHaveBeenCalled();
    });

    it('declineApplication on a general application: outsider → not_found, nothing written', async () => {
        session.user = STRANGER;
        const before = snapshot(sqlite);
        expect(await declineApplication('app-s-gen', DECLINE)).toEqual({ ok: false, error: 'not_found' });
        expect(snapshot(sqlite)).toEqual(before);
    });

    it('an unknown or «replaced» application is not_found too (never says it exists)', async () => {
        form(sqlite, 's-old', { adopter: 'ana', animal: 'luna' });
        application(sqlite, 'app-old', 's-old', 'luna', { state: 'replaced' });
        expect(await declineApplication('app-old', DECLINE)).toEqual({ ok: false, error: 'not_found' });
        expect(await getApplicationDuplicates('app-nope')).toEqual({ ok: false, error: 'not_found' });
    });

    it('a forged form (an outsider\'s link naming Luna) is not_found even for Luna\'s owner', async () => {
        adopter(sqlite, 'forged', 'Forged', STRANGER);
        form(sqlite, 's-forged', { owner: STRANGER, adopter: 'forged', animal: 'luna' });
        application(sqlite, 'app-s-forged', 's-forged', 'luna');
        const before = snapshot(sqlite);
        expect(await declineApplication('app-s-forged', DECLINE)).toEqual({ ok: false, error: 'not_found' });
        expect(snapshot(sqlite)).toEqual(before);
    });

    it('getAdoptionOffer / markOfferDone: outsider → not_found; org-mate and admin → ok', async () => {
        session.user = STRANGER;
        const before = snapshot(sqlite);
        expect(await getAdoptionOffer('luna')).toEqual({ ok: false, error: 'not_found' });
        expect(await markOfferDone('luna')).toEqual({ ok: false, error: 'not_found' });
        expect(snapshot(sqlite)).toEqual(before);

        session.user = MATE;
        expect(await getAdoptionOffer('luna')).toMatchObject({ ok: true, candidates: [{ applicationId: 'app-s-cami' }] });
        session.user = ADMIN;
        expect(await getAdoptionOffer('luna')).toMatchObject({ ok: true, candidates: [{ applicationId: 'app-s-cami' }] });
        expect(await markOfferDone('luna')).toEqual({ ok: true, count: 1 });
    });

    it('proposeAnimal refuses an animal of a team the form link owner is not in (not_allowed)', async () => {
        // An admin may see both, but OWNER's form link is not in Sol's owner's team.
        session.user = ADMIN;
        const before = snapshot(sqlite);
        expect(await proposeAnimal('app-s-gen', 'sol')).toEqual({ ok: false, error: 'not_allowed' });
        expect(snapshot(sqlite)).toEqual(before);
    });

    it('proposeAnimal to an animal the viewer may not see → not_found, nothing written', async () => {
        const before = snapshot(sqlite);
        expect(await proposeAnimal('app-s-gen', 'sol')).toEqual({ ok: false, error: 'not_found' });
        expect(await proposeAnimal('app-s-gen', 'no-such-animal')).toEqual({ ok: false, error: 'not_found' });
        expect(snapshot(sqlite)).toEqual(before);
    });

    it('getProposalAnimals never lists another team\'s animals', async () => {
        const res = await getProposalAnimals('app-s-gen');
        expect(res).toMatchObject({ ok: true });
        expect((res as { animals: Array<{ id: string }> }).animals.map(a => a.id)).toEqual(['luna']);
    });

    it('getShareFormAnimals («¿Para qué animal?») lists only the viewer\'s team\'s animals that take applications', async () => {
        const res = await getShareFormAnimals();
        expect(res).toMatchObject({ ok: true, animals: [{ id: 'luna', name: 'Luna', species: 'cat', candidates: 1 }] });
        session.user = MATE;
        expect((await getShareFormAnimals() as { animals: Array<{ id: string }> }).animals.map(a => a.id)).toEqual(['luna']);
        session.user = STRANGER;
        expect((await getShareFormAnimals() as { animals: Array<{ id: string }> }).animals.map(a => a.id)).toEqual(['sol']);
    });

    it('getShareFormAnimals leaves out an adopted animal, keeps a fostered one, and needs a session', async () => {
        adopter(sqlite, 'casa', 'Casa', OWNER);
        animal(sqlite, 'nube', 'Nube', OWNER, { species: 'dog' });
        placement(sqlite, 'pl-nube', 'nube', 'casa', 'adoption');
        animal(sqlite, 'tito', 'Tito', OWNER, { species: 'dog' });
        placement(sqlite, 'pl-tito', 'tito', 'casa', 'foster');
        const ids = (await getShareFormAnimals() as { animals: Array<{ id: string }> }).animals.map(a => a.id).sort();
        expect(ids).toEqual(['luna', 'tito']);
        session.user = null;
        expect(await getShareFormAnimals()).toEqual({ ok: false, error: 'unauthorized' });
    });

    it('getGeneralApplications lists only the viewer\'s team\'s general applications', async () => {
        const res = await getGeneralApplications();
        expect(res.ok && res.applicants.map(a => a.applicationId)).toEqual(['app-s-gen']);
        session.user = STRANGER;
        expect(await getGeneralApplications()).toEqual({ ok: true, applicants: [] });
    });

    it('signed out → unauthorized for every action, [] for the list, nothing written', async () => {
        session.user = null;
        const before = snapshot(sqlite);
        for (const call of [...Object.values(calls), () => getAdoptionOffer('luna'), () => markOfferDone('luna')]) {
            expect(await call()).toEqual({ ok: false, error: 'unauthorized' });
        }
        expect(await getGeneralApplications()).toEqual({ ok: true, applicants: [] });
        expect(snapshot(sqlite)).toEqual(before);
    });

    it('arguments a stranger chooses: non-string ids and malformed input are invalid, nothing written', async () => {
        const before = snapshot(sqlite);
        const bad = (v: unknown) => v as string;
        expect(await declineApplication(bad(42), DECLINE)).toEqual({ ok: false, error: 'invalid' });
        expect(await declineApplication('x'.repeat(65), DECLINE)).toEqual({ ok: false, error: 'invalid' });
        expect(await declineApplication('app-s-luna', bad(null) as never)).toEqual({ ok: false, error: 'invalid' });
        expect(await proposeAnimal('app-s-gen', bad({}))).toEqual({ ok: false, error: 'invalid' });
        expect(await getAdoptionOffer(bad(undefined))).toEqual({ ok: false, error: 'invalid' });
        expect(await markOfferDone(bad(['luna']))).toEqual({ ok: false, error: 'invalid' });
        expect(snapshot(sqlite)).toEqual(before);
    });
});
