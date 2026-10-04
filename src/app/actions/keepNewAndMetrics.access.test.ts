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
vi.mock('@/lib/piiAccessServer', () => ({
    resolveAdopterVisibility: async () => ({ tier: 'none', privileged: false, nothingMasked: false, hasAllContactGrant: false, unlockedEntryHashes: new Set(), unlockedNameTokenHashes: new Set() }),
}));

import { markContractKeepNew, getDuplicateCandidates, checkTokenDuplicates, getPendingDuplicatesForUser, mergePendingDedupPair } from './duplicates';
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

    it('a client limit is capped to the search limit, in both modes', async () => {
        session.user = STRANGER;
        await findAdopters({ raw: 'García' }, { mode: 'discovery', limit: 100000 });
        expect(engine).toHaveBeenLastCalledWith({ raw: 'García' }, { mode: 'discovery', limit: 50 });
        await findAdopters({ name: 'García' }, { mode: 'duplicate', limit: 5000 });
        expect(engine).toHaveBeenLastCalledWith({ name: 'García' }, { mode: 'duplicate', limit: 50 });
        await findAdopters({ name: 'García' }, { mode: 'duplicate', limit: 0 });
        expect(engine).toHaveBeenLastCalledWith({ name: 'García' }, { mode: 'duplicate', limit: 1 });
        await findAdopters({ name: 'García' }, { mode: 'duplicate', limit: Number.NaN });
        expect(engine).toHaveBeenLastCalledWith({ name: 'García' }, { mode: 'duplicate' });
    });

    it('discovery mode: passes through (the engine masks for anonymous viewers itself)', async () => {
        session.user = null;
        await findAdopters({ raw: 'García' }, { mode: 'discovery' });
        expect(engine).toHaveBeenCalledWith({ raw: 'García' }, { mode: 'discovery' });
    });
});

describe('duplicate readers — signed-in only', () => {
    beforeEach(() => {
        const m = migratedDb(); state.db = m.db; sqlite = m.sqlite as unknown as typeof sqlite;
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('x1', 'Carla Gómez', '5', ?, 1, 1), ('x2', 'Carla Gomez', '5', ?, 2, 2)`).run(OWNER, STRANGER);
        sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at) VALUES ('c1', 'x1', 'x2', '["name_full"]', 90, 'high', 'pending', 1)`).run();
        sqlite.prepare(`INSERT INTO duplicate_tokens (id, adopter_id, token_type, token_value) VALUES ('t1', 'x1', 'name_full', 'carla gomez')`).run();
    });

    it('anonymous: no candidates, no token matches', async () => {
        session.user = null;
        expect(await getDuplicateCandidates('x1')).toEqual([]);
        expect(await checkTokenDuplicates({ name: 'Carla Gómez' })).toEqual([]);
    });

    it('signed-in: the profile\'s candidates', async () => {
        session.user = STRANGER;
        expect((await getDuplicateCandidates('x1')).map(c => c.otherAdopterId)).toEqual(['x2']);
        expect((await checkTokenDuplicates({ name: 'Carla Gómez' })).map(m => m.adopterId)).toContain('x1');
    });
});

describe('settled duplicate flags — neither listed nor mergeable', () => {
    beforeEach(() => {
        const m = migratedDb(); state.db = m.db; sqlite = m.sqlite as unknown as typeof sqlite;
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES
            ('m-old', 'Uno', '5', ?, 1, 1), ('m-new', 'Dos', '5', ?, 2, 2), ('m-new2', 'Tres', '5', ?, 3, 3), ('m-new3', 'Cuatro', '5', ?, 4, 4)`).run(OWNER, OWNER, OWNER, OWNER);
        sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason, target_adopter_id, details, created_at) VALUES
            ('f-open', 'm-new', ?, 'duplicate', 'm-old', NULL, 1),
            ('f-merged', 'm-new2', ?, 'duplicate', 'm-old', 'Merged into m-old by owner@example.com', 1),
            ('f-self', 'm-new3', ?, 'duplicate', 'm-new3', NULL, 1)`).run(OWNER, OWNER, OWNER);
        // The feed only looks at flags once any detected candidate exists.
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('z1', 'Z', '5', 'z@example.com', 1, 1), ('z2', 'Z', '5', 'z@example.com', 2, 2)`).run();
        sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at) VALUES ('cz', 'z1', 'z2', '["name_full"]', 90, 'high', 'pending', 1)`).run();
        session.user = OWNER;
    });

    it('the feed lists only the open flag', async () => {
        const { pairs } = await getPendingDuplicatesForUser(1, 10, true);
        expect(pairs.map(p => p.candidateId)).toEqual(['f-open']);
    });

    it('merging a merged-away or self-pointing flag is refused', async () => {
        expect(await mergePendingDedupPair('f-merged')).toMatchObject({ success: false, error: 'not_found' });
        expect(await mergePendingDedupPair('f-self')).toMatchObject({ success: false, error: 'not_found' });
    });
});
