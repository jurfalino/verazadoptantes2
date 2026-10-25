/**
 * «Combinar perfiles» → merge or ask, end to end through the browser doors
 * (mergePendingDedupPair, resolveMergeRequest, cancelMergeRequest). Real SQL,
 * real createMergeRequest / answerMergeRequest, real mergeAdopters behind a
 * passthrough spy; the session is the only source of the actor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { session, OWNER, MATE, STRANGER, ADMIN } = mocks;

const { state, notify, logs } = vi.hoisted(() => ({
    state: { db: null as unknown },
    notify: { create: [] as Array<Record<string, unknown>>, admins: [] as Array<Record<string, unknown>> },
    logs: { warn: [] as Array<[string, Record<string, unknown>]> },
}));

vi.mock('./_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/config/admins', () => ({ isAdminAsync: mocks.isAdmin, isModeratorOrAdminAsync: mocks.isAdmin }));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOrgMate: mocks.isOrgMate, isOwnerOrOrgMate: mocks.isOwnerOrOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
}));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async () => undefined) }));
vi.mock('./notifications', () => ({
    createNotification: vi.fn(async (d: Record<string, unknown>) => { notify.create.push(d); return 'n'; }),
    notifyAdmins: vi.fn(async (d: Record<string, unknown>) => { notify.admins.push(d); }),
    resolveDisplayName: vi.fn(async (email: string) => email.split('@')[0]),
}));
vi.mock('@/lib/adopterMerge', async (orig) => {
    const actual = await orig<typeof import('@/lib/adopterMerge')>();
    return { ...actual, mergeAdopters: vi.fn(actual.mergeAdopters) };
});
vi.mock('@/lib/logger', () => ({
    logger: {
        warn: vi.fn((m: string, ctx: Record<string, unknown>) => { logs.warn.push([m, ctx]); }),
        info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345'),
    },
    generateErrorId: () => 'gen12345',
}));

import { mergePendingDedupPair } from './duplicates';
import { resolveMergeRequest, cancelMergeRequest } from './mergeRequests';
import { mergeAdopters } from '@/lib/adopterMerge';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };
const mergeSpy = vi.mocked(mergeAdopters);
const requests = () => sqlite.prepare('SELECT * FROM merge_requests').all();
const adopter = (id: string) => sqlite.prepare('SELECT deleted_at, token_hash FROM adopters WHERE id = ?').get(id)!;
const recipients = () => notify.create.map(n => n.userId).sort();

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    notify.create.length = 0;
    notify.admins.length = 0;
    logs.warn.length = 0;
    mergeSpy.mockClear();
    // STRANGER is the one clicking. OWNER (team: MATE) owns the other side.
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES
        ('s-old', 'Carla Gómez', '5', ?, 1000, 1000), ('o-new', 'Carla Gomez', '5', ?, 2000, 2000),
        ('s-new', 'Ana Díaz', '5', ?, 6000, 6000), ('o-old', 'Ana Diaz', '5', ?, 500, 500),
        ('anon-new', 'Laura Paz', '5', 'anonymous', 7000, 7000)`).run(STRANGER, OWNER, STRANGER, OWNER);
    sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at) VALUES
        ('cand-older-mine', 'o-new', 's-old', '["phone"]', 90, 'high', 'pending', 1),
        ('cand-newer-mine', 's-new', 'o-old', '["phone"]', 90, 'high', 'pending', 1),
        ('cand-anon', 'anon-new', 's-old', '["phone"]', 90, 'high', 'pending', 1)`).run();
    sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason, target_adopter_id, details, created_at)
        VALUES ('flag-cross', 's-new', ?, 'duplicate', 'o-old', NULL, 1)`).run(STRANGER);
    session.user = STRANGER;
});

const as = async <T>(user: string | null, fn: () => Promise<T>): Promise<T> => {
    const before = session.user;
    session.user = user;
    try { return await fn(); } finally { session.user = before; }
};

describe('mergePendingDedupPair — merge or request', () => {
    it("my record is older, theirs newer: a request (not a merge) to the owner and teammate, never me", async () => {
        expect(await mergePendingDedupPair('cand-older-mine')).toEqual({ success: true, outcome: 'requested' });
        expect(mergeSpy).not.toHaveBeenCalled();
        expect(requests()).toEqual([expect.objectContaining({
            primary_id: 's-old', secondary_id: 'o-new', candidate_id: 'cand-older-mine', flag_id: null,
            requester_email: STRANGER, owner_email: OWNER, status: 'pending',
        })]);
        expect(recipients()).toEqual([MATE, OWNER].sort());
        expect(notify.create.every(n => n.type === 'merge_request')).toBe(true);
    });

    it('asking twice: still one request, nobody notified twice', async () => {
        await mergePendingDedupPair('cand-older-mine');
        notify.create.length = 0;
        expect(await mergePendingDedupPair('cand-older-mine')).toEqual({ success: true, outcome: 'requested' });
        expect(requests()).toHaveLength(1);
        expect(notify.create).toEqual([]);
    });

    it('the owner accepts from their session: merged for real, requester notified', async () => {
        await mergePendingDedupPair('cand-older-mine');
        const id = requests()[0].id as string;
        notify.create.length = 0;
        expect(await as(OWNER, () => resolveMergeRequest(id, 'accept'))).toEqual({ success: true });
        expect(mergeSpy).toHaveBeenCalledWith('s-old', 'o-new', OWNER);
        expect(adopter('o-new').token_hash).toBe('MERGED');
        expect(recipients()).toEqual([STRANGER]);
    });

    it('my record is newer, theirs older: merged now, the other owner gets adopter_merged', async () => {
        expect(await mergePendingDedupPair('cand-newer-mine')).toEqual({ success: true, outcome: 'merged' });
        expect(mergeSpy).toHaveBeenCalledWith('o-old', 's-new', STRANGER);
        expect(adopter('s-new').token_hash).toBe('MERGED');
        expect(requests()).toEqual([]);
        expect(notify.create).toEqual([expect.objectContaining({
            type: 'adopter_merged', userId: OWNER,
            title: 'Se unieron dos perfiles: Ana Díaz → Ana Diaz',
            body: 'stranger combinó su perfil con el tuyo porque son la misma persona. Todo quedó en tu perfil.',
            url: '/adopter/o-old', icon: '🔗',
        })]);
    });

    it('the other profile has no real owner: request with a null owner, admins notified', async () => {
        expect(await mergePendingDedupPair('cand-anon')).toEqual({ success: true, outcome: 'requested' });
        expect(requests()).toEqual([expect.objectContaining({ primary_id: 's-old', secondary_id: 'anon-new', owner_email: null })]);
        expect(notify.create).toEqual([]);
        expect(notify.admins).toEqual([expect.objectContaining({ type: 'merge_request', actorEmail: STRANGER })]);
    });

    it('a cross-rescuer flag becomes a request; declined, the flag is closed and no longer mergeable', async () => {
        expect(await mergePendingDedupPair('flag-cross')).toEqual({ success: true, outcome: 'requested' });
        const [req] = requests();
        expect(req).toMatchObject({ primary_id: 'o-old', secondary_id: 's-new', candidate_id: null, flag_id: 'flag-cross', owner_email: OWNER });
        expect(await as(OWNER, () => resolveMergeRequest(req.id as string, 'decline'))).toEqual({ success: true });
        expect((sqlite.prepare(`SELECT details FROM adopter_flags WHERE id = 'flag-cross'`).get()!.details as string)).toBe(`Kept separate: ${OWNER}`);
        expect(await mergePendingDedupPair('flag-cross')).toMatchObject({ success: false, error: 'not_found' });
        expect(mergeSpy).not.toHaveBeenCalled();
    });
});

describe('resolveMergeRequest / cancelMergeRequest — the actor is the session', () => {
    let id: string;
    beforeEach(async () => {
        await mergePendingDedupPair('cand-older-mine');
        id = requests()[0].id as string;
        notify.create.length = 0;
    });

    it('signed out: refused with an errorId, logged with the request id', async () => {
        expect(await as(null, () => resolveMergeRequest(id, 'accept'))).toEqual({ success: false, error: 'unauthenticated', errorId: 'gen12345' });
        expect(await as(null, () => cancelMergeRequest(id))).toEqual({ success: false, error: 'unauthenticated', errorId: 'gen12345' });
        expect(requests()[0].status).toBe('pending');
    });

    it('the requester cannot accept their own request; a refusal is logged with requestId, actor and reason', async () => {
        expect(await resolveMergeRequest(id, 'accept')).toEqual({ success: false, error: 'not_allowed', errorId: 'gen12345' });
        expect(logs.warn).toContainEqual(['resolveMergeRequest: refused', expect.objectContaining({ requestId: id, actor: STRANGER, reason: 'not_allowed' })]);
        expect(mergeSpy).not.toHaveBeenCalled();
    });

    it('resolve cannot be used to cancel, and only the requester can cancel', async () => {
        expect(await resolveMergeRequest(id, 'cancel' as 'accept')).toMatchObject({ success: false, error: 'invalid' });
        expect(await as(OWNER, () => cancelMergeRequest(id))).toMatchObject({ success: false, error: 'not_allowed' });
        expect(await cancelMergeRequest(id)).toEqual({ success: true });
        expect(requests()[0].status).toBe('cancelled');
    });

    it('an admin can approve; a second answer finds it no longer open', async () => {
        expect(await as(ADMIN, () => resolveMergeRequest(id, 'accept'))).toEqual({ success: true });
        expect(await as(OWNER, () => resolveMergeRequest(id, 'decline'))).toMatchObject({ success: false, error: 'not_open' });
        expect(mergeSpy).toHaveBeenCalledTimes(1);
    });

    it('unknown id: not_found', async () => {
        expect(await as(OWNER, () => resolveMergeRequest('nope', 'accept'))).toMatchObject({ success: false, error: 'not_found' });
    });
});
