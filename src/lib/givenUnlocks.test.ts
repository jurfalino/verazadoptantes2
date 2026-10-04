/**
 * «What the adopter gave you stays yours», through the central visibility
 * path, against a real (in-memory) SQLite so the team / linked filters run as
 * SQL. Rescuer A owns adopter X; B received the applicant's form, which
 * «Es la misma persona» linked to X; T is B's teammate; C is unrelated.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

const { state, orgMatesMock, isOrgMateMock } = vi.hoisted(() => ({
    state: { db: null as unknown },
    orgMatesMock: vi.fn(),
    isOrgMateMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/config/admins', () => ({ isAdminAsync: vi.fn(async () => false), isModeratorOrAdminAsync: vi.fn(async () => false) }));
vi.mock('@/lib/orgMembership', () => ({ isOrgMate: isOrgMateMock }));
vi.mock('@/app/actions/organizations', () => ({ getOrgMemberEmailsFor: orgMatesMock }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

import { resolveAdopterVisibility, resolveAdoptersVisibility } from './piiAccessServer';
import { maskContactEntries } from './piiAccess';
import type { ContactEntry } from './contactEntries';

const A = 'rescuer-a@example.com';
const B = 'rescuer-b@example.com';
const T = 'teammate-of-b@example.com';
const C = 'rescuer-c@example.com';
const TYPED_PHONE = '11 5555-0109';
const TYPED_EMAIL = 'carla.nueva@example.com';
const A_PHONE = '+54 9 11 4444-0000';
const A_EMAIL = 'carla.privada@example.com';

// X after the merge: A's own entries plus the ones B's applicant typed.
const X_ENTRIES: ContactEntry[] = [
    { type: 'phone', value: A_PHONE },
    { type: 'email', value: A_EMAIL },
    { type: 'address', value: 'Calle Secreta 1234, Flores' },
    { type: 'phone', value: TYPED_PHONE },
    { type: 'email', value: TYPED_EMAIL },
];

function seed(opts: { dropSubmissions?: boolean } = {}) {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
        CREATE TABLE adopter_history (id TEXT, adopter_id TEXT, changed_by TEXT, kind TEXT);
        CREATE TABLE pii_access_grants (id TEXT, adopter_id TEXT, grantee_email TEXT, scope TEXT, entry_ref TEXT, revoked_at INTEGER);
        CREATE TABLE form_submissions (id TEXT, user_id TEXT, email TEXT, phone TEXT, linked_adopter_id TEXT, auto_adopter_id TEXT);
        INSERT INTO form_submissions VALUES
            ('s1', '${B}', '${TYPED_EMAIL}', '${TYPED_PHONE}', 'X', 'orphan-1'),
            ('s2', '${B}', 'otra@example.com', '11 7777-0000', 'Y', 'orphan-2'),
            ('s3', '${C}', 'c-typed@example.com', '11 8888-0000', 'Z', 'Z');
    `);
    if (opts.dropSubmissions) sqlite.exec('DROP TABLE form_submissions');
    state.db = drizzle(sqlite);
}

const visibleValues = (v: Parameters<typeof maskContactEntries>[1]) =>
    maskContactEntries(X_ENTRIES, v).entries.filter(e => !e.masked).map(e => e.value);

describe('given-to-me unlocks (central visibility)', () => {
    beforeEach(() => {
        seed();
        isOrgMateMock.mockReset().mockResolvedValue(false);
        orgMatesMock.mockReset().mockImplementation(async (email: string) => (email === T || email === B ? [B, T] : [email]));
    });

    it('B (received the form): sees exactly what the applicant typed; A\'s phone, email and street stay masked', async () => {
        const v = await resolveAdopterVisibility(B, { id: 'X', addedBy: A });
        expect(v.nothingMasked).toBe(false);
        expect(visibleValues(v).sort()).toEqual([TYPED_EMAIL, TYPED_PHONE].sort());
    });

    it('T (B\'s teammate): the same', async () => {
        const v = await resolveAdopterVisibility(T, { id: 'X', addedBy: A });
        expect(visibleValues(v).sort()).toEqual([TYPED_EMAIL, TYPED_PHONE].sort());
    });

    it('C (never received a form from this adopter): nothing', async () => {
        const v = await resolveAdopterVisibility(C, { id: 'X', addedBy: A });
        expect(visibleValues(v)).toEqual([]);
        expect(v.tier).toBe('none');
    });

    it('a submission linked to ANOTHER profile never unlocks this one', async () => {
        const v = await resolveAdopterVisibility(B, { id: 'Y', addedBy: A });
        // Y has B's other submission; X's typed values must not leak into Y's check.
        expect(maskContactEntries(X_ENTRIES, v).entries.filter(e => !e.masked)).toEqual([]);
    });

    it('search batch: one lookup per viewer, filtered per profile', async () => {
        const map = await resolveAdoptersVisibility(B, [{ id: 'X', addedBy: A }, { id: 'W', addedBy: A }]);
        expect(visibleValues(map.get('X')!).sort()).toEqual([TYPED_EMAIL, TYPED_PHONE].sort());
        expect(visibleValues(map.get('W')!)).toEqual([]);
        const cMap = await resolveAdoptersVisibility(C, [{ id: 'X', addedBy: A }]);
        expect(visibleValues(cMap.get('X')!)).toEqual([]);
    });

    it('search batch skips a form still on its own auto-created profile (linked = auto)', async () => {
        const map = await resolveAdoptersVisibility(C, [{ id: 'Z', addedBy: A }]);
        expect(map.get('Z')!.unlockedEntryHashes.size).toBe(0);
    });

    it('lookup failure: no given unlocks, and the owner keeps full access', async () => {
        seed({ dropSubmissions: true });
        const owner = await resolveAdopterVisibility(A, { id: 'X', addedBy: A });
        expect(owner.nothingMasked).toBe(true);
        const b = await resolveAdopterVisibility(B, { id: 'X', addedBy: A });
        expect(visibleValues(b)).toEqual([]);
        const batch = await resolveAdoptersVisibility(A, [{ id: 'X', addedBy: A }]);
        expect(batch.get('X')!.nothingMasked).toBe(true);
    });
});
