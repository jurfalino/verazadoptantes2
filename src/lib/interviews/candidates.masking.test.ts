import { describe, it, expect, vi } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { isAdmin, isOrgMate, isOwnerOrOrgMate, OWNER, STRANGER } from '@/test-utils/actionMocks';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/config/features', () => ({ getFeatureFlag: async (f: string) => f === 'ENABLE_PII_ACCESS_GATING' }));
vi.mock('@/config/admins', () => ({ isAdminAsync: isAdmin, isModeratorOrAdminAsync: isAdmin, isAdmin: (e: string) => e === 'admin@example.com' }));
vi.mock('@/lib/orgMembership', () => ({ isOrgMate, isOwnerOrOrgMate }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: {} }) }));

import { hydrateDuplicateMatches } from '@/app/actions/hydrateDuplicateMatches';
import { toCandidateSummary } from './candidates';

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

describe('toCandidateSummary over the real masking pipeline (gating on)', () => {
    it("a stranger learns that another rescuer's profile HAS a phone and an address, never the values", async () => {
        const { db, sqlite } = migratedDb();
        state.db = asyncDb(db);
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, contact_info, contact_entries, address_info, created_at, updated_at, deleted_at, is_demo, is_public)
            VALUES ('p1', 'Carla Gómez', '5', ?, 'Tel: +5491165851333', ?, 'Rivadavia 4500, Caballito', 1000, 1000, NULL, 0, 0)`)
            .run(OWNER, JSON.stringify([{ type: 'phone', value: '+5491165851333' }, { type: 'address', value: 'Rivadavia 4500' }]));
        const [m] = await hydrateDuplicateMatches(state.db as typeof db,
            [{ adopterId: 'p1', adopterName: '', relevancePercent: 0, matchTypes: [], matchValues: [], source: 'token' }],
            { viewer: STRANGER, isUnauthenticated: false });
        expect(m.contactProtected).toBe(true);
        const s = toCandidateSummary(m, { viewerIsAdmin: false });
        expect(s.stored).toEqual(expect.arrayContaining(['phones', 'address']));
        const visible = JSON.stringify(s.visible);
        expect(visible).not.toContain('65851333');
        expect(visible).not.toContain('Rivadavia');
    });
});
