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

import { getDuplicateCandidates, getPendingDuplicatesForUser, mergePendingDedupPair, dismissDuplicateCandidate, hidePendingPair, type PendingDedupPair } from './duplicates';
import { KEPT_SEPARATE_FLAG_DETAILS_PREFIX, MERGED_FLAG_DETAILS_PREFIX, pairKey } from '@/domain/dedupPair';
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

describe('getPendingDuplicatesForUser — each side\'s own rating (point C)', () => {
    it('a rated side carries its live average (countsFor: ratings > 0 only); an unrated one null — never undefined once read', async () => {
        sqlite.prepare(`INSERT INTO animals (id, name, added_by) VALUES ('an-r1', 'Luna', ?), ('an-r2', 'Mora', ?), ('an-r3', 'Tom', ?)`).run(OWNER, OWNER, OWNER);
        sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, rating) VALUES
            ('pl-r1', 'an-r1', 'o-new', 'adoption', 2), ('pl-r2', 'an-r2', 'o-new', 'adoption', 3), ('pl-r3', 'an-r3', 'o-new', 'adoption', 0)`).run();
        const p = pairOf((await feed(OWNER)).pairs, 'cand-older-mine');
        expect(p.newAdopter.id).toBe('o-new');
        expect(p.newAdopter.rating).toBe(2.5);
        expect(p.existingAdopter.id).toBe('s-old');
        expect(p.existingAdopter.rating).toBeNull();
    });
});

describe('getPendingDuplicatesForUser — open merge requests', () => {
    it("the viewer's own request: direction 'sent', waiting on the other owner by name", async () => {
        // OWNER's o-old is older than STRANGER's s-new → a request to STRANGER.
        expect(await as(OWNER, () => mergePendingDedupPair('cand-newer-mine'))).toMatchObject({ success: true, outcome: 'requested' });
        const p = pairOf((await feed(OWNER)).pairs, 'cand-newer-mine');
        expect(p.request).toEqual({
            id: requestId(), status: 'pending', direction: 'sent', createdAt: expect.any(Number), counterpartName: 'stranger', toAdmins: false,
            dispute: false, canMessage: true, declinedAt: null, declinedByName: null, keepId: 'o-old', messages: [],
        });
        expect(p.request!.createdAt).toBeLessThan(Date.now() / 1000 + 5); // epoch seconds, not ms
        expect(p.request!.createdAt).toBeGreaterThan(Date.now() / 1000 - 60);
        // The asked owner sees it as received, from OWNER by name.
        expect(pairOf((await feed(STRANGER)).pairs, 'cand-newer-mine').request)
            .toMatchObject({ direction: 'received', counterpartName: 'Olga Dueña', toAdmins: false });
    });

    it('«Mensajes (N)»: every viewer of the pair gets the messages, oldest first, names only, theirs marked', async () => {
        expect(await as(OWNER, () => mergePendingDedupPair('cand-newer-mine'))).toMatchObject({ success: true, outcome: 'requested' });
        const rid = requestId();
        const add = sqlite.prepare(`INSERT INTO pair_messages (id, request_id, sender_email, sender_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
        add.run('m2', rid, STRANGER, null, 'Sí, coincide.', 2000);
        add.run('m1', rid, OWNER, 'Olga Dueña', 'Hola, ¿es la misma?', 1000);
        add.run('other', 'another-request', OWNER, 'Olga Dueña', 'No es de este par', 1500);
        const mine = pairOf((await feed(OWNER)).pairs, 'cand-newer-mine').request!.messages;
        expect(mine).toEqual([
            { id: 'm1', senderName: 'Olga Dueña', mine: true, body: 'Hola, ¿es la misma?', createdAt: 1000 },
            { id: 'm2', senderName: 'stranger', mine: false, body: 'Sí, coincide.', createdAt: 2000 },
        ]);
        expect(JSON.stringify(mine)).not.toContain('@');
        const theirs = pairOf((await feed(STRANGER)).pairs, 'cand-newer-mine').request!.messages;
        expect(theirs.map(m => [m.id, m.mine])).toEqual([['m1', false], ['m2', true]]);
    });

    it("a teammate of the asked owner sees the request though they created neither profile (D16)", async () => {
        // Step 2: the teammate already sees OWNER's pairs (the team acts as one)…
        expect((await feed(MATE)).total).toBe((await feed(OWNER)).total);
        await mergePendingDedupPair('cand-older-mine'); // STRANGER asks OWNER
        // …and now with the request on it, received.
        const p = pairOf((await feed(MATE)).pairs, 'cand-older-mine');
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

    it("after a decline the requester may only keep the other profile — as a dispute for the admins (D43, D49); the owner may still keep either", async () => {
        // STRANGER kept their older s-old and asked OWNER; OWNER declined.
        await mergePendingDedupPair('cand-older-mine');
        expect(await as(OWNER, () => resolveMergeRequest(requestId(), 'decline'))).toEqual({ success: true });
        const mine = pairOf((await feed(STRANGER)).pairs, 'cand-older-mine');
        expect(mine.keepOptions).toEqual({ new: true, existing: false }); // o-new is OWNER's
        expect(mine.mergeAction).toBe('dispute');
        expect(await mergePendingDedupPair('cand-older-mine', { keepId: 's-old' })).toMatchObject({ success: false, error: 'declined_before' });
        // The row and the click agree: keeping OWNER's asks the admins, and the row then shows it sent to them.
        expect(await mergePendingDedupPair('cand-older-mine', { keepId: 'o-new' })).toEqual({ success: true, outcome: 'disputed' });
        expect(pairOf((await feed(STRANGER)).pairs, 'cand-older-mine').request)
            .toMatchObject({ status: 'pending', direction: 'sent', toAdmins: true, dispute: true, counterpartName: null, canMessage: false });
        const theirs = pairOf((await feed(OWNER)).pairs, 'cand-older-mine');
        expect(theirs.keepOptions).toEqual({ new: true, existing: true });
        expect(theirs.mergeAction).toBe('merge'); // keeping STRANGER's older profile needs no consent
        // The decliner keeping STRANGER's profile is their own consent: merged straight away.
        expect(await as(OWNER, () => mergePendingDedupPair('cand-older-mine', { keepId: 's-old' }))).toEqual({ success: true, outcome: 'merged' });
    });

    it("a pair whose side is the team's applicant to evaluate is not a second to-do; after «No avanzar» it counts again (Q6)", async () => {
        const before = await feed(STRANGER);
        sqlite.prepare(`INSERT INTO form_submissions (id, user_id, name, selected_animal_id, linked_adopter_id, created_at) VALUES ('f-new', ?, 'Ana', NULL, 's-new', 1)`).run(STRANGER);
        sqlite.prepare(`INSERT INTO applications (id, submission_id, animal_id, origin, state) VALUES ('app-f-new', 'f-new', NULL, 'form', 'open')`).run();
        const during = await feed(STRANGER);
        expect(during.needsViewer).toBe(before.needsViewer - 1);
        expect(pairOf(during.pairs, 'cand-newer-mine').needsViewer).toBe(false);
        expect(pairOf(during.pairs, 'cand-anon').needsViewer).toBe(true);
        // The OTHER profile's owner has no evaluation of it: for them it is still a to-do.
        expect(pairOf((await feed(OWNER)).pairs, 'cand-newer-mine').needsViewer).toBe(true);
        sqlite.prepare(`UPDATE applications SET state = 'declined' WHERE id = 'app-f-new'`).run(); // «No avanzar»
        const after = await feed(STRANGER);
        expect(after.needsViewer).toBe(before.needsViewer);
        expect(pairOf(after.pairs, 'cand-newer-mine').needsViewer).toBe(true);
    });

    it('the home feed (needs_viewer) writes no heal on its path; /my-adopters (all) heals first (final review I4)', async () => {
        // A form whose application row is missing (submitted to the old build): only a heal writes it.
        sqlite.prepare(`INSERT INTO form_submissions (id, user_id, name, selected_animal_id, linked_adopter_id, created_at) VALUES ('f-heal', ?, 'Ana', NULL, 's-new', 1)`).run(STRANGER);
        const rows = () => Number(sqlite.prepare(`SELECT COUNT(*) AS n FROM applications WHERE submission_id = 'f-heal'`).get()!.n);
        await as(STRANGER, () => getPendingDuplicatesForUser(1, 4, false, undefined, 'needs_viewer'));
        expect(rows()).toBe(0);
        await feed(STRANGER);
        expect(rows()).toBe(1);
    });

    it('a RECEIVED merge request on a side in evaluation still counts: only a plain possible duplicate is deferred (Q6)', async () => {
        await mergePendingDedupPair('cand-older-mine'); // STRANGER asks OWNER (o-new is OWNER's)
        sqlite.prepare(`INSERT INTO form_submissions (id, user_id, name, selected_animal_id, linked_adopter_id, created_at) VALUES ('f-o', ?, 'Carla', NULL, 'o-new', 1)`).run(OWNER);
        sqlite.prepare(`INSERT INTO applications (id, submission_id, animal_id, origin, state) VALUES ('app-f-o', 'f-o', NULL, 'form', 'open')`).run();
        const pair = pairOf((await feed(OWNER)).pairs, 'cand-older-mine');
        expect(pair).toMatchObject({ group: 'received', needsViewer: true });
    });

    it('a request you sent waits on the other side: it goes after everything that waits on you (UX review 2026-11-10)', async () => {
        await mergePendingDedupPair('cand-older-mine'); // score 80, below cand-newer-mine (90) and cand-anon (85)
        const { pairs } = await feed(STRANGER);
        expect(pairs.map(p => [p.candidateId, p.needsViewer])).toEqual([['cand-newer-mine', true], ['cand-anon', true], ['cand-older-mine', false]]);
    });

    it('a low-confidence pair with a request is listed and not counted as hidden', async () => {
        expect(await feed(OWNER)).toMatchObject({ lowHidden: 1 });
        expect((await feed(OWNER)).pairs.map(p => p.candidateId)).not.toContain('cand-low');
        await mergePendingDedupPair('cand-low'); // STRANGER's s-low is older → request to OWNER
        const res = await feed(MATE);
        expect(res.pairs.map(p => p.candidateId)).toContain('cand-low');
        expect(res.lowHidden).toBe(0);
        expect((await feed(OWNER)).lowHidden).toBe(0);
    });

    it("the request's candidate row is gone: the pair still shows, built from the request", async () => {
        await mergePendingDedupPair('cand-older-mine');
        sqlite.prepare(`DELETE FROM duplicate_candidates WHERE id = 'cand-older-mine'`).run();
        const { pairs } = await feed(MATE);
        expect(pairOf(pairs, 'cand-older-mine')).toMatchObject({
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
    });

    it('a request on a flag outside the listed flags: shown while the flag is open, not once it is settled', async () => {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('f-s', 'Eva Sol', '5', ?, 100, 100), ('f-o', 'Eva Sól', '5', ?, 200, 200)`).run(STRANGER, OWNER);
        // 100 duplicate flags between other people's profiles: they used to push
        // flag-x past the feed's capped flag fetch; it now reads only flags the
        // viewer is party to (EM I4), and the request is listed either way.
        const filler = sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason, target_adopter_id, details, created_at) VALUES (?, ?, 'z@example.com', 'duplicate', ?, NULL, 1)`);
        for (let i = 0; i < 100; i++) filler.run(`filler-${i}`, `z-a-${i}`, `z-b-${i}`);
        sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason, target_adopter_id, details, created_at) VALUES ('flag-x', 'f-o', ?, 'duplicate', 'f-s', NULL, 1)`).run(STRANGER);
        expect(await mergePendingDedupPair('flag-x')).toMatchObject({ success: true, outcome: 'requested' });
        expect((await feed(STRANGER, true)).pairs.map(p => p.candidateId)).toContain('flag-x');
        expect(pairOf((await feed(MATE)).pairs, 'flag-x')).toMatchObject({ source: 'flagged', request: expect.objectContaining({ direction: 'received' }) });
        sqlite.prepare(`UPDATE adopter_flags SET details = 'Merged into f-s by x' WHERE id = 'flag-x'`).run();
        expect((await feed(MATE)).pairs.map(p => p.candidateId)).not.toContain('flag-x');
    });

    it('a rescan replaced the candidate: the request attaches to the pair, whatever its id', async () => {
        await mergePendingDedupPair('cand-older-mine');
        sqlite.prepare(`UPDATE duplicate_candidates SET id = 'cand-rescan', adopter1_id = 's-old', adopter2_id = 'o-new' WHERE id = 'cand-older-mine'`).run();
        const { pairs } = await feed(MATE);
        expect(pairs.map(p => p.candidateId)).toContain('cand-rescan');
        expect(pairs.map(p => p.candidateId)).not.toContain('cand-older-mine');
        expect(pairOf(pairs, 'cand-rescan').request).toMatchObject({ direction: 'received' });
    });

    it('a requested profile is deleted by its owner: the request closes and the pair leaves every list', async () => {
        await mergePendingDedupPair('cand-older-mine');
        const id = requestId();
        expect(await as(OWNER, () => deleteOwnAdopter('o-new'))).toEqual({ success: true });
        expect(sqlite.prepare('SELECT status FROM merge_requests WHERE id = ?').get(id)!.status).toBe('closed');
        const mate = await feed(MATE);
        expect(mate.pairs.map(p => p.candidateId)).not.toContain('cand-older-mine');
        expect(mate.total).toBe(mate.pairs.length);
        const mine = await feed(STRANGER);
        expect(mine.pairs.map(p => p.candidateId)).not.toContain('cand-older-mine');
        expect(mine.total).toBe(mine.pairs.length);
    });

    it('a request left open on a gone profile (hard or soft delete that skipped the close): total and pairs agree', async () => {
        await mergePendingDedupPair('cand-older-mine');
        sqlite.prepare(`DELETE FROM duplicate_candidates WHERE adopter1_id = 'o-new' OR adopter2_id = 'o-new'`).run();
        sqlite.prepare(`DELETE FROM adopters WHERE id = 'o-new'`).run();
        const mate = await feed(MATE);
        expect(mate.pairs.map(p => p.candidateId)).not.toContain('cand-older-mine');
        expect(mate.total).toBe(mate.pairs.length);
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

    it('a hand-filed flag answered «No, es otra persona» (D1): kept separate, off the list, never proposed again', async () => {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES
            ('fn-s', 'Marta Giménez', '5', ?, 100, 100), ('fn-o', 'Marta Gimenez', '5', ?, 200, 200)`).run(STRANGER, OWNER);
        sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason, target_adopter_id, details, created_at)
            VALUES ('flag-no', 'fn-o', ?, 'duplicate', 'fn-s', NULL, 1)`).run(OWNER);
        expect(pairOf((await feed(OWNER)).pairs, 'flag-no').source).toBe('flagged');
        // Someone who loaded neither side may not answer it.
        expect(await as('nobody@example.com', () => dismissDuplicateCandidate('flag-no'))).toMatchObject({ success: false, code: 'not_authorized' });
        expect(await as(OWNER, () => dismissDuplicateCandidate('flag-no'))).toEqual({ success: true });
        expect((sqlite.prepare(`SELECT details FROM adopter_flags WHERE id = 'flag-no'`).get() as { details: string }).details).toMatch(/^Kept separate: /);
        // The engine skips a dismissed pair: it is not proposed again.
        expect(sqlite.prepare(`SELECT status FROM duplicate_candidates WHERE (adopter1_id = 'fn-o' AND adopter2_id = 'fn-s') OR (adopter1_id = 'fn-s' AND adopter2_id = 'fn-o')`).all()).toEqual([{ status: 'dismissed' }]);
        for (const who of [OWNER, STRANGER]) {
            expect((await feed(who)).pairs.map(p => p.candidateId)).not.toContain('flag-no');
        }
        // Answered already: a second click says so.
        expect(await as(OWNER, () => dismissDuplicateCandidate('flag-no'))).toMatchObject({ success: false, code: 'already_resolved' });
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

    it('order: what waits on you first — received → your declined request → possible duplicates — then what you sent (UX review 2026-11-10)', async () => {
        await declinedPair();
        expect(await as(STRANGER, () => mergePendingDedupPair('cand-older-mine'))).toMatchObject({ outcome: 'requested' }); // STRANGER → OWNER
        expect(await as(OWNER, () => mergePendingDedupPair('cand-newer-mine'))).toMatchObject({ outcome: 'requested' }); // OWNER → STRANGER
        const { pairs, total } = await feed(STRANGER);
        expect(pairs.map(p => [p.candidateId, p.group, p.needsViewer])).toEqual([
            ['cand-newer-mine', 'received', true],
            ['cand-decl', 'declined', true],
            ['cand-anon', 'pair', true],
            ['cand-older-mine', 'sent', false],
        ]);
        // The one who declined it: it no longer waits on them — listed after.
        const owner = await feed(OWNER);
        expect(owner.pairs.find(p => p.candidateId === 'cand-decl')).toMatchObject({ group: 'declined', needsViewer: false });
        // `total` pages what waits on you (3); the sent request follows on every page.
        expect(total).toBe(3);
    });

    it('pages hold what waits on you; a request you sent follows on every page, never buried', async () => {
        await declinedPair();
        expect(await as(STRANGER, () => mergePendingDedupPair('cand-older-mine'))).toMatchObject({ outcome: 'requested' });
        const page = (n: number) => as(STRANGER, () => getPendingDuplicatesForUser(n, 1));
        const [p1, p3] = [await page(1), await page(3)];
        expect(p1.total).toBe(3); // decl, newer-mine, anon wait on STRANGER; the pager counts those
        expect(p1.pairs.map(p => p.candidateId).slice(-1)).toEqual(['cand-older-mine']);
        expect(p3.pairs.map(p => p.candidateId).slice(-1)).toEqual(['cand-older-mine']);
        // Focusing the sent request (a profile's «Revisar») opens a page that shows it.
        const focused = await as(STRANGER, () => getPendingDuplicatesForUser(1, 1, false, 'o-new|s-old'));
        expect(focused.focusCandidateId).toBe('cand-older-mine');
        expect(focused.pairs.map(p => p.candidateId)).toContain('cand-older-mine');
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
        const q = pairOf((await feed(OWNER)).pairs, 'cand-older-mine');
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
    const outcome = { merge: 'merged', request: 'requested', dispute: 'disputed' } as const;
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

    it("D43/D49, even when the row shows a newer pending request the other way: the requester may only keep theirs, as a dispute — and the click points at the open request", async () => {
        await mergePendingDedupPair('cand-older-mine'); // STRANGER keeps s-old, asks OWNER
        expect(await as(OWNER, () => resolveMergeRequest(requestId(), 'decline'))).toEqual({ success: true });
        // OWNER now asks the other way round: keep o-new, absorb STRANGER's s-old.
        expect(await as(OWNER, () => mergePendingDedupPair('cand-older-mine', { keepId: 'o-new' }))).toMatchObject({ outcome: 'requested' });
        const p = pairOf((await feed(STRANGER)).pairs, 'cand-older-mine');
        expect(p.request).toMatchObject({ status: 'pending', direction: 'received' });
        const row = pairOf((await feed(STRANGER, true)).pairs, 'cand-older-mine');
        expect({ actionByKeep: row.actionByKeep, defaultKeep: row.defaultKeep }).toEqual({ actionByKeep: { new: 'dispute', existing: null }, defaultKeep: 'new' });
        // OWNER's own request is open on the pair: STRANGER answers that one (accept) instead of filing a dispute.
        expect(await mergePendingDedupPair('cand-older-mine')).toMatchObject({ success: false, error: 'request_pending' });
    });

    it('a pair rebuilt from a request: nothing to choose, and the click can\'t act on it either', async () => {
        await mergePendingDedupPair('cand-older-mine');
        sqlite.prepare(`DELETE FROM duplicate_candidates WHERE id = 'cand-older-mine'`).run();
        const p = pairOf((await feed(MATE)).pairs, 'cand-older-mine');
        expect(p).toMatchObject({ actionByKeep: { new: null, existing: null }, keepOptions: { new: false, existing: false }, defaultKeep: 'existing' });
        expect(await as(OWNER, () => mergePendingDedupPair('cand-older-mine'))).toMatchObject({ success: false, error: 'not_found' });
    });
});

describe("a profile's «Revisar» lands on its pair", () => {
    it('the feed returns the page holding the focused pair, and its id', async () => {
        // STRANGER's list, strongest first: cand-newer-mine (90), cand-anon (85), cand-older-mine (80).
        const r = await as(STRANGER, () => getPendingDuplicatesForUser(1, 1, false, pairKey('s-old', 'o-new')));
        expect(r).toMatchObject({ page: 3, focusCandidateId: 'cand-older-mine', total: 3 });
        expect(r.pairs.map(p => p.candidateId)).toEqual(['cand-older-mine']);
    });

    it('a pair not on the list leaves the asked page as it was', async () => {
        const r = await as(STRANGER, () => getPendingDuplicatesForUser(1, 1, false, pairKey('o-low', 's-low')));
        expect(r).toMatchObject({ page: 1 });
        expect(r.focusCandidateId).toBeUndefined();
    });

    it("the banner offers «Revisar» only when the pair is on the viewer's list", async () => {
        const onList = async (user: string) =>
            (await as(user, () => getDuplicateCandidates('s-old'))).find(c => c.otherAdopterId === 'o-new')?.onViewerList;
        expect(await onList(STRANGER)).toBe(true); // created this profile
        expect(await onList(OWNER)).toBe(true); // created the other one
        expect(await onList(ADMIN)).toBe(false); // an admin who created neither: not on their list
        await as(STRANGER, () => hidePendingPair(pairKey('s-old', 'o-new')));
        expect(await onList(STRANGER)).toBe(false); // taken off their list
    });

    it('a merged-away profile is not offered as a possible duplicate', async () => {
        sqlite.prepare(`UPDATE adopters SET deleted_at = 3000 WHERE id = 'o-new'`).run();
        const others = (await as(STRANGER, () => getDuplicateCandidates('s-old'))).map(c => c.otherAdopterId);
        expect(others).not.toContain('o-new');
        expect(others).toContain('anon-new');
    });
});

describe('«Revisar» on a «posible duplicado» notice never lands on an empty Pendientes (EM I4)', () => {
    // 120 duplicate flags between other people's profiles, all newer than the viewer's.
    const flagOthers = () => {
        const adopter = sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES (?, ?, '5', 'z@example.com', 100, 100)`);
        const flag = sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason, target_adopter_id, details, created_at) VALUES (?, ?, 'z@example.com', 'duplicate', ?, NULL, ?)`);
        for (let i = 0; i < 120; i++) {
            adopter.run(`z-a-${i}`, `Zoe A ${i}`);
            adopter.run(`z-b-${i}`, `Zoe B ${i}`);
            flag.run(`z-flag-${i}`, `z-a-${i}`, `z-b-${i}`, 10_000 + i);
        }
    };

    it("the viewer's open flag is still listed, and focused, with more than 100 newer flags on other people's profiles", async () => {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('i4-mine', 'Lucía Fernández', '5', ?, 100, 100), ('i4-other', 'Lucia Fernandez', '5', ?, 200, 200)`).run(OWNER, STRANGER);
        // STRANGER flagged OWNER's profile (the notice told OWNER «Revisar»); no merge request to fall back on.
        sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason, target_adopter_id, details, created_at) VALUES ('flag-i4', 'i4-other', ?, 'duplicate', 'i4-mine', NULL, 1)`).run(STRANGER);
        flagOthers();
        expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM merge_requests`).get()!.n).toBe(0);

        const r = await as(OWNER, () => getPendingDuplicatesForUser(1, 10, true, pairKey('i4-mine', 'i4-other')));
        expect(r.focusCandidateId).toBe('flag-i4');
        expect(r.pairs.map(p => p.candidateId)).toContain('flag-i4');
        expect(pairOf(r.pairs, 'flag-i4')).toMatchObject({ source: 'flagged' });
        // The flagger (the other side's owner) sees it too.
        expect((await feed(STRANGER, true)).pairs.map(p => p.candidateId)).toContain('flag-i4');
        // Someone whose team has no profile on it and no request on it: not on their list.
        expect((await feed('outsider@example.com', true)).pairs.map(p => p.candidateId)).not.toContain('flag-i4');
    });

    it("over 100 newer SETTLED flags on the viewer's own profiles never push out an open one (review 2026-11-01)", async () => {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('s6-mine', 'Lucía Fernández', '5', ?, 100, 100), ('s6-other', 'Lucia Fernandez', '5', ?, 200, 200)`).run(OWNER, STRANGER);
        sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason, target_adopter_id, details, created_at) VALUES ('flag-s6', 's6-other', ?, 'duplicate', 's6-mine', NULL, 1)`).run(STRANGER);
        const adopter = sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES (?, ?, '5', ?, 100, 100)`);
        const flag = sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason, target_adopter_id, details, created_at) VALUES (?, ?, ?, 'duplicate', ?, ?, ?)`);
        for (let i = 0; i < 120; i++) {
            adopter.run(`s6-a-${i}`, `Ana Mía ${i}`, OWNER);
            adopter.run(`s6-b-${i}`, `Ana Otra ${i}`, STRANGER);
            const details = i % 2 === 0 ? `${MERGED_FLAG_DETAILS_PREFIX}s6-a-${i}` : `${KEPT_SEPARATE_FLAG_DETAILS_PREFIX}x`;
            flag.run(`s6-flag-${i}`, `s6-b-${i}`, STRANGER, `s6-a-${i}`, details, 10_000 + i);
        }
        const r = await as(OWNER, () => getPendingDuplicatesForUser(1, 10, true, pairKey('s6-mine', 's6-other')));
        expect(r.focusCandidateId).toBe('flag-s6');
        expect(r.pairs.map(p => p.candidateId)).not.toContain('s6-flag-0');
    });

    it('a teammate party to a request on a flagged pair keeps it, even when the request\'s own candidate was set aside', async () => {
        // Neither side is MATE's: they see the pair only through the request to their team (D16).
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('w-s', 'Eva Sol', '5', ?, 100, 100), ('w-o', 'Eva Sól', '5', ?, 200, 200)`).run(STRANGER, OWNER);
        sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at) VALUES ('cand-w', 'w-o', 'w-s', '["phone"]', 80, 'high', 'dismissed', 1)`).run();
        sqlite.prepare(`INSERT INTO merge_requests (id, primary_id, secondary_id, candidate_id, flag_id, requester_email, owner_email, status, created_at) VALUES ('mr-w', 'w-s', 'w-o', 'cand-w', NULL, ?, ?, 'pending', 5)`).run(STRANGER, OWNER);
        sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason, target_adopter_id, details, created_at) VALUES ('flag-w', 'w-s', ?, 'duplicate', 'w-o', NULL, 1)`).run(STRANGER);
        flagOthers();

        const { pairs } = await feed(MATE, true);
        expect(pairs).toContainEqual(expect.objectContaining({ candidateId: 'flag-w', source: 'flagged', request: expect.objectContaining({ id: 'mr-w', direction: 'received' }) }));
    });
});

describe('«Te escribió» lands on the pair, for the requester too (CX review I3)', () => {
    /** STRANGER asked OWNER's team about `n` pairs: requests STRANGER sent, so «No necesitan nada tuyo». */
    const sentRequests = (n: number) => {
        const adopter = sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES (?, ?, '5', ?, 100, 100)`);
        const cand = sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at) VALUES (?, ?, ?, '["phone"]', 80, 'high', 'pending', 1)`);
        const req = sqlite.prepare(`INSERT INTO merge_requests (id, primary_id, secondary_id, candidate_id, requester_email, owner_email, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`);
        for (let i = 0; i < n; i++) {
            adopter.run(`m-s-${i}`, `Sara Mía ${i}`, STRANGER);
            adopter.run(`m-o-${i}`, `Sara Mia ${i}`, OWNER);
            cand.run(`cand-m-${i}`, `m-o-${i}`, `m-s-${i}`);
            // Request 0 is the oldest: sorted last among what the requester sent.
            req.run(`mr-m-${i}`, `m-s-${i}`, `m-o-${i}`, `cand-m-${i}`, STRANGER, OWNER, i === 0 ? 1 : 1000 + i);
        }
    };

    it('the owner\'s teammate writes; the requester\'s link opens that pair, even past the 20 «No necesitan nada tuyo» rows', async () => {
        sentRequests(25);
        const { createNotification } = await import('./notifications');
        vi.mocked(createNotification).mockClear();
        const { sendPairMessage } = await import('./pairMessages');
        expect(await as(MATE, () => sendPairMessage('mr-m-0', 'Hola, ¿es la misma persona?'))).toEqual({ success: true });
        const notice = vi.mocked(createNotification).mock.calls.map(c => c[0] as { userId: string; url: string }).find(n => n.userId === STRANGER)!;
        const url = new URL(notice.url, 'https://x.test');
        expect(url.hash).toBe('#pendientes');
        const focus = url.searchParams.get('pair')!;
        expect(focus).toBe(pairKey('m-s-0', 'm-o-0'));

        // What PendingDedup asks for on that link (page 1 + ?pair=): the pair is on the page, focused (opened,
        // scrolled to, outlined), in the requester's «Enviados» — not a needs-you row.
        const r = await as(STRANGER, () => getPendingDuplicatesForUser(1, 10, false, focus));
        expect(r.focusCandidateId).toBe('cand-m-0');
        expect(pairOf(r.pairs, 'cand-m-0')).toMatchObject({ group: 'sent', needsViewer: false });
        // Without the focus, the oldest sent request is past the cap.
        expect((await feed(STRANGER)).pairs.map(p => p.candidateId)).not.toContain('cand-m-0');
    });
});

describe('step 2 — the team acts as one (Jon 2026-11-05: teammates answer both ways)', () => {
    const OUTSIDER = 'outsider@example.com';
    it("a teammate of the loader gets the loader's pairs, with the same choices", async () => {
        const mine = await feed(OWNER);
        const mate = await feed(MATE); // one at a time: `as` swaps a shared session
        const view = (r: Awaited<ReturnType<typeof feed>>) => r.pairs.map(p => [p.candidateId, p.mergeAction, p.actionByKeep]).sort();
        expect(mate.total).toBe(mine.total);
        expect(view(mate)).toEqual(view(mine));
        expect(mate.pairs.map(p => p.candidateId)).toContain('cand-older-mine');
    });

    it('a teammate settles «Mantener separados»: dismissed, by them', async () => {
        expect(await as(MATE, () => dismissDuplicateCandidate('cand-older-mine'))).toEqual({ success: true });
        expect(sqlite.prepare(`SELECT status, resolved_by AS by FROM duplicate_candidates WHERE id = 'cand-older-mine'`).get()).toEqual({ status: 'dismissed', by: MATE });
    });

    it("a teammate's «Combinar» does what the loader's would (the newer side is the team's → merged)", async () => {
        expect(await as(MATE, () => mergePendingDedupPair('cand-older-mine'))).toMatchObject({ success: true, outcome: 'merged' });
    });

    it('someone outside the team: no pairs, may not dismiss, may not merge', async () => {
        expect((await feed(OUTSIDER)).total).toBe(0);
        expect(await as(OUTSIDER, () => dismissDuplicateCandidate('cand-older-mine'))).toMatchObject({ success: false, code: 'not_authorized' });
        expect(await as(OUTSIDER, () => mergePendingDedupPair('cand-older-mine'))).toMatchObject({ success: false, error: 'not_yours' });
        expect(sqlite.prepare(`SELECT status FROM duplicate_candidates WHERE id = 'cand-older-mine'`).get()).toEqual({ status: 'pending' });
    });
});

describe('step 2 review — the feed and the bar agree on stored owners with spaces or capitals', () => {
    it("a teammate lists a pair whose loader is stored as ' Owner@Example.com '", async () => {
        sqlite.prepare(`UPDATE adopters SET added_by = ' Owner@Example.com ' WHERE id = 'o-new'`).run();
        expect((await feed(MATE)).pairs.map(p => p.candidateId)).toContain('cand-older-mine');
    });
});
