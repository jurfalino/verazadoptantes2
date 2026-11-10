/**
 * F4 — a record «Entregado en casa del adoptante» copies its address into the
 * profile's contacts on EVERY save that lands it (create and edit), on the
 * server, merged with what is there. Open like any contact contribution: a
 * rescuer outside the profile's team adds it too, recorded as a
 * 'contribution' (grants nothing). Real SQL on the real schema.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { session, getUser, isAdmin, OWNER, MATE, STRANGER } from '@/test-utils/actionMocks';
import * as mocks from '@/test-utils/actionMocks';
import { logger } from '@/lib/logger';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));
vi.mock('./_db', () => ({ getDb: async () => state.db, getUser }));
vi.mock('@/config/admins', () => ({ isAdminAsync: isAdmin, isModeratorOrAdminAsync: isAdmin }));
vi.mock('@/lib/orgMembership', () => ({ isOrgMate: mocks.isOrgMate, isOwnerOrOrgMate: mocks.isOwnerOrOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor }));
// The owner-team notice (profile_content_added) writes through @/lib/db: keep it on the test database, never local.db.
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn(async () => undefined) }));
vi.mock('@/lib/pendingSearchLog', () => ({ closePendingSearchesForAdopter: vi.fn(async () => undefined) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

import { saveAdoption } from './adoptions';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown } };

type Entry = { type: string; value: string; streetAndNumber?: string; locality?: string; addedBy?: string };
const addresses = (adopterId = 'ad1'): Entry[] => {
    const raw = sqlite.prepare('SELECT contact_entries AS e FROM adopters WHERE id = ?').get(adopterId)!.e as string | null;
    return (raw ? JSON.parse(raw) as Entry[] : []).filter(e => e.type === 'address');
};
const MAIPU = 'Av. Maipú 1200, Vicente López';
const contactHistoryKinds = (email: string) => (sqlite as unknown as { prepare: (s: string) => { all: (...a: unknown[]) => Row[] } })
    .prepare(`SELECT kind FROM adopter_history WHERE adopter_id = 'ad1' AND changed_by = ? AND changes LIKE '%"contactInfo"%'`).all(email).map(r => r.kind);

async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
    const before = session.user;
    session.user = user;
    try { return await fn(); } finally { session.user = before; }
}

describe('saveAdoption — the delivery address reaches the profile\'s contacts', () => {
    beforeEach(() => {
        const m = migratedDb();
        state.db = m.db;
        sqlite = m.sqlite as unknown as typeof sqlite;
        session.user = OWNER;
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('ad1', 'Carla', '5', ?, 1000, 1000)`).run(OWNER);
        // An adoption that was NOT delivered home yet.
        sqlite.prepare(`INSERT INTO animals (id, name, species, added_by, created_at, updated_at) VALUES ('an1', 'Nina', 'cat', ?, 1000, 1000)`).run(OWNER);
        sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at, status, delivered_to_home, verified_address, recorded_by)
            VALUES ('an1-plc', 'an1', 'ad1', 'adoption', 1000, 'completed', 0, NULL, ?)`).run(OWNER);
        vi.restoreAllMocks();
    });

    it('create: an adoption delivered home adds the address, as street and locality', async () => {
        await saveAdoption({ adopterId: 'ad1', recordType: 'adoption', animalName: 'Luna', species: 'cat', deliveredToHome: 1, verifiedAddress: MAIPU } as never);
        expect(addresses()).toEqual([expect.objectContaining({ value: MAIPU, streetAndNumber: 'Av. Maipú 1200', locality: 'Vicente López', addedBy: OWNER })]);
    });

    it('create: a «Tránsito» delivered home by a teammate adds it too', async () => {
        await as(MATE, () => saveAdoption({ adopterId: 'ad1', recordType: 'foster', animalName: 'Luna', species: 'cat', deliveredToHome: 1, verifiedAddress: MAIPU } as never));
        expect(addresses().map(e => e.value)).toEqual([MAIPU]);
    });

    it('create: someone outside the team adds it as a contribution', async () => {
        await as(STRANGER, () => saveAdoption({ adopterId: 'ad1', recordType: 'adoption', animalName: 'Luna', species: 'cat', deliveredToHome: 1, verifiedAddress: MAIPU } as never));
        expect(addresses().map(e => e.value)).toEqual([MAIPU]);
        expect(contactHistoryKinds(STRANGER)).toEqual(['contribution']);
    });

    it('create: the owner\'s copy is an edit', async () => {
        await saveAdoption({ adopterId: 'ad1', recordType: 'adoption', animalName: 'Luna', species: 'cat', deliveredToHome: 1, verifiedAddress: MAIPU } as never);
        expect(contactHistoryKinds(OWNER)).toEqual(['edit']);
    });

    it('a deleted profile gets nothing (logged); the record still saves', async () => {
        sqlite.prepare(`UPDATE adopters SET deleted_at = 2000 WHERE id = 'ad1'`).run();
        const warn = vi.spyOn(logger, 'warn');
        const res = await saveAdoption({ id: 'an1', deliveredToHome: 1, verifiedAddress: MAIPU } as never, { loaded: { deliveredToHome: 0, verifiedAddress: null } });
        expect(res.saved).toEqual(expect.arrayContaining(['deliveredToHome', 'verifiedAddress']));
        expect(addresses()).toEqual([]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('delivery address not copied'), expect.objectContaining({ adopterId: 'ad1', changedBy: OWNER }));
    });

    it('create: a follow-up carrying a stale «delivered» toggle copies nothing (it does not store it)', async () => {
        await saveAdoption({ adopterId: 'ad1', recordType: 'follow_up', species: 'cat', deliveredToHome: 1, verifiedAddress: MAIPU } as never);
        expect(addresses()).toEqual([]);
    });

    it('edit: marking «Entregado en casa» later adds the address', async () => {
        const res = await saveAdoption({ id: 'an1', deliveredToHome: 1, verifiedAddress: MAIPU } as never, { loaded: { deliveredToHome: 0, verifiedAddress: null } });
        expect(res.conflicts).toEqual([]);
        expect(addresses()).toEqual([expect.objectContaining({ value: MAIPU, streetAndNumber: 'Av. Maipú 1200', locality: 'Vicente López' })]);
    });

    it('edit: changing only the address copies the new one', async () => {
        await saveAdoption({ id: 'an1', deliveredToHome: 1, verifiedAddress: MAIPU } as never, { loaded: { deliveredToHome: 0, verifiedAddress: null } });
        await saveAdoption({ id: 'an1', verifiedAddress: 'Belgrano 55, Tigre' } as never, { loaded: { deliveredToHome: 1, verifiedAddress: MAIPU } });
        expect(addresses().map(e => e.value)).toEqual([MAIPU, 'Belgrano 55, Tigre']);
    });

    it('an address already on the profile is not added twice', async () => {
        sqlite.prepare(`UPDATE adopters SET contact_entries = ?, contact_info = ? WHERE id = 'ad1'`)
            .run(JSON.stringify([{ id: 'e1', type: 'address', value: 'av. maipú 1200, vicente lópez ' }]), 'av. maipú 1200, vicente lópez ');
        await saveAdoption({ id: 'an1', deliveredToHome: 1, verifiedAddress: MAIPU } as never, { loaded: { deliveredToHome: 0, verifiedAddress: null } });
        expect(addresses()).toHaveLength(1);
    });

    it('an address written without a space after the comma is not added a second time', async () => {
        sqlite.prepare(`UPDATE adopters SET contact_entries = ?, contact_info = ? WHERE id = 'ad1'`)
            .run(JSON.stringify([{ id: 'e1', type: 'address', value: 'Belgrano 123,CABA' }]), 'Belgrano 123,CABA');
        await saveAdoption({ id: 'an1', deliveredToHome: 1, verifiedAddress: 'Belgrano 123,CABA' } as never, { loaded: { deliveredToHome: 0, verifiedAddress: null } });
        expect(addresses()).toHaveLength(1);
    });

    it('edit: saving another field leaves the contacts alone (a removed address is not put back)', async () => {
        sqlite.prepare(`UPDATE placements SET delivered_to_home = 1, verified_address = ? WHERE id = 'an1-plc'`).run(MAIPU);
        await saveAdoption({ id: 'an1', rating: 4 } as never, { loaded: { rating: null } });
        expect(addresses()).toEqual([]);
    });

    it('edit: a conflict on the address writes neither the record\'s address nor the contact', async () => {
        sqlite.prepare(`UPDATE placements SET delivered_to_home = 1, verified_address = 'Belgrano 55, Tigre' WHERE id = 'an1-plc'`).run();
        const res = await saveAdoption({ id: 'an1', verifiedAddress: MAIPU } as never, { loaded: { verifiedAddress: 'Otra 1, Pilar' } });
        expect(res.conflicts?.map(c => c.field)).toEqual(['verifiedAddress']);
        expect(addresses().map(e => e.value)).not.toContain(MAIPU);
    });

    it('edit: the author outside the profile\'s team marks their «Tránsito» delivered: added as a contribution', async () => {
        sqlite.prepare(`INSERT INTO animals (id, name, species, added_by, created_at, updated_at) VALUES ('an2', 'Tom', 'cat', ?, 1000, 1000)`).run(STRANGER);
        sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at, status, delivered_to_home, verified_address, recorded_by)
            VALUES ('an2-plc', 'an2', 'ad1', 'foster', 1000, 'completed', 0, NULL, ?)`).run(STRANGER);
        const res = await as(STRANGER, () => saveAdoption({ id: 'an2', deliveredToHome: 1, verifiedAddress: MAIPU } as never, { loaded: { deliveredToHome: 0, verifiedAddress: null } }));
        expect(res.saved).toEqual(expect.arrayContaining(['deliveredToHome', 'verifiedAddress']));
        expect(addresses().map(e => e.value)).toEqual([MAIPU]);
        expect(contactHistoryKinds(STRANGER)).toEqual(['contribution']);
    });
});
