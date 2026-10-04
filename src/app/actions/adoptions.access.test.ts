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
vi.mock('@/lib/orgMembership', () => ({ isOrgMate, isOwnerOrOrgMate }));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn(async () => undefined) }));
vi.mock('@/lib/pendingSearchLog', () => ({ closePendingSearchesForAdopter: vi.fn(async () => undefined) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

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
