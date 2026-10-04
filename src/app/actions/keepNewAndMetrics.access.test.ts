/**
 * markContractKeepNew: signed-in, own/team profile only.
 * fetchMetrics / fetchTopErrors7d: admin only.
 * findAdopters (browser action): duplicate mode needs a session.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { session, getUser, isAdmin, isOrgMate, isOwnerOrOrgMate, OWNER, MATE, STRANGER, ADMIN } from '@/test-utils/actionMocks';

const { state, engine } = vi.hoisted(() => ({ state: { db: null as unknown }, engine: vi.fn() }));
vi.mock('./_db', () => ({ getDb: async () => state.db, getUser }));
vi.mock('@/config/admins', () => ({ isAdminAsync: isAdmin, isModeratorOrAdminAsync: isAdmin }));
vi.mock('@/lib/orgMembership', () => ({ isOrgMate, isOwnerOrOrgMate }));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn() }));
vi.mock('@/lib/adopterMerge', () => ({ mergeAdopters: vi.fn() }));
vi.mock('@/auth', () => ({ auth: async () => (session.user ? { user: { email: session.user } } : null) }));
vi.mock('@/lib/axiom', () => ({
    METRICS: {}, getTimeSeries: vi.fn(), getPriorTotal: vi.fn(), getWindowTotal: vi.fn(),
    windowIso: () => ({ startTime: 'a', endTime: 'b' }), getTraceLatencies: vi.fn(async () => []),
    getTopErrors: vi.fn(async () => [{ message: 'boom', count: 3 }]), getAxiomDeepLinkUrl: () => null,
}));
vi.mock('./findAdopters', () => ({ findAdopters: engine }));

import { markContractKeepNew } from './duplicates';
import { fetchMetrics, fetchTopErrors7d } from './metrics';
import { findAdopters } from './findAdoptersAction';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown } };
const keptRows = () => Number(sqlite.prepare("SELECT COUNT(*) AS n FROM adopter_stats WHERE event_type = 'contract_kept_new'").get()!.n);

describe('markContractKeepNew', () => {
    beforeEach(() => {
        const m = migratedDb(); state.db = m.db; sqlite = m.sqlite as unknown as typeof sqlite;
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('orphan', 'Carla', '5', ?, 1, 1)`).run(OWNER);
    });

    it('anonymous and strangers: nothing recorded', async () => {
        session.user = null;
        expect(await markContractKeepNew('orphan')).toEqual({ success: false });
        session.user = STRANGER;
        expect(await markContractKeepNew('orphan')).toEqual({ success: false });
        expect(keptRows()).toBe(0);
    });

    it('the owner (or a teammate): recorded', async () => {
        session.user = OWNER;
        expect(await markContractKeepNew('orphan')).toEqual({ success: true });
        session.user = MATE;
        expect(await markContractKeepNew('orphan')).toEqual({ success: true });
        expect(keptRows()).toBe(2);
    });
});

describe('metrics — admin only', () => {
    it('anonymous and non-admins are refused with an errorId', async () => {
        for (const u of [null, OWNER]) {
            session.user = u;
            await expect(fetchMetrics('7d')).rejects.toThrow(/Unauthorized \(Error ID: \w+\)/);
            await expect(fetchTopErrors7d()).rejects.toThrow(/Unauthorized \(Error ID: \w+\)/);
        }
    });

    it('an admin gets the data', async () => {
        session.user = ADMIN;
        expect((await fetchTopErrors7d()).items).toEqual([{ message: 'boom', count: 3, link: null }]);
        expect((await fetchMetrics('7d')).window).toBe('7d');
    });
});

describe('findAdopters (browser action)', () => {
    beforeEach(() => { engine.mockReset().mockResolvedValue({ results: [{ adopterId: 'x' }] }); });

    it('duplicate mode, anonymous: no results, the engine is never asked', async () => {
        session.user = null;
        expect(await findAdopters({ name: 'García' }, { mode: 'duplicate' })).toEqual({ results: [] });
        expect(engine).not.toHaveBeenCalled();
    });

    it('duplicate mode, signed-in: runs', async () => {
        session.user = STRANGER;
        expect((await findAdopters({ name: 'García' }, { mode: 'duplicate' })).results).toHaveLength(1);
    });

    it('discovery mode: passes through (the engine masks for anonymous viewers itself)', async () => {
        session.user = null;
        await findAdopters({ raw: 'García' }, { mode: 'discovery' });
        expect(engine).toHaveBeenCalledWith({ raw: 'García' }, { mode: 'discovery' });
    });
});
