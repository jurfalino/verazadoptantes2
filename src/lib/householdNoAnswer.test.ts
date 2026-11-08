/**
 * The household «¿Es este perfil?» → «No» recorded for real: through the Scan,
 * for every candidate offered, and only by someone who may answer the pair.
 * Real SQL (same harness as householdSearch.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { session, OWNER, ADMIN, STRANGER } = mocks;
const OTHER = 'other-rescuer@example.com';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));

vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/auth', () => ({ auth: vi.fn(async () => (session.user ? { user: { email: session.user, name: 'R' } } : null)) }));
vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: {} }) }));
vi.mock('@/config/admins', async (orig) => ({
    ...(await orig()),
    isAdminAsync: mocks.isAdmin,
    isModeratorOrAdminAsync: mocks.isAdmin,
    isAdmin: (e: string | null | undefined) => e === ADMIN,
}));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOrgMate: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    getTeamEmails: async (e: string) => mocks.getOrgMemberEmailsFor(e),
    isOwnerOrOrgMate: (v: string | null | undefined, o: string | null | undefined) => mocks.isOwnerOrOrgMate(v?.trim().toLowerCase(), o?.trim().toLowerCase()),
}));
vi.mock('@/config/features', async (orig) => ({
    ...(await orig()),
    getFeatureFlag: vi.fn(async (flag: string) => flag === 'ENABLE_PII_ACCESS_GATING' || flag === 'ENABLE_GUEST_NAME_MASK' || flag === 'ENABLE_HOUSEHOLD_MEMBERS'),
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
// Wrapped, not replaced: counts the gift-form reads of the scan (audit A5) and still reads them.
vi.mock('@/lib/giftRecipients', async (orig) => {
    const real = await orig<typeof import('./giftRecipients')>();
    return { ...real, giftPhoneEntriesByGiver: vi.fn(real.giftPhoneEntriesByGiver) };
});
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: (_op: string, fn: () => unknown) => fn(),
}));

import { tokenizeAdopter } from './adopterTokenize';
import { addHouseholdPerson } from '@/app/actions/households';
import { POST as scan } from '@/app/api/admin/duplicates/route';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };

const TYPED_PHONE = '+54 9 11 7777 8888';
const pairRows = (newId: string, other: string) => sqlite.prepare(
    `SELECT status FROM duplicate_candidates WHERE (adopter1_id = ? AND adopter2_id = ?) OR (adopter1_id = ? AND adopter2_id = ?)`).all(newId, other, other, newId);
const newProfileId = (name: string) => String(sqlite.prepare(`SELECT id FROM adopters WHERE name = ? AND id NOT LIKE 'r%' AND id != 'pedro' AND deleted_at IS NULL`).get(name)!.id);

beforeEach(async () => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    session.user = OWNER;
    const insert = sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, country, created_at, updated_at, contact_entries) VALUES (?, ?, '5', ?, 'AR', 1000, 1000, ?)`);
    insert.run('pedro', 'Pedro Paez', OWNER, '[]');
    // Five existing people with the phone the rescuer types — all on «¿Es este perfil?».
    for (let i = 1; i <= 5; i++) {
        insert.run(`r${i}`, `Rosa Diaz`, OTHER, JSON.stringify([{ id: `rc${i}`, type: 'phone', value: TYPED_PHONE, addedBy: OTHER }]));
    }
    for (const id of ['pedro', 'r1', 'r2', 'r3', 'r4', 'r5']) await tokenizeAdopter(id);
});

const addNew = (rejected: string[]) => addHouseholdPerson({
    anchorAdopterId: 'pedro', name: 'Rosa Diaz', relationship: 'unknown',
    contactEntries: [{ type: 'phone', value: TYPED_PHONE }], rejectedProfileIds: rejected,
} as never);

describe('household «No, es otra persona» is an answer that holds (spec 2026-11-05)', () => {
    it('survives the duplicate Scan: no pending pair between the new person and the rejected one', async () => {
        expect(await addNew(['r1'])).toMatchObject({ ok: true, createdProfile: true });
        const created = newProfileId('Rosa Diaz');
        session.user = ADMIN;
        const res = await scan(new Request('http://localhost/api/admin/duplicates?limit=200', { method: 'POST' }));
        expect(res.status).toBe(200);
        expect(pairRows(created, 'r1').map(r => r.status)).toEqual(['dismissed']);
    });

    it('records every candidate the rescuer said «No» to — all five, not four', async () => {
        expect(await addNew(['r1', 'r2', 'r3', 'r4', 'r5'])).toMatchObject({ ok: true, createdProfile: true });
        const created = newProfileId('Rosa Diaz');
        for (const r of ['r1', 'r2', 'r3', 'r4', 'r5']) expect(pairRows(created, r).map(x => x.status), r).toEqual(['dismissed']);
    });

    it('a contributor who owns neither profile cannot settle the pair: it opens for the owners, and the helper is told who', async () => {
        session.user = STRANGER;
        const res = await addNew(['r1']);
        expect(res).toMatchObject({ ok: true, createdProfile: true });
        const created = newProfileId('Rosa Diaz');
        expect(pairRows(created, 'r1').map(r => r.status)).toEqual(['pending']);
        expect((res as { asked?: Array<{ otherName: string; ownerLabels: string[] }> }).asked).toEqual([
            expect.objectContaining({ otherName: 'Rosa Diaz', ownerLabels: expect.arrayContaining([expect.any(String)]) }),
        ]);
    });
});
