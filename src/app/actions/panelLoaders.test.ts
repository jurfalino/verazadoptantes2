/**
 * Final review M7 — the applicant panel's two loaders: a refusal (signed out, not the team's) is an empty
 * list, but a FAILURE is a typed failure carrying the errorId it was logged under — never `[]`, which the
 * panel read as «everything decided» and closed silently. Real SQL (migratedDb).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';
import { asyncDb, seedEvaluation, type Sqlite } from '@/test-utils/applicationFixtures';

const { session, OWNER, STRANGER } = mocks;
const { state, logger } = vi.hoisted(() => ({
    state: { db: null as unknown },
    logger: { warn: () => undefined, info: () => undefined, debug: () => undefined, error: (() => 'abcd1234') as (...a: unknown[]) => string },
}));

vi.mock('./_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/auth', () => ({ auth: async () => (session.user ? { user: { email: session.user } } : null) }));
vi.mock('@/config/admins', () => ({ isAdminAsync: mocks.isAdmin, isAdminAsyncStrict: mocks.isAdmin, isModeratorOrAdminAsync: mocks.isAdmin, isAdmin: (e: string) => e === mocks.ADMIN }));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOrgMate: mocks.isOrgMate, isOrgMateStrict: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    isOwnerOrOrgMate: mocks.isOwnerOrOrgMate,
    getTeamEmails: async (email: string) => mocks.getOrgMemberEmailsFor((email ?? '').trim().toLowerCase()),
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/logger', () => ({ logger, generateErrorId: () => 'gen12345' }));

import { getApplicantsForAnimal } from './applicants';
import { getGeneralApplications } from './applications';
import { candidatesLostOnDelete } from '@/domain/applications';

let sqlite: Sqlite;
let errorSpy: ReturnType<typeof vi.spyOn>;
/** A D1 that answers the gate's reads and then fails (an outage mid-load). */
function failingAfter(db: object, okSelects: number) {
    let n = 0;
    return new Proxy(db, {
        get(t, p, r) {
            const v = Reflect.get(t, p, r);
            if (p === 'select') return (...a: unknown[]) => { if (++n > okSelects) throw new Error('D1_ERROR: network lost'); return (v as (...x: unknown[]) => unknown).apply(t, a); };
            return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(t) : v;
        },
    });
}

beforeEach(() => {
    const m = migratedDb();
    state.db = asyncDb(m.db);
    sqlite = m.sqlite as unknown as Sqlite;
    session.user = OWNER;
    seedEvaluation(sqlite);
    errorSpy = vi.spyOn(logger, 'error');
    errorSpy.mockClear();
});

describe('getApplicantsForAnimal / getGeneralApplications — a failure is not an empty list', () => {
    it('ok: the list, wrapped', async () => {
        expect(await getApplicantsForAnimal('luna')).toMatchObject({ ok: true, applicants: [{ applicationId: 'app-s-luna' }] });
        expect(await getGeneralApplications()).toMatchObject({ ok: true, applicants: [{ applicationId: 'app-s-gen' }] });
    });

    it('a refusal is an empty list, not an error (signed out; another team\'s animal)', async () => {
        session.user = STRANGER;
        expect(await getApplicantsForAnimal('luna')).toEqual({ ok: true, applicants: [] });
        session.user = null;
        expect(await getApplicantsForAnimal('luna')).toEqual({ ok: true, applicants: [] });
        expect(await getGeneralApplications()).toEqual({ ok: true, applicants: [] });
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('a D1 failure → { ok: false, errorId } logged with logger.error (and its context)', async () => {
        state.db = failingAfter(state.db as object, 1); // the animal read answers; the list read fails
        expect(await getApplicantsForAnimal('luna')).toEqual({ ok: false, errorId: 'abcd1234' });
        expect(errorSpy).toHaveBeenCalledWith('getApplicantsForAnimal failed', expect.any(Error), expect.objectContaining({ animalId: 'luna', userEmail: OWNER }));
        state.db = failingAfter(state.db as object, 0);
        expect(await getGeneralApplications()).toEqual({ ok: false, errorId: 'abcd1234' });
        expect(errorSpy).toHaveBeenCalledWith('getGeneralApplications failed', expect.any(Error), expect.objectContaining({ viewer: OWNER }));
    });
});

describe('the edit-page delete warning reads getApplicantsForAnimal — an outsider gets no count', () => {
    it('the team sees its open candidates; a stranger gets an empty list (never a hint)', async () => {
        const mine = await getApplicantsForAnimal('luna');
        expect(mine.ok && candidatesLostOnDelete(mine.applicants)).toBe(1);
        session.user = STRANGER;
        const theirs = await getApplicantsForAnimal('luna');
        expect(theirs).toEqual({ ok: true, applicants: [] });
        expect(theirs.ok && candidatesLostOnDelete(theirs.applicants)).toBe(0);
    });
});
