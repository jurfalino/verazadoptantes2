/**
 * One rule for household `profileId` (D44 review): only addHouseholdMember may
 * set it. A profileId arriving in household JSON through the import endpoint
 * (POST /api/adopters) or the submission factory is dropped — the member is
 * saved, the link to someone else's profile is not, and no household_links row
 * appears. Real route / factory, real SQL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { email: 'rescuer@example.com', name: 'Rescuer' } })) }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: async () => 'rescuer@example.com' }));
vi.mock('@/config/features', async (orig) => ({ ...(await orig()), getFeatureFlag: vi.fn(async () => false) }));
vi.mock('@/config/admins', () => ({ isAdminAsync: async () => false, isModeratorOrAdminAsync: async () => false, isAdmin: () => false }));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async () => undefined) }));
vi.mock('@/lib/r2', () => ({ processImageForStorage: vi.fn(), uploadToR2: vi.fn() }));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: (_n: string, fn: () => unknown) => fn(),
}));

import { POST } from './route';
import { createAdopterFromSubmission } from '@/app/actions/_adopterFactory';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by) VALUES ('someone-else', 'Jonathan Urfalino', '5', 'other@example.com')`).run();
});

const householdOf = (id: string) => JSON.parse((sqlite.prepare('SELECT household_members FROM adopters WHERE id = ?').get(id)!.household_members as string | null) || '[]');

describe('profileId only through addHouseholdMember', () => {
    it('POST /api/adopters keeps the relative but drops a planted profileId', async () => {
        const res = await POST(new Request('http://localhost/api/adopters', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                name: 'Pedro Paez',
                contactInfo: '+54 9 11 6123 4455',
                householdMembers: JSON.stringify([{ id: 'x', name: 'Jonathan Urfalino', relationship: 'sibling', contactEntries: [], profileId: 'someone-else' }]),
            }),
        }));
        expect(res.status, JSON.stringify(await res.clone().json())).toBeLessThan(300);
        const created = sqlite.prepare(`SELECT id FROM adopters WHERE name = 'Pedro Paez'`).get()!;
        const members = householdOf(created.id as string);
        expect(members).toHaveLength(1);
        expect(members[0]).toMatchObject({ name: 'Jonathan Urfalino', relationship: 'sibling' });
        expect(members[0]).not.toHaveProperty('profileId');
        expect(sqlite.prepare('SELECT COUNT(*) AS n FROM household_links').get()!.n).toBe(0);
    });

    it('the submission factory drops a profileId too', async () => {
        const out = await createAdopterFromSubmission({
            name: 'Ana Díaz', addedBy: 'rescuer@example.com', source: 'form',
            householdMembers: [{ id: 'm1', name: 'Jonathan Urfalino', relationship: 'partner', contactEntries: [], profileId: 'someone-else' }],
        } as Parameters<typeof createAdopterFromSubmission>[0]);
        const members = householdOf(out.adopterId);
        expect(members).toEqual([expect.objectContaining({ id: 'm1', name: 'Jonathan Urfalino' })]);
        expect(members[0]).not.toHaveProperty('profileId');
    });
});
