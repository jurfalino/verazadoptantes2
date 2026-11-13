/**
 * saveAdoption edits are owner / teammate / admin only (adds stay open), and
 * getAdoptions needs a session. Real SQL on the real schema (animals,
 * placements, the adoptions view).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { session, getUser, isAdmin, isOrgMate, isOwnerOrOrgMate, OWNER, MATE, STRANGER, ADMIN } from '@/test-utils/actionMocks';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));
vi.mock('./_db', () => ({ getDb: async () => state.db, getUser }));
vi.mock('@/config/admins', () => ({ isAdminAsync: isAdmin, isModeratorOrAdminAsync: isAdmin }));
vi.mock('@/lib/orgMembership', () => ({ isOrgMate, isOwnerOrOrgMate, getOrgMemberEmailsFor: async (e: string) => [e], getTeamEmails: async (e: string) => [e] }));
// The owner-team notice (profile_content_added) writes through @/lib/db: keep it on the test database, never local.db.
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn(async () => undefined) }));
vi.mock('@/lib/pendingSearchLog', () => ({ closePendingSearchesForAdopter: vi.fn(async () => undefined) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
// P1: the profile's PII verdict, as getAdopter resolves it — OWNER's team and
// admins see contact data in full; everyone else is masked.
vi.mock('@/lib/piiAccessServer', async () => {
    const { NO_ACCESS_VISIBILITY } = await import('@/lib/piiAccess');
    const full = { ...NO_ACCESS_VISIBILITY, tier: 'full', privileged: true, nothingMasked: true };
    return {
        isPiiGatingEnabled: async () => true,
        resolveAdopterVisibility: async (viewer: string) => ([OWNER, MATE, ADMIN].includes(viewer) ? full : NO_ACCESS_VISIBILITY),
        buildMaskOptions: async () => ({ adopterIsPublic: false }),
    };
});

import { saveAdoption, getAdoptions } from './adoptions';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };

function seed() {
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('ad1', 'Carla', '5', ?, 1000, 1000)`).run(OWNER);
    sqlite.prepare(`INSERT INTO animals (id, name, species, added_by, created_at, updated_at) VALUES ('an1', 'Nina', 'cat', ?, 1000, 1000)`).run(OWNER);
    sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at, status, recorded_by, verified_address)
        VALUES ('an1-plc', 'an1', 'ad1', 'adoption', 1000, 'completed', ?, 'Calle Secreta 1234')`).run(OWNER);
}

describe('saveAdoption — edits are gated, adds are open', () => {
    beforeEach(() => {
        const m = migratedDb();
        state.db = m.db;
        sqlite = m.sqlite as unknown as typeof sqlite;
        seed();
        session.user = OWNER;
    });

    const name = () => sqlite.prepare("SELECT name FROM animals WHERE id = 'an1'").get()!.name;

    it('a stranger cannot edit someone else\'s record', async () => {
        session.user = STRANGER;
        await expect(saveAdoption({ id: 'an1', animalName: 'Robada' } as never)).rejects.toThrow(/Error ID/);
        expect(name()).toBe('Nina');
    });

    it('anonymous: refused', async () => {
        session.user = null;
        await expect(saveAdoption({ id: 'an1', animalName: 'Robada' } as never)).rejects.toThrow(/Error ID/);
        expect(name()).toBe('Nina');
    });

    it('the owner, a teammate and an admin can edit', async () => {
        await saveAdoption({ id: 'an1', animalName: 'Nina Dueña' } as never);
        expect(name()).toBe('Nina Dueña');
        session.user = MATE;
        await saveAdoption({ id: 'an1', animalName: 'Nina Equipo' } as never);
        expect(name()).toBe('Nina Equipo');
        session.user = ADMIN;
        await saveAdoption({ id: 'an1', animalName: 'Nina Admin' } as never);
        expect(name()).toBe('Nina Admin');
    });

    it('any signed-in rescuer can ADD a record about an adopter (collaborative adds)', async () => {
        session.user = STRANGER;
        const res = await saveAdoption({ adopterId: 'ad1', recordType: 'observation', details: 'La vi en la plaza' } as never);
        expect(res.success).toBe(true);
    });

    it('nobody creates a record under a «No avanzar» id from the browser — only the decline itself writes those (review S2)', async () => {
        session.user = STRANGER;
        await expect(saveAdoption({ id: 'decline-app-s1', adopterId: 'ad1', recordType: 'observation', rating: 5, details: 'todo bien' } as never)).rejects.toThrow();
        expect(sqlite.prepare("SELECT COUNT(*) AS n FROM adopter_events WHERE id LIKE 'decline-%'").get()!.n).toBe(0);
    });

    it('an existing «No avanzar» observation can still be edited by its author from the profile', async () => {
        sqlite.prepare(`INSERT INTO adopter_events (id, adopter_id, event_type, rating, details, recorded_by, created_at)
            VALUES ('decline-app-s1', 'ad1', 'observation', 2, 'texto', ?, 1000)`).run(OWNER);
        const res = await saveAdoption({ id: 'decline-app-s1', adopterId: 'ad1', recordType: 'observation', rating: 3, details: 'texto corregido' } as never);
        expect(res.success).toBe(true);
    });
});

describe('getAdoptions — signed-in only', () => {
    beforeEach(() => {
        const m = migratedDb();
        state.db = m.db;
        sqlite = m.sqlite as unknown as typeof sqlite;
        seed();
    });

    it('anonymous: nothing (no verified address, notes or rescuer emails)', async () => {
        session.user = null;
        expect(await getAdoptions('ad1')).toEqual([]);
    });

    it('signed-in rescuer: the history, as the profile shows it', async () => {
        session.user = STRANGER;
        const rows = await getAdoptions('ad1') as Array<Record<string, unknown>>;
        expect(rows.map(r => r.animalName)).toEqual(['Nina']);
    });
});

describe('getAdoptions — the pencil shows exactly where the save works (T4)', () => {
    beforeEach(() => {
        const m = migratedDb();
        state.db = m.db;
        sqlite = m.sqlite as unknown as typeof sqlite;
        seed();
        // A record an outside rescuer wrote on OWNER's profile.
        sqlite.prepare(`INSERT INTO adopter_events (id, adopter_id, event_type, date, recorded_by) VALUES ('ev-out', 'ad1', 'follow_up', 2000, ?)`).run(STRANGER);
    });

    const canEdit = async () => Object.fromEntries((await getAdoptions('ad1') as Array<Record<string, unknown>>).map(r => [r.id, r.canEdit]));

    it('a teammate of the profile owner: the team\'s record yes, the outside rescue\'s record no', async () => {
        session.user = MATE;
        expect(await canEdit()).toEqual({ 'an1': true, 'ev-out': false });
    });

    it('the outside rescuer: their own record on a stranger\'s profile yes, the owner\'s no', async () => {
        session.user = STRANGER;
        expect(await canEdit()).toEqual({ 'an1': false, 'ev-out': true });
    });

    it('an admin: every record', async () => {
        session.user = ADMIN;
        expect(await canEdit()).toEqual({ 'an1': true, 'ev-out': true });
    });

    it('agrees with saveAdoption: where canEdit is false the save is refused, where true it lands', async () => {
        session.user = MATE;
        await expect(saveAdoption({ id: 'ev-out', details: 'x' } as never)).rejects.toThrow(/Error ID/);
        session.user = STRANGER;
        await saveAdoption({ id: 'ev-out', details: 'Sigue bien' } as never);
        expect(sqlite.prepare("SELECT details FROM adopter_events WHERE id = 'ev-out'").get()!.details).toBe('Sigue bien');
    });
});

describe('getAdoptions — the delivery address is contact data (P1)', () => {
    beforeEach(() => {
        const m = migratedDb();
        state.db = m.db;
        sqlite = m.sqlite as unknown as typeof sqlite;
        seed();
        sqlite.prepare("UPDATE placements SET verified_address = 'Av. Siempre Viva 742, Lanús' WHERE id = 'an1-plc'").run();
        // An outside rescuer's own adoption on OWNER's profile, with the address she verified.
        sqlite.prepare(`INSERT INTO animals (id, name, species, added_by, created_at, updated_at) VALUES ('an2', 'Tom', 'cat', ?, 1000, 1000)`).run(STRANGER);
        sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at, status, recorded_by, verified_address)
            VALUES ('an2-plc', 'an2', 'ad1', 'adoption', 1500, 'completed', ?, 'Otra Calle 55, Quilmes')`).run(STRANGER);
    });

    const addresses = async () => Object.fromEntries((await getAdoptions('ad1') as Array<Record<string, unknown>>).map(r => [r.id, r.verifiedAddress]));

    it('outside the team: masked like the profile\'s contacts — except the record she wrote herself', async () => {
        session.user = STRANGER;
        expect(await addresses()).toEqual({ an1: '•••••, Lanús', an2: 'Otra Calle 55, Quilmes' });
    });

    it('the team and admins: in full', async () => {
        for (const who of [OWNER, MATE, ADMIN]) {
            session.user = who;
            expect(await addresses()).toEqual({ an1: 'Av. Siempre Viva 742, Lanús', an2: 'Otra Calle 55, Quilmes' });
        }
    });
});
