/**
 * «Pendientes de revisar» (/my-adopters): each pair says who created the other
 * profile (D1, D15) and whether a merge request is open — sent by the viewer
 * (D8) or addressed to the viewer or their team (D7, D16). Real SQL, real
 * createMergeRequest / answerMergeRequest; the session is the only actor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { session, OWNER, MATE, STRANGER, ADMIN } = mocks;

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

import { getPendingDuplicatesForUser, mergePendingDedupPair, dismissDuplicateCandidate, hidePendingPair, type PendingDedupPair } from './duplicates';
import { pairKey } from '@/domain/dedupPair';
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
            id: requestId(), status: 'pending', direction: 'sent', createdAt: expect.any(Number), counterpartName: 'stranger', toAdmins: false,
            canMessage: true, declinedAt: null, declinedByName: null, keepId: 'o-old',
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
        // …but the teammate's side counts as the team's: keeping the other moves it (D25).
        expect([p.newAdopter.teamOwned, p.existingAdopter.teamOwned]).toEqual([true, false]);
        // The request's survivor is the requester's choice (the older default here).
        expect(p.request!.keepId).toBe('s-old');
        expect(pairOf((await feed(OWNER)).pairs, 'cand-older-mine').request).toMatchObject({ direction: 'received' });
        expect(pairOf((await feed(STRANGER)).pairs, 'cand-older-mine').request).toMatchObject({ direction: 'sent', counterpartName: 'Olga Dueña' });
    });

    it('no real owner: the request goes to admins, no counterpart', async () => {
        expect(await mergePendingDedupPair('cand-anon', { identity: 'same' })).toMatchObject({ success: true, outcome: 'requested' });
        const p = pairOf((await feed(STRANGER)).pairs, 'cand-anon');
        expect(p.newAdopter.createdByAnonymous).toBe(true);
        expect(p.request).toMatchObject({ direction: 'sent', toAdmins: true, counterpartName: null });
    });

    it("a declined request leaves the pair on both rescuers' lists (D27) as «Rechazado»", async () => {
        await mergePendingDedupPair('cand-older-mine');
        const id = requestId();
        expect(await as(MATE, () => resolveMergeRequest(id, 'decline'))).toEqual({ success: true });
        const sent = pairOf((await feed(STRANGER)).pairs, 'cand-older-mine');
        expect(sent.group).toBe('declined');
        // The requester reads who declined (MATE, by handle) — never an email.
        expect(sent.request).toMatchObject({ id, status: 'declined', direction: 'sent', canMessage: true, declinedByName: 'mate', declinedAt: expect.any(Number) });
        for (const who of [OWNER, MATE]) {
            const p = pairOf((await feed(who)).pairs, 'cand-older-mine');
            expect(p.group).toBe('declined');
            expect(p.request).toMatchObject({ id, status: 'declined', direction: 'received', canMessage: true, counterpartName: 'stranger' });
        }
        // Whoever declined reads no name of their own.
        expect(pairOf((await feed(MATE)).pairs, 'cand-older-mine').request!.declinedByName).toBeNull();
    });

    it('after a decline the requester may only keep the other profile (D43); the owner may still keep either', async () => {
        // STRANGER kept their older s-old and asked OWNER; OWNER declined.
        await mergePendingDedupPair('cand-older-mine');
        expect(await as(OWNER, () => resolveMergeRequest(requestId(), 'decline'))).toEqual({ success: true });
        const mine = pairOf((await feed(STRANGER)).pairs, 'cand-older-mine');
        expect(mine.keepOptions).toEqual({ new: true, existing: false }); // o-new is OWNER's
        expect(mine.mergeAction).toBe('merge');
        expect(await mergePendingDedupPair('cand-older-mine', { keepId: 's-old' })).toMatchObject({ success: false, error: 'declined_before' });
        const theirs = pairOf((await feed(OWNER)).pairs, 'cand-older-mine');
        expect(theirs.keepOptions).toEqual({ new: true, existing: true });
        expect(theirs.mergeAction).toBe('merge'); // keeping STRANGER's older profile needs no consent
        // The click agrees with the row: keeping OWNER's merges straight away.
        expect(await mergePendingDedupPair('cand-older-mine', { keepId: 'o-new' })).toEqual({ success: true, outcome: 'merged' });
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

describe('getPendingDuplicatesForUser — layout D (groups, summary, admin score, keep, identity, hide)', () => {
    /** A third pair for STRANGER (older, theirs) and OWNER: STRANGER asks, OWNER declines. */
    const declinedPair = async () => {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES
            ('d-s', 'Marta Ríos', '5', ?, 300, 300), ('d-o', 'Marta Ríos', '5', ?, 3000, 3000)`).run(STRANGER, OWNER);
        sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at)
            VALUES ('cand-decl', 'd-o', 'd-s', '["phone"]', 70, 'high', 'pending', 1)`).run();
        expect(await as(STRANGER, () => mergePendingDedupPair('cand-decl'))).toMatchObject({ success: true, outcome: 'requested' });
        const id = requestId();
        expect(await as(OWNER, () => resolveMergeRequest(id, 'decline'))).toEqual({ success: true });
        return id;
    };

    it('groups and order: received → sent → declined → possible duplicates (D21)', async () => {
        await declinedPair();
        expect(await as(STRANGER, () => mergePendingDedupPair('cand-older-mine'))).toMatchObject({ outcome: 'requested' }); // STRANGER → OWNER
        expect(await as(OWNER, () => mergePendingDedupPair('cand-newer-mine'))).toMatchObject({ outcome: 'requested' }); // OWNER → STRANGER
        const { pairs, total } = await feed(STRANGER);
        expect(pairs.map(p => [p.candidateId, p.group])).toEqual([
            ['cand-newer-mine', 'received'],
            ['cand-older-mine', 'sent'],
            ['cand-decl', 'declined'],
            ['cand-anon', 'pair'],
        ]);
        expect(total).toBe(4);
    });

    it('within the possible duplicates, the stronger match first, then detection time', async () => {
        sqlite.prepare(`UPDATE duplicate_candidates SET detected_at = 50 WHERE id = 'cand-anon'`).run();
        sqlite.prepare(`UPDATE duplicate_candidates SET score = 85 WHERE id = 'cand-older-mine'`).run();
        // cand-newer-mine 90; cand-anon and cand-older-mine 85, cand-anon detected later.
        expect((await feed(STRANGER)).pairs.map(p => p.candidateId)).toEqual(['cand-newer-mine', 'cand-anon', 'cand-older-mine']);
    });

    it('rescuers never get a score; an admin gets adminScore (D22)', async () => {
        for (const p of (await feed(STRANGER, true)).pairs) {
            expect(p.adminScore).toBeNull();
            expect(p.confidencePercent).toBeNull();
        }
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES
            ('ad-a', 'Inés Mora', '5', ?, 100, 100), ('ad-o', 'Ines Mora', '5', ?, 200, 200)`).run(ADMIN, OWNER);
        sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at)
            VALUES ('cand-admin', 'ad-o', 'ad-a', '["phone"]', 75, 'high', 'pending', 1)`).run();
        const p = pairOf((await feed(ADMIN)).pairs, 'cand-admin');
        expect(p.adminScore).toBe(75);
        expect(p.confidencePercent).toBe(75);
        expect(pairOf((await feed(OWNER)).pairs, 'cand-admin').adminScore).toBeNull();
    });

    it("an admin's choice merges straight away: both sides may be kept, «Combinar perfiles» (D24)", async () => {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES
            ('ad-a', 'Inés Mora', '5', ?, 100, 100), ('ad-o', 'Ines Mora', '5', ?, 200, 200)`).run(ADMIN, OWNER);
        sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at)
            VALUES ('cand-admin', 'ad-o', 'ad-a', '["phone"]', 75, 'high', 'pending', 1)`).run();
        // A rescuer in the admin's place would have to ask OWNER.
        const p = pairOf((await feed(ADMIN)).pairs, 'cand-admin');
        expect(p.keepOptions).toEqual({ new: true, existing: true });
        expect(p.mergeAction).toBe('merge');
        expect(await as(ADMIN, () => mergePendingDedupPair('cand-admin'))).toEqual({ success: true, outcome: 'merged' });
    });

    it('a flagged pair: no admin score (no made-up 100%), summary says flagged (D22, D34)', async () => {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES
            ('fa-a', 'Eva Sol', '5', ?, 100, 100), ('fa-o', 'Eva Sól', '5', ?, 200, 200)`).run(ADMIN, OWNER);
        sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason, target_adopter_id, details, created_at)
            VALUES ('flag-adm', 'fa-o', ?, 'duplicate', 'fa-a', NULL, 1)`).run(ADMIN);
        const p = pairOf((await feed(ADMIN)).pairs, 'flag-adm');
        expect(p.source).toBe('flagged');
        expect(p.adminScore).toBeNull();
        expect(p.summary.flagged).toBe(true);
        expect(p.identityChoice).toBe(false);
        expect(pairOf((await feed(OWNER)).pairs, 'flag-adm').summary.flagged).toBe(true);
        expect(pairOf((await feed(STRANGER)).pairs, 'cand-older-mine').summary.flagged).toBe(false);
    });

    it('a pair rebuilt from a request has no admin score (D34)', async () => {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES
            ('ra-s', 'Iris Paz', '5', ?, 50, 50), ('ra-a', 'Iris Paz', '5', ?, 60, 60)`).run(STRANGER, ADMIN);
        sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at)
            VALUES ('cand-ra', 'ra-a', 'ra-s', '["phone"]', 60, 'high', 'pending', 1)`).run();
        expect(await as(STRANGER, () => mergePendingDedupPair('cand-ra'))).toMatchObject({ outcome: 'requested' }); // asks ADMIN, as owner
        expect(pairOf((await feed(ADMIN)).pairs, 'cand-ra').adminScore).toBe(60);
        sqlite.prepare(`DELETE FROM duplicate_candidates WHERE id = 'cand-ra'`).run();
        const p = pairOf((await feed(ADMIN)).pairs, 'cand-ra');
        expect(p.request).toMatchObject({ direction: 'received', status: 'pending' });
        expect(p.adminScore).toBeNull();
    });

    it('summary: which fields line up and which differ, from what the viewer sees', async () => {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES
            ('h-s', 'Juan Pérez', '5', ?, 100, 100), ('h-o', 'María López', '5', ?, 200, 200)`).run(STRANGER, OWNER);
        sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at)
            VALUES ('cand-house', 'h-o', 'h-s', '["phone"]', 70, 'high', 'pending', 1)`).run();
        const { pairs } = await feed(STRANGER);
        expect(pairOf(pairs, 'cand-older-mine').summary).toEqual({ same: ['name', 'phone'], diff: [], flagged: false });
        expect(pairOf(pairs, 'cand-house').summary).toEqual({ same: ['phone'], diff: ['name'], flagged: false });
    });

    it('different names, same phone → «¿Es la misma persona?» (D35); same names do not ask', async () => {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES
            ('h-s', 'Juan Pérez', '5', ?, 100, 100), ('h-o', 'María López', '5', ?, 200, 200)`).run(STRANGER, OWNER);
        sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at)
            VALUES ('cand-house', 'h-o', 'h-s', '["phone"]', 70, 'high', 'pending', 1)`).run();
        const { pairs } = await feed(STRANGER);
        expect(pairOf(pairs, 'cand-house').identityChoice).toBe(true);
        expect(pairOf(pairs, 'cand-older-mine').identityChoice).toBe(false);
        // The click agrees: it asks first.
        expect(await as(STRANGER, () => mergePendingDedupPair('cand-house'))).toMatchObject({ success: false, error: 'identity_required' });
    });

    it('isMine marks the side the viewer created', async () => {
        const p = pairOf((await feed(STRANGER)).pairs, 'cand-anon');
        expect(p.newAdopter.isMine).toBe(false);
        expect(p.existingAdopter.isMine).toBe(true);
        const q = pairOf((await feed(MATE)).pairs.concat((await feed(OWNER)).pairs), 'cand-older-mine');
        expect([q.newAdopter.isMine, q.existingAdopter.isMine]).toEqual([true, false]);
    });

    it('an anonymous other side can only lose: keepOptions offers only mine (D42)', async () => {
        const p = pairOf((await feed(STRANGER)).pairs, 'cand-anon'); // anon-new is the newer side
        expect(p.keepOptions).toEqual({ new: false, existing: true });
        expect(p.mergeAction).toBe('request'); // keeping mine absorbs an ownerless profile → the admins decide
    });

    it('an anonymous OLDER side: the default keep is mine, and the button says so', async () => {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES
            ('an-old', 'Lía Gil', '5', 'anonymous', 10, 10), ('s-x', 'Lía Gil', '5', ?, 5000, 5000)`).run(STRANGER);
        sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at)
            VALUES ('cand-anon-old', 's-x', 'an-old', '["phone"]', 70, 'high', 'pending', 1)`).run();
        const p = pairOf((await feed(STRANGER)).pairs, 'cand-anon-old');
        expect(p.existingAdopter.id).toBe('an-old');
        expect(p.keepOptions).toEqual({ new: true, existing: false });
        expect(p.mergeAction).toBe('request');
        expect(await as(STRANGER, () => mergePendingDedupPair('cand-anon-old', { keepId: 's-x' }))).toMatchObject({ success: true, outcome: 'requested', toAdmins: true });
    });

    it('canMessage: a request to another rescuer, not one to the admins (D28)', async () => {
        await mergePendingDedupPair('cand-older-mine');
        await mergePendingDedupPair('cand-anon', { identity: 'same' });
        const { pairs } = await feed(STRANGER);
        expect(pairOf(pairs, 'cand-older-mine').request).toMatchObject({ canMessage: true, toAdmins: false });
        expect(pairOf(pairs, 'cand-anon').request).toMatchObject({ canMessage: false, toAdmins: true });
    });

    it('«Quitar de la lista» hides a declined pair for that viewer only (D27)', async () => {
        await declinedPair();
        const key = pairKey('d-s', 'd-o');
        expect(await as(OWNER, () => hidePendingPair(key))).toEqual({ success: true });
        expect(await as(OWNER, () => hidePendingPair(key))).toEqual({ success: true }); // twice is fine
        expect((await feed(OWNER)).pairs.map(p => p.candidateId)).not.toContain('cand-decl');
        expect((await feed(MATE)).pairs.map(p => p.candidateId)).toContain('cand-decl');
        expect((await feed(STRANGER)).pairs.map(p => p.candidateId)).toContain('cand-decl');
        // Not counted either.
        const owner = await feed(OWNER);
        expect(owner.total).toBe(owner.pairs.length);
        // Either id order names the same pair.
        expect(await as(STRANGER, () => hidePendingPair('d-s|d-o'))).toEqual({ success: true });
        expect((await feed(STRANGER)).pairs.map(p => p.candidateId)).not.toContain('cand-decl');
    });

    it('a hidden pair comes back while someone must answer a request on it', async () => {
        expect(await as(OWNER, () => hidePendingPair(pairKey('o-new', 's-old')))).toEqual({ success: true });
        expect((await feed(OWNER)).pairs.map(p => p.candidateId)).not.toContain('cand-older-mine');
        await mergePendingDedupPair('cand-older-mine'); // STRANGER asks OWNER
        expect(pairOf((await feed(OWNER)).pairs, 'cand-older-mine').group).toBe('received');
    });

    it('hidePendingPair: a session and a well-formed pair key, or a logged refusal with an errorId', async () => {
        expect(await as(null, () => hidePendingPair('a|b'))).toMatchObject({ success: false, errorId: expect.any(String) });
        for (const bad of ['', 'nopipe', 'a|a', 'a|b|c', `${'x'.repeat(300)}|y`, 42 as unknown as string]) {
            expect(await as(STRANGER, () => hidePendingPair(bad))).toMatchObject({ success: false, errorId: expect.any(String) });
        }
        expect(sqlite.prepare('SELECT COUNT(*) AS n FROM pending_pair_hidden').get()!.n).toBe(0);
        expect(logs.warn.some(([m]) => m === 'hidePendingPair: refused')).toBe(true);
    });
});

