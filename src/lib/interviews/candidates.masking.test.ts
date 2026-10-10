import { describe, it, expect, vi } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { isAdmin, isOrgMate, isOwnerOrOrgMate, getOrgMemberEmailsFor, OWNER, MATE, STRANGER } from '@/test-utils/actionMocks';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/config/features', () => ({ getFeatureFlag: async (f: string) => f === 'ENABLE_PII_ACCESS_GATING' }));
vi.mock('@/config/admins', () => ({ isAdminAsync: isAdmin, isModeratorOrAdminAsync: isAdmin, isAdmin: (e: string) => e === 'admin@example.com' }));
vi.mock('@/lib/orgMembership', () => ({ isOrgMate, isOwnerOrOrgMate, getOrgMemberEmailsFor }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: {} }) }));

import { hydrateDuplicateMatches } from '@/app/actions/hydrateDuplicateMatches';
import { logger } from '@/lib/logger';
import { toCandidateSummary } from './candidates';
import { hydrateCandidates } from './store';

// migratedDb is the SYNC better-sqlite3 driver (.get() returns a row); production D1 returns
// promises and the action code chains .catch on them. Make the terminal calls async.
function asyncDb<T extends object>(target: T): T {
    return new Proxy(target, {
        get(t, p, r) {
            const v = Reflect.get(t, p, r);
            if (typeof v !== 'function') return v;
            return (...args: unknown[]) => {
                const out = (v as (...a: unknown[]) => unknown).apply(t, args);
                if (p === 'get' || p === 'all' || p === 'run' || p === 'values') return Promise.resolve(out);
                return out && typeof out === 'object' && p !== 'then' ? asyncDb(out as object) : out;
            };
        },
    });
}

function seed(id: string, over: { entries: string | null; blob: string; address: string }) {
    const { db, sqlite } = migratedDb();
    state.db = asyncDb(db);
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, contact_info, contact_entries, address_info, created_at, updated_at, deleted_at, is_demo, is_public)
        VALUES (?, 'Carla Gómez', '5', ?, ?, ?, ?, 1000, 1000, NULL, 0, 0)`)
        .run(id, OWNER, over.blob, over.entries, over.address);
    return state.db as typeof db;
}
const stub = (adopterId: string) => ({ adopterId, adopterName: '', relevancePercent: 0, matchTypes: [], matchValues: [], source: 'token' as const });
const ENTRIES = JSON.stringify([{ type: 'phone', value: '+5491165851333' }, { type: 'address', value: 'Rivadavia 4500' }]);

describe('candidates over the real masking pipeline (gating on)', () => {
    it("a stranger learns that another rescuer's profile HAS a phone and an address, never the values", async () => {
        const warn = vi.spyOn(logger, 'warn');
        const db = seed('p1', { entries: ENTRIES, blob: 'Tel: +5491165851333', address: 'Rivadavia 4500, Caballito' });
        const [m] = await hydrateDuplicateMatches(db, [stub('p1')], { viewer: STRANGER, isUnauthenticated: false });
        expect(m.contactProtected).toBe(true);
        const s = toCandidateSummary(m, { canEdit: false });
        expect(s.stored).toEqual(expect.arrayContaining(['phones', 'address']));
        const visible = JSON.stringify(s.visible);
        expect(visible).not.toContain('65851333');
        expect(visible).not.toContain('Rivadavia');
        expect(warn.mock.calls.some(c => String(c[0]).includes('failing closed'))).toBe(false);
        warn.mockRestore();
    });

    it('positive control: the owner sees their own values (the resolver is not failing closed)', async () => {
        const warn = vi.spyOn(logger, 'warn');
        const db = seed('p1', { entries: ENTRIES, blob: 'Tel: +5491165851333', address: 'Rivadavia 4500, Caballito' });
        const [m] = await hydrateDuplicateMatches(db, [stub('p1')], { viewer: OWNER, isUnauthenticated: false });
        expect(m.contactProtected).toBe(false);
        const s = toCandidateSummary(m, { canEdit: true });
        expect(s.visible.phones).toContain('+5491165851333');
        expect(warn.mock.calls.some(c => String(c[0]).includes('failing closed'))).toBe(false);
        warn.mockRestore();
    });

    it('a protected legacy-blob profile still reports phones and emails as stored, with no raw value', async () => {
        const db = seed('p2', { entries: null, blob: 'Tel: +5491165851333\nEmail: carla@example.com', address: '' });
        const [s] = await hydrateCandidates(db, ['p2'], STRANGER, false);
        expect(s.stored).toEqual(expect.arrayContaining(['phones', 'emails']));
        const out = JSON.stringify(s);
        expect(out).not.toContain('65851333');
        expect(out).not.toContain('carla@example.com');
    });

    it('canEdit: owner and teammate yes, stranger no, admin yes', async () => {
        const db = seed('p1', { entries: ENTRIES, blob: 'Tel: +5491165851333', address: '' });
        const edit = async (v: string, admin = false) => (await hydrateCandidates(db, ['p1'], v, admin))[0].canEdit;
        expect(await edit(OWNER)).toBe(true);
        expect(await edit(MATE)).toBe(true);
        expect(await edit(STRANGER)).toBe(false);
        expect(await edit(STRANGER, true)).toBe(true);
    });
});
