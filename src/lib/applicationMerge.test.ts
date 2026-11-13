/**
 * After «Sí, es la misma persona»: one application per person per animal.
 * Real SQL (migratedDb), the real mergeAdopters / unmergeAdopters.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { OWNER, MATE, STRANGER, ADMIN } = mocks;
const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));

vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/config/admins', async (orig) => ({
    ...(await orig()), isAdminAsync: mocks.isAdmin, isModeratorOrAdminAsync: mocks.isAdmin, isAdmin: (e: string | null | undefined) => e === ADMIN,
}));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOrgMate: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    getTeamEmails: async (e: string) => mocks.getOrgMemberEmailsFor(e),
    isOwnerOrOrgMate: mocks.isOwnerOrOrgMate,
}));
vi.mock('@/config/features', async (orig) => ({ ...(await orig()), getFeatureFlag: vi.fn(async () => false) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async (_n: string, task: () => Promise<unknown>) => { await task(); }) }));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn(async () => undefined) }));
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

import { mergeAdopters, unmergeAdopters } from './adopterMerge';
import { APPLICATION_AUTO_ACTOR } from '@/domain/constants';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };

const app = (id: string) => sqlite.prepare('SELECT * FROM applications WHERE id = ?').get(id)!;

function profile(id: string) {
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES (?, ?, '5', ?, 1000, 1000)`).run(id, id, OWNER);
}
/** A form (via `owner`'s link) from `adopterId`, with its application. */
function application(id: string, adopterId: string, owner: string, animalId: string | null, createdAt: number) {
    sqlite.prepare('INSERT INTO form_submissions (id, user_id, name, linked_adopter_id, selected_animal_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, owner, id, adopterId, animalId, createdAt);
    sqlite.prepare("INSERT INTO applications (id, submission_id, animal_id, origin, state, created_at) VALUES (?, ?, ?, 'form', 'open', ?)")
        .run(`app-${id}`, id, animalId, createdAt);
}

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    mocks.session.user = ADMIN;
    profile('ad1');
    profile('ad2');
    sqlite.prepare(`INSERT INTO animals (id, name, species, sex, added_by, created_at, updated_at) VALUES ('luna', 'Luna', 'dog', 'hembra', ?, 1000, 1000)`).run(OWNER);
});

async function merge() {
    const res = await mergeAdopters('ad1', 'ad2', ADMIN);
    expect(res.success, res.error).toBe(true);
    return res.auditId!;
}

describe('one application per person per animal after a merge', () => {
    it('after «Sí, es la misma persona» the newer form for Luna stays, the older reads replaced', async () => {
        application('fa', 'ad1', OWNER, 'luna', 1000);
        application('fb', 'ad2', MATE, 'luna', 2000);
        await merge();
        expect(app('app-fa')).toMatchObject({ state: 'replaced', replaced_by_application_id: 'app-fb', closed_by: APPLICATION_AUTO_ACTOR });
        expect(app('app-fa').closed_at).toEqual(expect.any(Number));
        expect(app('app-fb')).toMatchObject({ state: 'open', replaced_by_application_id: null });
    });

    it('a general application of the survivor ends as also_applied when the same team has their open Luna application', async () => {
        application('fg', 'ad1', OWNER, null, 1000);
        application('fb', 'ad2', MATE, 'luna', 2000);
        await merge();
        expect(app('app-fg')).toMatchObject({ state: 'also_applied', replaced_by_application_id: 'app-fb' });
        expect(app('app-fb').state).toBe('open');
    });

    it("another team's general application is left open", async () => {
        application('fg', 'ad1', STRANGER, null, 1000);
        application('fb', 'ad2', OWNER, 'luna', 2000);
        await merge();
        expect(app('app-fg')).toMatchObject({ state: 'open', replaced_by_application_id: null, closed_by: null });
        expect(app('app-fb').state).toBe('open');
    });

    it('unmergeAdopters restores the application states the merge changed', async () => {
        application('fa', 'ad1', OWNER, 'luna', 1000);
        application('fb', 'ad2', MATE, 'luna', 2000);
        application('fg', 'ad1', OWNER, null, 1500);
        const auditId = await merge();
        expect(app('app-fa').state).toBe('replaced');
        expect(app('app-fg').state).toBe('also_applied');
        const res = await unmergeAdopters(auditId, ADMIN);
        expect(res.success, res.error).toBe(true);
        for (const id of ['app-fa', 'app-fb', 'app-fg']) {
            expect(app(id)).toMatchObject({ state: 'open', replaced_by_application_id: null, closed_at: null, closed_by: null });
        }
    });
});
