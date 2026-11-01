/**
 * /my-adopters' housemate chips (Jon, 2026-11-01): getMyAdopters gives each
 * row only the two chip answers (housemateAlertsFor — the search card's own
 * per-card read), never names; null when nothing raises a chip. Real SQL
 * (every drizzle/*.sql replayed).
 * OWNER's rows: Lowe (lives with a 1★), Alma (lives with someone who has a
 * period alert), Gina (only GAVE an animal to a 1★: a gift home), Sola (no home).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { OWNER, STRANGER } = mocks;
const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));

vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/auth', () => ({ auth: vi.fn(async () => (mocks.session.user ? { user: { email: mocks.session.user } } : null)) }));
vi.mock('@/app/actions/organizations', () => ({ getOrgMemberEmails: vi.fn(async () => [mocks.session.user]) }));
vi.mock('@/config/admins', async (orig) => ({ ...(await orig()), isAdminAsync: mocks.isAdmin, isModeratorOrAdminAsync: mocks.isAdmin }));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOrgMate: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    getTeamEmails: async (e: string) => mocks.getOrgMemberEmailsFor(e),
    pickAttributionOrg: vi.fn(async () => null),
    isOwnerOrOrgMate: (v: string | null | undefined, o: string | null | undefined) => mocks.isOwnerOrOrgMate(v?.trim().toLowerCase(), o?.trim().toLowerCase()),
}));
vi.mock('@/config/features', async (orig) => ({
    ...(await orig()),
    getFeatureFlag: vi.fn(async (flag: string) => flag === 'ENABLE_HOUSEHOLD_MEMBERS'),
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
import { addMembership, createHousehold } from '@/lib/households';
import { getFeatureFlag } from '@/config/features';
import type { HousemateAlertSummary } from '@/domain/households';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };
const db = () => state.db as Parameters<typeof createHousehold>[0];
const DAY = 86_400, T0 = 1_780_000_000;

async function home(id: string, people: string[], gift?: { recipient: string; giver: string }) {
    await createHousehold(db(), OWNER, id);
    for (const p of people) await addMembership(db(), { householdId: id, adopterId: p, addedBy: OWNER });
    if (gift) await addMembership(db(), { householdId: id, adopterId: gift.recipient, giftRecipient: true, relativeToAdopterId: gift.giver, addedBy: OWNER });
}

beforeEach(async () => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    mocks.session.user = OWNER;
    const insert = sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES (?, ?, '5', ?, ?, 1000)`);
    // OWNER's four rows (newest first on the list), and the housemates — STRANGER's, so not on OWNER's list.
    [['lowe', 'Lowe Paez'], ['alma', 'Alma Ruiz'], ['gina', 'Gina Gift'], ['sola', 'Sola Diaz']].forEach(([id, name], i) => insert.run(id, name, OWNER, 2000 - i));
    for (const [id, name] of [['bad', 'Bruno Malo'], ['busy', 'Berta Mucho'], ['bad2', 'Beto Malo']]) insert.run(id, name, STRANGER, 1000);
    const animal = sqlite.prepare(`INSERT INTO animals (id, name, added_by) VALUES (?, 'X', ?)`);
    const record = sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, rating, started_at) VALUES (?, ?, ?, 'adoption', ?, ?)`);
    // Bruno and Beto are rated 1; Berta has two adoptions ten days apart («2 adopciones en 10 días» at threshold 2).
    sqlite.prepare(`INSERT OR REPLACE INTO app_config (key, value) VALUES ('too_many_adoptions_threshold', '2'), ('too_many_adoptions_period_days', '90')`).run();
    for (const [rid, who, rating, at] of [['r1', 'bad', 1, T0], ['r2', 'busy', null, T0], ['r3', 'busy', null, T0 + 10 * DAY], ['r4', 'bad2', 1, T0]] as const) {
        animal.run(`a-${rid}`, STRANGER);
        record.run(rid, `a-${rid}`, who, rating, at);
    }
    await home('hh-lowe', ['lowe', 'bad']);
    await home('hh-alma', ['alma', 'busy']);
    // Gina only gave Beto (1★) an animal: a gift household, not a home.
    await home('hh-gina', ['gina'], { recipient: 'bad2', giver: 'gina' });
});

type ListRow = { id: string; housemateAlert: HousemateAlertSummary | null };
const list = async () => (await getMyAdopters()) as unknown as ListRow[];
const byId = async () => new Map((await list()).map(r => [r.id, r]));

describe('getMyAdopters — each row\'s housemate chips', () => {
    it('a 1★ housemate → { lowRating: 1 }; a housemate with alerts → { hasAlerts }; gift-only and no home → null', async () => {
        const rows = await byId();
        expect(rows.get('lowe')!.housemateAlert).toEqual({ lowRating: 1, hasAlerts: false });
        expect(rows.get('alma')!.housemateAlert).toEqual({ lowRating: null, hasAlerts: true });
        expect(rows.get('gina')!.housemateAlert).toBeNull();
        expect(rows.get('sola')!.housemateAlert).toBeNull();
    });

    it('only the two answers reach the browser — never a housemate\'s name or id', async () => {
        const payload = JSON.stringify((await list()).map(r => r.housemateAlert));
        for (const leak of ['Bruno', 'Berta', 'Beto', 'bad', 'busy']) expect(payload).not.toContain(leak);
        for (const r of await list()) if (r.housemateAlert) expect(Object.keys(r.housemateAlert).sort()).toEqual(['hasAlerts', 'lowRating']);
    });

    it('households switched off → no row carries a chip', async () => {
        vi.mocked(getFeatureFlag).mockImplementation(async () => false);
        try {
            const rows = await list();
            expect(rows).toHaveLength(4);
            for (const r of rows) expect(r.housemateAlert).toBeNull();
        } finally {
            vi.mocked(getFeatureFlag).mockImplementation(async (flag: string) => flag === 'ENABLE_HOUSEHOLD_MEMBERS');
        }
    });
});
