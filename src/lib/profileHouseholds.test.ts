/**
 * The profile page's household read (src/lib/profileHouseholds.ts) — review
 * fix 1 (2026-11-01): the header's housemate alerts come from the households
 * the section shows, read AFTER their conversion, and each member carries their
 * own period alerts (fix 4). Real SQL (every drizzle/*.sql replayed).
 * OWNER owns Pedro, Marta, Lucas, Rosa and Bad.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { OWNER, MATE } = mocks;
const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));

vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/auth', () => ({ auth: vi.fn(async () => (mocks.session.user ? { user: { email: mocks.session.user } } : null)) }));
vi.mock('@/config/admins', async (orig) => ({ ...(await orig()), isAdminAsync: mocks.isAdmin, isModeratorOrAdminAsync: mocks.isAdmin }));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOrgMate: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    getTeamEmails: async (e: string) => mocks.getOrgMemberEmailsFor(e),
    isOwnerOrOrgMate: (v: string | null | undefined, o: string | null | undefined) => mocks.isOwnerOrOrgMate(v?.trim().toLowerCase(), o?.trim().toLowerCase()),
}));
vi.mock('@/config/features', async (orig) => ({
    ...(await orig()),
    getFeatureFlag: vi.fn(async (flag: string) => flag === 'ENABLE_PII_ACCESS_GATING' || flag === 'ENABLE_HOUSEHOLD_MEMBERS'),
}));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async (_n: string, task: () => Promise<unknown>) => { await task(); }) }));
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

import { readProfileHouseholds } from './profileHouseholds';
import { addMembership, createHousehold, ensureHousehold } from './households';
import { logger } from './logger';
import { NO_HOUSEMATE_ALERT } from '@/domain/profileHouseholds';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] }; exec: (s: string) => void };
const db = () => state.db as Parameters<typeof ensureHousehold>[0];
const read = (viewer: string, id: string) => readProfileHouseholds(viewer, id, Promise.resolve({ addedBy: OWNER }));

const DAY = 86_400, T0 = 1_780_000_000;
/** Marta has two adoptions ten days apart: with the threshold at 2, «2 adopciones en 10 días». */
function martaHasAlerts() {
    sqlite.exec(`INSERT OR REPLACE INTO app_config (key, value) VALUES ('too_many_adoptions_threshold', '2'), ('too_many_adoptions_period_days', '90')`);
    sqlite.prepare(`INSERT INTO animals (id, name, added_by) VALUES ('an2', 'Mora', ?), ('an3', 'Tom', ?)`).run(OWNER, OWNER);
    sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at) VALUES ('p2', 'an2', 'marta', 'adoption', ?), ('p3', 'an3', 'marta', 'adoption', ?)`).run(T0, T0 + 10 * DAY);
}

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    vi.mocked(logger.warn).mockClear();
    const insert = sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES (?, ?, '5', ?, 1000, 1000)`);
    for (const [id, name] of [['pedro', 'Pedro Paez'], ['marta', 'Marta Paez'], ['lucas', 'Lucas Paez'], ['rosa', 'Rosa Diaz'], ['bad', 'Bruno Malo']]) insert.run(id, name, OWNER);
    // Bruno is rated 1.
    sqlite.prepare(`INSERT INTO animals (id, name, added_by) VALUES ('an1', 'Luna', ?)`).run(OWNER);
    sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, rating) VALUES ('p1', 'an1', 'bad', 'adoption', 1)`).run();
});

async function pedrosHome(...members: string[]): Promise<string> {
    const hh = await ensureHousehold(db(), 'pedro', OWNER);
    for (const id of members) await addMembership(db(), { householdId: hh, adopterId: id, addedBy: OWNER });
    return hh;
}

describe('readProfileHouseholds().housemateAlert — the header chips, from the households the section shows', () => {
    it('a 1★ housemate → «Conviviente con calificación 1.0»', async () => {
        await pedrosHome('marta', 'bad');
        const r = await read(MATE, 'pedro');
        expect(r.housemateAlert).toEqual({ lowRating: 1, hasAlerts: false });
        expect(r.views[0].members.map(m => m.profileId).sort()).toEqual(['bad', 'marta']);
    });

    it('a housemate with their own period alert → «Conviviente con alertas», and the section member carries the alert (fix 4)', async () => {
        await pedrosHome('marta');
        martaHasAlerts();
        const r = await read(MATE, 'pedro');
        expect(r.housemateAlert).toEqual({ lowRating: null, hasAlerts: true });
        const marta = r.views[0].members.find(m => m.profileId === 'marta')!;
        expect(marta.alerts?.tooManyAdoptions).toMatchObject({ count: 2, threshold: 2 });
        expect(marta.alerts?.tooManyRequests).toBeNull();
    });

    it('a member with too few records to have an alert is never read for one', async () => {
        await pedrosHome('lucas');
        const handle = state.db as { select: (cols?: Record<string, unknown>) => unknown };
        const spy = vi.spyOn(handle, 'select');
        try {
            const r = await read(MATE, 'pedro');
            expect(r.housemateAlert).toEqual(NO_HOUSEMATE_ALERT);
            const alertReads = spy.mock.calls.filter(([cols]) => !!cols && 'recordType' in (cols as object) && 'addedBy' in (cols as object) && Object.keys(cols as object).length === 3);
            expect(alertReads).toHaveLength(0);
        } finally {
            spy.mockRestore();
        }
    });

    it('a gift-only housemate raises nothing (a gift recipient does not live there)', async () => {
        await createHousehold(db(), OWNER, 'gift1');
        await addMembership(db(), { householdId: 'gift1', adopterId: 'pedro', addedBy: OWNER });
        await addMembership(db(), { householdId: 'gift1', adopterId: 'bad', giftRecipient: true, relativeToAdopterId: 'pedro', addedBy: OWNER });
        const r = await read(MATE, 'pedro');
        expect(r.views.some(v => v.isGift)).toBe(true);
        expect(r.housemateAlert).toEqual(NO_HOUSEMATE_ALERT);
    });

    it('signed out → no chips and no member alerts read (the list they lead to names people)', async () => {
        await pedrosHome('bad', 'marta');
        martaHasAlerts();
        const r = await read('', 'pedro');
        expect(r.housemateAlert).toEqual(NO_HOUSEMATE_ALERT);
        expect(r.views.flatMap(v => v.members).every(m => m.alerts === undefined)).toBe(true);
    });

    it('the first view of an OLD-format profile (inline household JSON) already raises the chip: read after the conversion', async () => {
        // No membership rows yet: Pedro's household lives only in his old inline JSON, linking Bruno (1★).
        sqlite.prepare('UPDATE adopters SET household_members = ? WHERE id = ?')
            .run(JSON.stringify([{ id: 'pm1', name: 'Bruno Malo', relationship: 'unknown', profileId: 'bad', contactEntries: [] }]), 'pedro');
        expect(sqlite.prepare('SELECT COUNT(*) AS n FROM household_memberships').get()!.n).toBe(0);
        const r = await read(MATE, 'pedro');
        expect(r.views[0]?.members.map(m => m.profileId)).toEqual(['bad']);
        expect(r.housemateAlert).toEqual({ lowRating: 1, hasAlerts: false });
    });

    it('a failed alerts read costs only the alerts: the households and the rating chip stay, logged with the page\'s context', async () => {
        await pedrosHome('bad', 'marta');
        martaHasAlerts();
        const handle = state.db as { select: (cols?: Record<string, unknown>) => unknown };
        const real = handle.select.bind(handle);
        const spy = vi.spyOn(handle, 'select').mockImplementation(((cols?: Record<string, unknown>) => {
            if (cols && 'recordType' in cols && 'addedBy' in cols && Object.keys(cols).length === 3) throw new Error('D1 down');
            return real(cols as never);
        }) as never);
        try {
            const r = await read(MATE, 'pedro');
            expect(r.views[0].members.map(m => m.profileId).sort()).toEqual(['bad', 'marta']);
            expect(r.housemateAlert).toEqual({ lowRating: 1, hasAlerts: false });
            expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('alerts read failed'), expect.objectContaining({ adopterId: 'pedro', viewer: MATE, profileId: 'marta' }));
        } finally {
            spy.mockRestore();
        }
    });
});
