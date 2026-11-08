/**
 * T2: on /my-adopters the «Formulario para…» line is a link exactly when
 * /form-results would open it — a teammate's form included (the team acts as
 * one), an outsider's form linked to a team profile never. Real SQL.
 * Team: OWNER + MATE. STRANGER is in no group.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { OWNER, MATE, STRANGER } = mocks;
const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));

vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/auth', () => ({ auth: vi.fn(async () => (mocks.session.user ? { user: { email: mocks.session.user } } : null)) }));
vi.mock('@/app/actions/organizations', () => ({ getOrgMemberEmails: vi.fn(async () => mocks.getOrgMemberEmailsFor(mocks.session.user!)) }));
vi.mock('@/config/admins', async (orig) => ({ ...(await orig()), isAdminAsync: mocks.isAdmin, isAdminAsyncStrict: mocks.isAdmin, isModeratorOrAdminAsync: mocks.isAdmin }));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOrgMate: mocks.isOrgMate, isOrgMateStrict: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    getTeamEmails: async (e: string) => mocks.getOrgMemberEmailsFor(e),
    getOrgsForEmail: vi.fn(async () => []),
    pickAttributionOrg: vi.fn(async () => null),
    isOwnerOrOrgMate: mocks.isOwnerOrOrgMate,
}));
vi.mock('@/app/actions/notifications', () => ({
    createNotification: vi.fn(async () => 'n'),
    notifyAdmins: vi.fn(async () => undefined),
    notifyOrgMembers: vi.fn(async () => undefined),
    resolveDisplayName: vi.fn(async (email: string) => email.split('@')[0]),
    resolveDisplayNames: vi.fn(async (emails: string[]) => Object.fromEntries(emails.map(e => [e, e.split('@')[0]]))),
}));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: (_op: string, fn: () => unknown) => fn(),
}));

import { getMyAdopters } from './dashboard';

let sqlite: { prepare: (s: string) => { run: (...a: unknown[]) => unknown } };
type ListRow = { id: string; latestForm?: { submissionId: string; canOpen: boolean } | null };
const formLine = async (adopterId: string) =>
    ((await getMyAdopters()) as unknown as ListRow[]).find(r => r.id === adopterId)?.latestForm ?? null;

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    const adopter = sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES (?, ?, '5', ?, 1000, 1000)`);
    adopter.run('carla', 'Carla Gómez', OWNER);
    adopter.run('dora', 'Dora Paz', OWNER);
    adopter.run('ema', 'Ema Ruiz', STRANGER);
    const form = sqlite.prepare(`INSERT INTO form_submissions (id, user_id, name, status, linked_adopter_id, auto_adopter_id, created_at) VALUES (?, ?, ?, 'pending', ?, ?, 1)`);
    // Carla applied through MATE's link; Dora through an outsider's link, later linked to OWNER's profile.
    form.run('f-mate', MATE, 'Carla Gómez', 'carla', 'carla');
    form.run('f-outsider', STRANGER, 'Dora Paz', 'dora', null);
    form.run('f-ema', STRANGER, 'Ema Ruiz', 'ema', 'ema');
});

describe('/my-adopters «Formulario para…» line', () => {
    it('the recipient\'s teammate: a teammate\'s form is a link', async () => {
        mocks.session.user = OWNER;
        expect(await formLine('carla')).toMatchObject({ submissionId: 'f-mate', canOpen: true });
    });

    it('whoever shared the form: still a link', async () => {
        mocks.session.user = MATE;
        expect(await formLine('carla')).toMatchObject({ submissionId: 'f-mate', canOpen: true });
    });

    it('an outsider\'s form linked to a team profile: plain text (form-results would refuse it)', async () => {
        mocks.session.user = OWNER;
        expect(await formLine('dora')).toMatchObject({ submissionId: 'f-outsider', canOpen: false });
    });

    it('someone in no group sees only their own list — their own form is a link, the team\'s rows never reach them', async () => {
        mocks.session.user = STRANGER;
        expect(await formLine('ema')).toMatchObject({ submissionId: 'f-ema', canOpen: true });
        expect(await formLine('carla')).toBeNull();
    });
});
