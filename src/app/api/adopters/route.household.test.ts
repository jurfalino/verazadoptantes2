/**
 * One rule for household `profileId` (D44 review): a profileId arriving in
 * household JSON through the import endpoint (POST /api/adopters) is dropped —
 * the person is saved (households as profiles: their own profile + a
 * membership, src/lib/householdPeople.ts), never linked to someone else's
 * profile by that id, and no household_links row appears. Nothing writes
 * adopters.household_members any more. Real route / factory, real SQL.
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
vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: {} }) }));
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

const householdPeopleOf = (id: string) => sqlite.prepare(
    `SELECT a.id, a.name, a.contact_entries, m.relationship FROM household_memberships m JOIN adopters a ON a.id = m.adopter_id
     WHERE m.household_id = (SELECT household_id FROM household_memberships WHERE adopter_id = ? LIMIT 1) AND m.adopter_id <> ? ORDER BY m.added_at, m.id`,
).all(id, id);
const storedJson = (id: string) => sqlite.prepare('SELECT household_members FROM adopters WHERE id = ?').get(id)!.household_members;

describe('view markers are never stored', () => {
    it('POST /api/adopters drops own: true on contact entries, household people and their entries', async () => {
        const res = await POST(new Request('http://localhost/api/adopters', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                name: 'Marca Plantada',
                contactEntries: JSON.stringify([{ id: 'e1', type: 'email', value: 'plantada@example.org', own: true }]),
                householdMembers: JSON.stringify([{ id: 'x', name: 'Ana', relationship: 'sibling', own: true, contactEntries: [{ id: 'c1', type: 'phone', value: '+54 11 4444 3434', own: true }] }]),
            }),
        }));
        expect(res.status, JSON.stringify(await res.clone().json())).toBeLessThan(300);
        const created = sqlite.prepare(`SELECT id, contact_entries FROM adopters WHERE name = 'Marca Plantada'`).get()!;
        expect(created.contact_entries as string).toContain('plantada@example.org');
        expect(storedJson(created.id as string)).toBeNull();
        const people = householdPeopleOf(created.id as string);
        expect(people).toEqual([expect.objectContaining({ name: 'Ana', relationship: 'sibling' })]);
        expect(people[0].contact_entries as string).toContain('+54 11 4444 3434');
        expect(`${created.contact_entries}${people[0].contact_entries}`).not.toContain('"own"');
    });
});

describe('profileId only through the household actions', () => {
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
        const people = householdPeopleOf(created.id as string);
        expect(people).toHaveLength(1);
        expect(people[0]).toMatchObject({ name: 'Jonathan Urfalino', relationship: 'sibling' });
        expect(people[0].id).not.toBe('someone-else');
        expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM household_memberships WHERE adopter_id = 'someone-else'`).get()!.n).toBe(0);
        expect(sqlite.prepare('SELECT COUNT(*) AS n FROM household_links').get()!.n).toBe(0);
    });

    it('the submission factory never writes household_members', async () => {
        const out = await createAdopterFromSubmission({ name: 'Ana Díaz', addedBy: 'rescuer@example.com', source: 'form' });
        expect(storedJson(out.adopterId)).toBeNull();
    });
});

describe('GET /api/adopters never returns the old household JSON (Task 8 fix A3)', () => {
    it('a person match comes back with householdMembers null', async () => {
        sqlite.prepare(`UPDATE adopters SET household_members = ? WHERE id = 'someone-else'`)
            .run(JSON.stringify([{ id: 'hm1', name: 'Marta Secreta', relationship: 'partner', contactEntries: [{ id: 'c', type: 'phone', value: '11 5555 0000' }] }]));
        const { GET } = await import('./route');
        const res = await GET(new Request('http://x/api/adopters?matchName=Jonathan'));
        const body = await res.json() as { matches: Array<Record<string, unknown>> };
        expect(body.matches.length).toBeGreaterThan(0);
        expect(body.matches.every(m => m.householdMembers === null)).toBe(true);
        expect(JSON.stringify(body)).not.toContain('Marta Secreta');
    });
});
