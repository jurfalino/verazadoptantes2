/**
 * «Pendientes de revisar» (/my-adopters): each pair says who created the other
 * profile (D1, D15) and whether a merge request is open — sent by the viewer
 * (D8) or addressed to the viewer or their team (D7, D16). Real SQL, real
 * createMergeRequest / answerMergeRequest; the session is the only actor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { session, OWNER, MATE, STRANGER } = mocks;

const { state, logs } = vi.hoisted(() => ({
    state: { db: null as unknown },
    logs: { warn: [] as Array<[string, Record<string, unknown>]> },
}));

vi.mock('./_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/config/admins', () => ({ isAdminAsync: mocks.isAdmin, isModeratorOrAdminAsync: mocks.isAdmin }));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOrgMate: mocks.isOrgMate, isOwnerOrOrgMate: mocks.isOwnerOrOrgMate,
    getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor, getTeamEmails: mocks.getOrgMemberEmailsFor,
}));
vi.mock('@/lib/piiAccessServer', () => ({
    resolveAdopterVisibility: async () => ({ tier: 'none', privileged: false, nothingMasked: false, hasAllContactGrant: false, unlockedEntryHashes: new Set(), unlockedNameTokenHashes: new Set() }),
}));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async () => undefined) }));
vi.mock('./notifications', () => ({
    createNotification: vi.fn(async () => 'n'),
    notifyAdmins: vi.fn(async () => undefined),
    resolveDisplayName: vi.fn(async (email: string) => email.split('@')[0]),
}));
vi.mock('@/lib/logger', () => ({
    logger: {
        warn: vi.fn((m: string, ctx: Record<string, unknown>) => { logs.warn.push([m, ctx]); }),
        info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345'),
    },
    generateErrorId: () => 'gen12345',
}));

import { getPendingDuplicatesForUser, mergePendingDedupPair, dismissDuplicateCandidate, type PendingDedupPair } from './duplicates';
import { resolveMergeRequest } from './mergeRequests';
import { deleteOwnAdopter } from './adopters';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };
const requestId = () => (sqlite.prepare(`SELECT id FROM merge_requests WHERE status = 'pending'`).get()!.id as string);

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    logs.warn.length = 0;
    // OWNER (team: MATE) has a display name; STRANGER has none (→ handle).
    sqlite.prepare(`INSERT INTO user (id, name, email) VALUES ('u-owner', 'Olga Dueña', ?)`).run(OWNER);
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES
        ('s-old', 'Carla Gómez', '5', ?, 1000, 1000), ('o-new', 'Carla Gomez', '5', ?, 2000, 2000),
        ('s-new', 'Ana Díaz', '5', ?, 6000, 6000), ('o-old', 'Ana Diaz', '5', ?, 500, 500),
        ('anon-new', 'Laura Paz', '5', 'anonymous', 7000, 7000),
        ('s-low', 'Rosa Ruiz', '5', ?, 800, 800), ('o-low', 'Rosa Ruis', '5', ?, 900, 900)`).run(STRANGER, OWNER, STRANGER, OWNER, STRANGER, OWNER);
    sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at) VALUES
        ('cand-older-mine', 'o-new', 's-old', '["phone"]', 80, 'high', 'pending', 1),
        ('cand-newer-mine', 's-new', 'o-old', '["phone"]', 90, 'high', 'pending', 1),
        ('cand-anon', 'anon-new', 's-old', '["phone"]', 85, 'high', 'pending', 1),
        ('cand-low', 'o-low', 's-low', '["name_word_fuzzy"]', 20, 'low', 'pending', 1)`).run();
    session.user = STRANGER;
});

const as = async <T>(user: string | null, fn: () => Promise<T>): Promise<T> => {
    const before = session.user;
    session.user = user;
    try { return await fn(); } finally { session.user = before; }
};

const feed = (user: string, includeLow = false) => as(user, () => getPendingDuplicatesForUser(1, 10, includeLow));
const pairOf = (pairs: PendingDedupPair[], candidateId: string) => {
    const p = pairs.find(x => x.candidateId === candidateId);
    if (!p) throw new Error(`pair ${candidateId} not in feed: ${pairs.map(x => x.candidateId).join(', ')}`);
    return p;
};

describe('getPendingDuplicatesForUser — who created the other profile', () => {
    it("the viewer's own side carries no creator; the other side shows the stranger's handle", async () => {
        const p = pairOf((await feed(OWNER)).pairs, 'cand-older-mine');
        expect(p.newAdopter).toMatchObject({ id: 'o-new', createdByName: null, createdByAnonymous: false });
        expect(p.existingAdopter).toMatchObject({ id: 's-old', createdByName: 'stranger', createdByAnonymous: false });
        expect(p.request).toBeNull();
    });

    it('a creator with a display name shows the name, not the handle', async () => {
        const p = pairOf((await feed(STRANGER)).pairs, 'cand-older-mine');
        expect(p.newAdopter).toMatchObject({ id: 'o-new', createdByName: 'Olga Dueña' });
        expect(p.existingAdopter).toMatchObject({ id: 's-old', createdByName: null });
    });

    it('an anonymous other side: no name, createdByAnonymous', async () => {
        const p = pairOf((await feed(STRANGER)).pairs, 'cand-anon');
        expect(p.newAdopter).toMatchObject({ id: 'anon-new', createdByName: null, createdByAnonymous: true });
    });
});

describe('getPendingDuplicatesForUser — open merge requests', () => {
    it("the viewer's own request: direction 'sent', waiting on the other owner by name", async () => {
        // OWNER's o-old is older than STRANGER's s-new → a request to STRANGER.
        expect(await as(OWNER, () => mergePendingDedupPair('cand-newer-mine'))).toMatchObject({ success: true, outcome: 'requested' });
        const p = pairOf((await feed(OWNER)).pairs, 'cand-newer-mine');
        expect(p.request).toEqual({
            id: requestId(), direction: 'sent', createdAt: expect.any(Number), counterpartName: 'stranger', toAdmins: false,
        });
        expect(p.request!.createdAt).toBeLessThan(Date.now() / 1000 + 5); // epoch seconds, not ms
        expect(p.request!.createdAt).toBeGreaterThan(Date.now() / 1000 - 60);
        // The asked owner sees it as received, from OWNER by name.
        expect(pairOf((await feed(STRANGER)).pairs, 'cand-newer-mine').request)
            .toMatchObject({ direction: 'received', counterpartName: 'Olga Dueña', toAdmins: false });
    });

    it("a teammate of the asked owner sees the request though they created neither profile (D16)", async () => {
        expect(await feed(MATE)).toEqual({ pairs: [], total: 0, lowHidden: 0 });
        await mergePendingDedupPair('cand-older-mine'); // STRANGER asks OWNER
        const { pairs, total } = await feed(MATE);
        expect(total).toBe(1);
        expect(pairs).toHaveLength(1);
        const [p] = pairs;
        expect(p.candidateId).toBe('cand-older-mine');
        expect(p.request).toMatchObject({ id: requestId(), direction: 'received', counterpartName: 'stranger', toAdmins: false });
        // Neither side is MATE's, so both name their creator.
        expect(p.newAdopter.createdByName).toBe('Olga Dueña');
        expect(p.existingAdopter.createdByName).toBe('stranger');
        expect(pairOf((await feed(OWNER)).pairs, 'cand-older-mine').request).toMatchObject({ direction: 'received' });
        expect(pairOf((await feed(STRANGER)).pairs, 'cand-older-mine').request).toMatchObject({ direction: 'sent', counterpartName: 'Olga Dueña' });
    });

    it('no real owner: the request goes to admins, no counterpart', async () => {
        expect(await mergePendingDedupPair('cand-anon', { identity: 'same' })).toMatchObject({ success: true, outcome: 'requested' });
        const p = pairOf((await feed(STRANGER)).pairs, 'cand-anon');
        expect(p.newAdopter.createdByAnonymous).toBe(true);
        expect(p.request).toMatchObject({ direction: 'sent', toAdmins: true, counterpartName: null });
    });

    it('a declined request leaves the pair on both rescuers\' lists (D27), no longer as an open request', async () => {
        await mergePendingDedupPair('cand-older-mine');
        expect(await as(OWNER, () => resolveMergeRequest(requestId(), 'decline'))).toEqual({ success: true });
        for (const who of [STRANGER, OWNER]) {
            expect(pairOf((await feed(who)).pairs, 'cand-older-mine').request).toBeNull();
        }
    });

    it('pairs with an open request sort first, ahead of stronger matches', async () => {
        await mergePendingDedupPair('cand-older-mine'); // score 80, below cand-newer-mine (90) and cand-anon (85)
        const ids = (await feed(STRANGER)).pairs.map(p => p.candidateId);
        expect(ids[0]).toBe('cand-older-mine');
        expect(ids.slice(1)).toEqual(['cand-newer-mine', 'cand-anon']);
    });

    it('a low-confidence pair with a request is listed and not counted as hidden', async () => {
        expect(await feed(OWNER)).toMatchObject({ lowHidden: 1 });
        expect((await feed(OWNER)).pairs.map(p => p.candidateId)).not.toContain('cand-low');
        await mergePendingDedupPair('cand-low'); // STRANGER's s-low is older → request to OWNER
        const res = await feed(MATE);
        expect(res.pairs.map(p => p.candidateId)).toEqual(['cand-low']);
        expect(res.lowHidden).toBe(0);
        expect((await feed(OWNER)).lowHidden).toBe(0);
    });

    it("the request's candidate row is gone: the pair still shows, built from the request", async () => {
        await mergePendingDedupPair('cand-older-mine');
        sqlite.prepare(`DELETE FROM duplicate_candidates WHERE id = 'cand-older-mine'`).run();
        const { pairs, total } = await feed(MATE);
        expect(total).toBe(1);
        expect(pairs[0]).toMatchObject({
            candidateId: 'cand-older-mine',
            newAdopter: { id: 'o-new' }, existingAdopter: { id: 's-old' },
            request: { direction: 'received' },
        });
    });

    it('set aside with «Mantener separados» while a request is open: the pair stays out of every list', async () => {
        await mergePendingDedupPair('cand-older-mine');
        expect(await as(OWNER, () => dismissDuplicateCandidate('cand-older-mine'))).toEqual({ success: true });
        for (const who of [STRANGER, OWNER, MATE]) {
            expect((await feed(who)).pairs.map(p => p.candidateId)).not.toContain('cand-older-mine');
        }
        expect(await feed(MATE)).toEqual({ pairs: [], total: 0, lowHidden: 0 });
    });

    it('a request on a flag outside the listed flags: shown while the flag is open, not once it is settled', async () => {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('f-s', 'Eva Sol', '5', ?, 100, 100), ('f-o', 'Eva Sól', '5', ?, 200, 200)`).run(STRANGER, OWNER);
        // 100 earlier duplicate flags between other people's profiles push
        // flag-x past the feed's capped flag fetch.
        const filler = sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason, target_adopter_id, details, created_at) VALUES (?, ?, 'z@example.com', 'duplicate', ?, NULL, 1)`);
        for (let i = 0; i < 100; i++) filler.run(`filler-${i}`, `z-a-${i}`, `z-b-${i}`);
        sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason, target_adopter_id, details, created_at) VALUES ('flag-x', 'f-o', ?, 'duplicate', 'f-s', NULL, 1)`).run(STRANGER);
        expect(await mergePendingDedupPair('flag-x')).toMatchObject({ success: true, outcome: 'requested' });
        expect((await feed(STRANGER, true)).pairs.map(p => p.candidateId)).toContain('flag-x');
        expect((await feed(MATE)).pairs).toEqual([expect.objectContaining({ candidateId: 'flag-x', source: 'flagged', request: expect.objectContaining({ direction: 'received' }) })]);
        sqlite.prepare(`UPDATE adopter_flags SET details = 'Merged into f-s by x' WHERE id = 'flag-x'`).run();
        expect(await feed(MATE)).toEqual({ pairs: [], total: 0, lowHidden: 0 });
    });

    it('a rescan replaced the candidate: the request attaches to the pair, whatever its id', async () => {
        await mergePendingDedupPair('cand-older-mine');
        sqlite.prepare(`UPDATE duplicate_candidates SET id = 'cand-rescan', adopter1_id = 's-old', adopter2_id = 'o-new' WHERE id = 'cand-older-mine'`).run();
        const { pairs } = await feed(MATE);
        expect(pairs.map(p => p.candidateId)).toEqual(['cand-rescan']);
        expect(pairs[0].request).toMatchObject({ direction: 'received' });
    });

    it('a requested profile is deleted by its owner: the request closes and the pair leaves every list', async () => {
        await mergePendingDedupPair('cand-older-mine');
        const id = requestId();
        expect(await as(OWNER, () => deleteOwnAdopter('o-new'))).toEqual({ success: true });
        expect(sqlite.prepare('SELECT status FROM merge_requests WHERE id = ?').get(id)!.status).toBe('closed');
        expect(await feed(MATE)).toEqual({ pairs: [], total: 0, lowHidden: 0 });
        const mine = await feed(STRANGER);
        expect(mine.pairs.map(p => p.candidateId)).not.toContain('cand-older-mine');
        expect(mine.total).toBe(mine.pairs.length);
    });

    it('a request left open on a gone profile (hard or soft delete that skipped the close): total and pairs agree', async () => {
        await mergePendingDedupPair('cand-older-mine');
        sqlite.prepare(`DELETE FROM duplicate_candidates WHERE adopter1_id = 'o-new' OR adopter2_id = 'o-new'`).run();
        sqlite.prepare(`DELETE FROM adopters WHERE id = 'o-new'`).run();
        expect(await feed(MATE)).toEqual({ pairs: [], total: 0, lowHidden: 0 });
        expect(sqlite.prepare(`SELECT status FROM merge_requests`).get()!.status).toBe('pending'); // the feed only reads
        sqlite.prepare('DELETE FROM merge_requests').run();

        await mergePendingDedupPair('cand-anon', { identity: 'same' }); // candidate stays pending; the side is soft-deleted
        sqlite.prepare(`UPDATE adopters SET deleted_at = 9000 WHERE id = 'anon-new'`).run();
        const res = await feed(STRANGER);
        expect(res.pairs.map(p => p.candidateId)).toEqual(['cand-newer-mine']);
        expect(res.total).toBe(1);
    });

    it("an owner whose added_by has capitals still sees the request addressed to them", async () => {
        sqlite.prepare(`UPDATE adopters SET added_by = 'Owner@Example.com' WHERE id = 'o-new'`).run();
        expect(await mergePendingDedupPair('cand-older-mine')).toMatchObject({ success: true, outcome: 'requested' });
        expect(sqlite.prepare('SELECT requester_email, owner_email FROM merge_requests').get()).toEqual({ requester_email: STRANGER, owner_email: OWNER });
        expect(pairOf((await feed(OWNER)).pairs, 'cand-older-mine').request).toMatchObject({ direction: 'received', counterpartName: 'stranger' });
        expect(pairOf((await feed(MATE)).pairs, 'cand-older-mine').request).toMatchObject({ direction: 'received' });
    });

    it('the feed never carries an email address', async () => {
        await mergePendingDedupPair('cand-older-mine');
        await mergePendingDedupPair('cand-anon', { identity: 'same' });
        for (const who of [STRANGER, OWNER, MATE]) {
            expect(JSON.stringify(await feed(who, true))).not.toContain('@');
        }
    });

    it('a failed request lookup is logged and the rest of the feed still renders', async () => {
        sqlite.prepare('DROP TABLE merge_requests').run();
        const { pairs } = await feed(STRANGER);
        expect(pairs.map(p => p.candidateId)).toEqual(['cand-newer-mine', 'cand-anon', 'cand-older-mine']);
        expect(pairs.every(p => p.request === null)).toBe(true);
        expect(logs.warn).toContainEqual(['getPendingDuplicatesForUser: merge-request fetch failed', expect.objectContaining({ actorEmail: STRANGER })]);
    });
});

describe('getPendingDuplicatesForUser — what «Combinar» will do (mergeAction)', () => {
    // Each case: the card's prediction, then the click itself agrees.
    it("viewer's older profile vs a stranger's newer → 'request' («Pedir combinar»)", async () => {
        expect(pairOf((await feed(OWNER)).pairs, 'cand-newer-mine').mergeAction).toBe('request');
        expect(await as(OWNER, () => mergePendingDedupPair('cand-newer-mine'))).toMatchObject({ success: true, outcome: 'requested' });
    });

    it("viewer's newer profile vs a stranger's older → 'merge'", async () => {
        expect(pairOf((await feed(OWNER)).pairs, 'cand-older-mine').mergeAction).toBe('merge');
        expect(await as(OWNER, () => mergePendingDedupPair('cand-older-mine'))).toEqual({ success: true, outcome: 'merged' });
    });

    it("both profiles in the viewer's team → 'merge'", async () => {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES
            ('t-own', 'Inés Mora', '5', ?, 300, 300), ('t-mate', 'Ines Mora', '5', ?, 400, 400)`).run(OWNER, MATE);
        sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at)
            VALUES ('cand-team', 't-mate', 't-own', '["phone"]', 95, 'high', 'pending', 1)`).run();
        expect(pairOf((await feed(OWNER)).pairs, 'cand-team').mergeAction).toBe('merge');
        expect(await as(OWNER, () => mergePendingDedupPair('cand-team'))).toEqual({ success: true, outcome: 'merged' });
    });

    it("a hand-filed flag across owners, keeping the other's older profile → 'merge' (D41)", async () => {
        // OWNER's fx-o (200) is newer than STRANGER's fx-s (100). The default
        // keeps the older (STRANGER's), which needs no consent, flag or not.
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES
            ('fx-s', 'Eva Sol', '5', ?, 100, 100), ('fx-o', 'Eva Sól', '5', ?, 200, 200)`).run(STRANGER, OWNER);
        sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason, target_adopter_id, details, created_at)
            VALUES ('flag-cross', 'fx-o', ?, 'duplicate', 'fx-s', NULL, 1)`).run(OWNER);
        const p = pairOf((await feed(OWNER)).pairs, 'flag-cross');
        expect(p.source).toBe('flagged');
        expect(p.mergeAction).toBe('merge');
        expect(await as(OWNER, () => mergePendingDedupPair('flag-cross'))).toEqual({ success: true, outcome: 'merged' });
    });
});
