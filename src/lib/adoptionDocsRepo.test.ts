import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sha256Hex, recordSignature } from './adoptionDocsRepo';
import { logger } from './logger';

describe('sha256Hex', () => {
    it('matches the known sha256("abc") vector', async () => {
        expect(await sha256Hex('abc')).toBe(
            'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        );
    });
});

// ── recordSignature (F4: ownership rule) ─────────────────────────────
// A minimal fake of the drizzle chain recordSignature touches:
//   select().from().where().get()  → getContractVersion
//   select().from().where().all()  → getMemberOrgIds
//   update().set().where()         → first_signed_at stamp
//   insert().values()              → signed_contracts row
type FakeOpts = { version?: Record<string, unknown> | null; orgIds?: string[]; failSelect?: boolean };
function fakeDb(opts: FakeOpts) {
    const inserts: Array<Record<string, unknown>> = [];
    const updates: Array<Record<string, unknown>> = [];
    const db = {
        select: () => ({
            from: () => ({
                where: () => ({
                    get: async () => { if (opts.failSelect) throw new Error('D1 down'); return opts.version ?? undefined; },
                    all: async () => { if (opts.failSelect) throw new Error('D1 down'); return (opts.orgIds ?? []).map(orgId => ({ orgId })); },
                }),
            }),
        }),
        update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => { updates.push(v); } }) }),
        insert: () => ({ values: async (v: Record<string, unknown>) => { inserts.push(v); } }),
    };
    return { db: db as unknown as Parameters<typeof recordSignature>[0], inserts, updates };
}

const base = { animalId: 'a1', adopterId: 'ad1', standardVersion: '582a1a83', locale: 'es', fileKey: 'k', via: 'open' as const };

describe('recordSignature', () => {
    beforeEach(() => { vi.restoreAllMocks(); });

    it('standard signature: no lookups, row stores standardVersion', async () => {
        const { db, inserts, updates } = fakeDb({});
        await recordSignature(db, { ...base, contractVersionId: null, ownerEmail: 'r@example.com' });
        expect(updates).toHaveLength(0);
        expect(inserts).toHaveLength(1);
        expect(inserts[0]).toMatchObject({ contractVersionId: null, standardVersion: '582a1a83', contentHash: null });
    });

    it('version owned by the animal owner (user): hash recorded, first_signed_at stamped', async () => {
        const { db, inserts, updates } = fakeDb({ version: { id: 'v1', ownerType: 'user', ownerId: 'r@example.com', contentHash: 'h1' } });
        await recordSignature(db, { ...base, contractVersionId: 'v1', ownerEmail: 'R@Example.com' });
        expect(updates).toHaveLength(1);
        expect(updates[0]).toHaveProperty('firstSignedAt');
        expect(inserts[0]).toMatchObject({ contractVersionId: 'v1', standardVersion: '582a1a83', contentHash: 'h1' });
    });

    it('version owned via an org the animal owner belongs to: hash recorded, stamped', async () => {
        const { db, inserts, updates } = fakeDb({ version: { id: 'v2', ownerType: 'org', ownerId: 'org-1', contentHash: 'h2' }, orgIds: ['org-1'] });
        await recordSignature(db, { ...base, contractVersionId: 'v2', ownerEmail: 'r@example.com' });
        expect(updates).toHaveLength(1);
        expect(inserts[0]).toMatchObject({ contractVersionId: 'v2', contentHash: 'h2' });
    });

    it('someone else\'s version: stored as given, hash NULL, NOT stamped, warned without emails', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const { db, inserts, updates } = fakeDb({ version: { id: 'v3', ownerType: 'user', ownerId: 'other@example.com', contentHash: 'h3' } });
        await recordSignature(db, { ...base, contractVersionId: 'v3', ownerEmail: 'r@example.com' });
        expect(updates).toHaveLength(0);
        expect(inserts[0]).toMatchObject({ contractVersionId: 'v3', contentHash: null });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(warn.mock.calls[0])).not.toMatch(/@/);
        expect(warn.mock.calls[0][1]).toMatchObject({ animalId: 'a1', contractVersionId: 'v3' });
    });

    it('org version, owner not a member: hash NULL, not stamped', async () => {
        vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const { db, inserts, updates } = fakeDb({ version: { id: 'v4', ownerType: 'org', ownerId: 'org-1', contentHash: 'h4' }, orgIds: ['org-2'] });
        await recordSignature(db, { ...base, contractVersionId: 'v4', ownerEmail: 'r@example.com' });
        expect(updates).toHaveLength(0);
        expect(inserts[0]).toMatchObject({ contractVersionId: 'v4', contentHash: null });
    });

    it('unknown version id: stored as given, hash NULL, warned', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const { db, inserts, updates } = fakeDb({ version: null });
        await recordSignature(db, { ...base, contractVersionId: 'nope', ownerEmail: 'r@example.com' });
        expect(updates).toHaveLength(0);
        expect(inserts[0]).toMatchObject({ contractVersionId: 'nope', contentHash: null });
        expect(warn).toHaveBeenCalled();
    });

    it('a failing ownership lookup still writes the signature row', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const { db, inserts, updates } = fakeDb({ failSelect: true });
        await recordSignature(db, { ...base, contractVersionId: 'v5', ownerEmail: 'r@example.com' });
        expect(updates).toHaveLength(0);
        expect(inserts).toHaveLength(1);
        expect(inserts[0]).toMatchObject({ contractVersionId: 'v5', contentHash: null });
        expect(JSON.stringify(warn.mock.calls)).not.toMatch(/@/);
    });
});
