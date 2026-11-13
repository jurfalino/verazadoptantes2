/**
 * getAdoptionDeleteImpact (the «Es el único registro de {animal}…» probe): only someone who may delete the
 * record learns anything, and a failed candidate count is «unknown» (null → the generic warning), never 0.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { session, getUser, isAdmin, isOrgMate, isOwnerOrOrgMate, OWNER, STRANGER } from '@/test-utils/actionMocks';
import { form, application, type Sqlite } from '@/test-utils/applicationFixtures';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown, countFails: false } }));
vi.mock('./_db', () => ({ getDb: async () => state.db, getUser }));
vi.mock('@/config/admins', () => ({ isAdminAsync: isAdmin, isModeratorOrAdminAsync: isAdmin }));
vi.mock('@/lib/orgMembership', () => ({ isOrgMate, isOwnerOrOrgMate, getOrgMemberEmailsFor: async (e: string) => [e], getTeamEmails: async (e: string) => [e] }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/applicationWrites', async (orig) => {
    const real = await orig<typeof import('@/lib/applicationWrites')>();
    return { ...real, countOpenApplicationsForAnimal: async (...a: Parameters<typeof real.countOpenApplicationsForAnimal>) => {
        if (state.countFails) throw new Error('D1 down');
        return real.countOpenApplicationsForAnimal(...a);
    } };
});

import { getAdoptionDeleteImpact } from './adoptions';

let sqlite: Sqlite;

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    state.countFails = false;
    sqlite = m.sqlite as unknown as Sqlite;
    session.user = OWNER;
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('ad1', 'Carla', '5', ?, 1000, 1000)`).run(OWNER);
    sqlite.prepare(`INSERT INTO animals (id, name, species, added_by, created_at, updated_at) VALUES ('an1', 'Nina', 'cat', ?, 1000, 1000)`).run(OWNER);
    sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at, status, recorded_by)
        VALUES ('an1-plc', 'an1', 'ad1', 'foster', 1000, 'active', ?)`).run(OWNER);
    form(sqlite, 's1', { adopter: null, animal: 'an1' });
    application(sqlite, 'app-s1', 's1', 'an1');
    form(sqlite, 's2', { adopter: null, animal: 'an1' });
    application(sqlite, 'app-s2', 's2', 'an1');
});

describe('getAdoptionDeleteImpact', () => {
    it('the record\'s team: the animal would go to the trash, and 2 candidates would be lost', async () => {
        const impact = await getAdoptionDeleteImpact('an1', 'ad1');
        expect(impact).toMatchObject({ kind: 'animal', animalName: 'Nina', willDeleteAnimal: true, openCandidates: 2 });
    });

    it('a stranger learns nothing (the generic fallback)', async () => {
        session.user = STRANGER;
        const impact = await getAdoptionDeleteImpact('an1', 'ad1');
        expect(impact).toMatchObject({ kind: 'event', animalName: null, openCandidates: 0 });
    });

    it('a failed candidate count is unknown (null), not zero — the rest of the probe still answers', async () => {
        state.countFails = true;
        const impact = await getAdoptionDeleteImpact('an1', 'ad1');
        expect(impact).toMatchObject({ kind: 'animal', willDeleteAnimal: true, openCandidates: null });
    });
});