describe('getPendingDuplicatesForUser — the row and the click agree (pairChoices)', () => {
    const outcome = { merge: 'merged', request: 'requested' } as const;
    /** The row's prediction, then the click with no keepId does exactly that. */
    const agree = async (who: string, candidateId: string, expected: { actionByKeep: PendingDedupPair['actionByKeep']; defaultKeep: PendingDedupPair['defaultKeep'] }) => {
        const p = pairOf((await feed(who, true)).pairs, candidateId);
        expect({ actionByKeep: p.actionByKeep, defaultKeep: p.defaultKeep }).toEqual(expected);
        expect(p.mergeAction).toBe(p.actionByKeep[p.defaultKeep]);
        expect(p.keepOptions).toEqual({ new: p.actionByKeep.new !== null, existing: p.actionByKeep.existing !== null });
        const act = p.actionByKeep[p.defaultKeep]!;
        expect(await as(who, () => mergePendingDedupPair(candidateId))).toMatchObject({ success: true, outcome: outcome[act] });
    };

    it("same team: either side merges; default the older", async () => {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES
            ('t-own', 'Inés Mora', '5', ?, 300, 300), ('t-mate', 'Ines Mora', '5', ?, 400, 400)`).run(OWNER, MATE);
        sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at)
            VALUES ('cand-team', 't-mate', 't-own', '["phone"]', 95, 'high', 'pending', 1)`).run();
        await agree(OWNER, 'cand-team', { actionByKeep: { new: 'merge', existing: 'merge' }, defaultKeep: 'existing' });
    });

    it("another rescuer's older profile: keeping theirs merges (default), keeping mine asks", async () => {
        await agree(OWNER, 'cand-older-mine', { actionByKeep: { new: 'request', existing: 'merge' }, defaultKeep: 'existing' });
    });

    it('my older profile vs theirs: the default asks', async () => {
        await agree(OWNER, 'cand-newer-mine', { actionByKeep: { new: 'merge', existing: 'request' }, defaultKeep: 'existing' });
    });

    it('admin: both sides merge', async () => {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES
            ('ad-a', 'Inés Mora', '5', ?, 100, 100), ('ad-o', 'Ines Mora', '5', ?, 200, 200)`).run(ADMIN, OWNER);
        sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at)
            VALUES ('cand-admin', 'ad-o', 'ad-a', '["phone"]', 75, 'high', 'pending', 1)`).run();
        await agree(ADMIN, 'cand-admin', { actionByKeep: { new: 'merge', existing: 'merge' }, defaultKeep: 'existing' });
    });

    it('ownerless older side: mine is the default, and it asks the admins (D42)', async () => {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES
            ('an-old', 'Lía Gil', '5', 'anonymous', 10, 10), ('s-x', 'Lía Gil', '5', ?, 5000, 5000)`).run(STRANGER);
        sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at)
            VALUES ('cand-anon-old', 's-x', 'an-old', '["phone"]', 70, 'high', 'pending', 1)`).run();
        await agree(STRANGER, 'cand-anon-old', { actionByKeep: { new: 'request', existing: null }, defaultKeep: 'new' });
    });

    it('D43, even when the row shows a newer pending request the other way: the requester may only keep theirs', async () => {
        await mergePendingDedupPair('cand-older-mine'); // STRANGER keeps s-old, asks OWNER
        expect(await as(OWNER, () => resolveMergeRequest(requestId(), 'decline'))).toEqual({ success: true });
        // OWNER now asks the other way round: keep o-new, absorb STRANGER's s-old.
        expect(await as(OWNER, () => mergePendingDedupPair('cand-older-mine', { keepId: 'o-new' }))).toMatchObject({ outcome: 'requested' });
        const p = pairOf((await feed(STRANGER)).pairs, 'cand-older-mine');
        expect(p.request).toMatchObject({ status: 'pending', direction: 'received' });
        await agree(STRANGER, 'cand-older-mine', { actionByKeep: { new: 'merge', existing: null }, defaultKeep: 'new' });
    });

    it('a pair rebuilt from a request: nothing to choose, and the click can\'t act on it either', async () => {
        await mergePendingDedupPair('cand-older-mine');
        sqlite.prepare(`DELETE FROM duplicate_candidates WHERE id = 'cand-older-mine'`).run();
        const p = pairOf((await feed(MATE)).pairs, 'cand-older-mine');
        expect(p).toMatchObject({ actionByKeep: { new: null, existing: null }, keepOptions: { new: false, existing: false }, defaultKeep: 'existing' });
        expect(await as(OWNER, () => mergePendingDedupPair('cand-older-mine'))).toMatchObject({ success: false, error: 'not_found' });
    });
});
