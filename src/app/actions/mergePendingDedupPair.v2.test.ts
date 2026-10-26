/**
 * «Pendientes de revisar» v2 (spec 2026-10-25-pendientes-d): the rescuer
 * chooses which profile stays (D24), the asked owner may flip it (D26), a
 * declined requester can't re-ask (D43) nor merge one-sidedly — keeping the
 * other's profile asks the admins instead (D49) — «¿Es la misma persona?»
 * (D35), and access after a fold (D40). Real SQL, real createMergeRequest /
 * answerMergeRequest / addHouseholdMember, real mergeAdopters behind a
 * passthrough spy; the session is the only source of the actor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { session, OWNER, MATE, STRANGER, ADMIN } = mocks;

const { state, notify } = vi.hoisted(() => ({
    state: { db: null as unknown },
    notify: { create: [] as Array<Record<string, unknown>>, admins: [] as Array<Record<string, unknown>> },
}));

vi.mock('./_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/config/admins', () => ({ isAdminAsync: mocks.isAdmin, isModeratorOrAdminAsync: mocks.isAdmin }));
vi.mock('@/lib/orgMembership', async (orig) => ({
    // Normalized, like the real isOwnerOrOrgMate (`added_by` keeps any case).
    ...(await orig()), isOrgMate: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    isOwnerOrOrgMate: (v: string | null | undefined, o: string | null | undefined) => mocks.isOwnerOrOrgMate(v?.trim().toLowerCase(), o?.trim().toLowerCase()),
    getTeamEmails: async (email: string) => mocks.getOrgMemberEmailsFor((email ?? '').trim().toLowerCase()),
}));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async () => undefined) }));
vi.mock('./notifications', () => ({
    createNotification: vi.fn(async (d: Record<string, unknown>) => { notify.create.push(d); return 'n'; }),
    notifyAdmins: vi.fn(async (d: Record<string, unknown>) => { notify.admins.push(d); }),
    resolveDisplayName: vi.fn(async (email: string) => email.split('@')[0]),
    resolveDisplayNames: vi.fn(async (emails: string[]) => new Map(emails.map(e => [e.toLowerCase(), e.split('@')[0]]))),
}));
vi.mock('@/lib/adopterMerge', async (orig) => {
    const actual = await orig<typeof import('@/lib/adopterMerge')>();
    return { ...actual, mergeAdopters: vi.fn(actual.mergeAdopters) };
});
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
}));

import { mergePendingDedupPair } from './duplicates';
import { resolveMergeRequest } from './mergeRequests';
import { answerMergeRequest, createMergeRequest } from '@/lib/mergeRequests';
import { mergeAdopters } from '@/lib/adopterMerge';
import { hashEntryValue } from '@/lib/piiAccess';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };
const mergeSpy = vi.mocked(mergeAdopters);
const requests = () => sqlite.prepare('SELECT * FROM merge_requests').all();
const deleted = (id: string) => sqlite.prepare('SELECT deleted_at FROM adopters WHERE id = ?').get(id)!.deleted_at !== null;
const household = (id: string) => JSON.parse((sqlite.prepare('SELECT household_members FROM adopters WHERE id = ?').get(id)!.household_members as string | null) || '[]');
const candidate = (id: string) => sqlite.prepare('SELECT status FROM duplicate_candidates WHERE id = ?').get(id)!.status;
const grantsOn = (id: string) => sqlite.prepare(`SELECT grantee_email AS email, scope, origin FROM pii_access_grants WHERE adopter_id = ? AND revoked_at IS NULL ORDER BY grantee_email`).all(id);

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    notify.create.length = 0;
    notify.admins.length = 0;
    mergeSpy.mockClear();
    // STRANGER is "me" unless a test says otherwise. OWNER (team: MATE) is the other rescuer.
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES
        ('mine-old', 'Carla Gómez', '5', ?, 1000, 1000), ('theirs-new', 'Carla Gomez', '5', ?, 2000, 2000),
        ('mine-new', 'Ana Díaz', '5', ?, 6000, 6000), ('theirs-old', 'Ana Diaz', '5', ?, 500, 500),
        ('anon', 'Carla Gómez', '5', 'anonymous', 7000, 7000),
        ('hh-mine', 'Ana Pérez', '5', ?, 1000, 1000), ('hh-theirs', 'Lucía Pérez', '5', ?, 2000, 2000),
        ('hh-owner', 'Ana Pérez', '5', ?, 1000, 1000), ('hh-mate', 'Lucía Pérez', '5', ?, 2000, 2000),
        ('adm-mine', 'Juan Ruiz', '5', ?, 1000, 1000), ('adm-theirs', 'Juan Ruiz', '5', ?, 2000, 2000),
        ('adm-anon', 'Juan Ruiz', '5', 'anonymous', 3000, 3000)`)
        .run(STRANGER, OWNER, STRANGER, OWNER, STRANGER, OWNER, OWNER, MATE, ADMIN, OWNER);
    sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at) VALUES
        ('cand-a', 'theirs-new', 'mine-old', '["phone","name_full"]', 90, 'high', 'pending', 1),
        ('cand-b', 'mine-new', 'theirs-old', '["phone","name_full"]', 90, 'high', 'pending', 1),
        ('cand-anon', 'anon', 'mine-old', '["phone","name_full"]', 90, 'high', 'pending', 1),
        ('cand-hh', 'hh-theirs', 'hh-mine', '["phone"]', 90, 'high', 'pending', 1),
        ('cand-hh-team', 'hh-mate', 'hh-owner', '["phone"]', 90, 'high', 'pending', 1),
        ('cand-adm', 'adm-theirs', 'adm-mine', '["phone","name_full"]', 90, 'high', 'pending', 1),
        ('cand-adm-anon', 'adm-anon', 'adm-mine', '["phone","name_full"]', 90, 'high', 'pending', 1)`).run();
    session.user = STRANGER;
});

const as = async <T>(user: string | null, fn: () => Promise<T>): Promise<T> => {
    const before = session.user;
    session.user = user;
    try { return await fn(); } finally { session.user = before; }
};

describe('chosen survivor (D24)', () => {
    it("keeping the other rescuer's profile: merged now into theirs, they get adopter_merged, I and my teammate keep seeing what our profile brought", async () => {
        // OWNER is the one choosing here, so the grant covers a teammate (MATE).
        // Their profile brought one phone; STRANGER's own email stays theirs (C1).
        sqlite.prepare(`UPDATE adopters SET contact_entries = ? WHERE id = 'theirs-new'`).run(JSON.stringify([{ id: 'p1', type: 'phone', value: '+54 11 5555 0001' }]));
        sqlite.prepare(`UPDATE adopters SET contact_entries = ? WHERE id = 'mine-old'`).run(JSON.stringify([{ id: 'e1', type: 'email', value: 'carla@example.org' }]));
        const res = await as(OWNER, () => mergePendingDedupPair('cand-a', { keepId: 'mine-old' }));
        expect(res).toEqual({ success: true, outcome: 'merged' });
        expect(mergeSpy).toHaveBeenCalledWith('mine-old', 'theirs-new', OWNER);
        expect(deleted('theirs-new')).toBe(true);
        expect(requests()).toEqual([]);
        // The link opens «¿No es la misma persona?» for this merge (D50).
        expect(notify.create).toEqual([expect.objectContaining({ type: 'adopter_merged', userId: STRANGER, url: expect.stringMatching(/^\/adopter\/mine-old\?dispute=[\w-]+$/) })]);
        expect(grantsOn('mine-old')).toEqual([
            { email: MATE, scope: 'entry', origin: 'merge' },
            { email: OWNER, scope: 'entry', origin: 'merge' },
        ]);
        expect(new Set(sqlite.prepare(`SELECT entry_ref FROM pii_access_grants WHERE adopter_id = 'mine-old'`).all().map(r => r.entry_ref)))
            .toEqual(new Set([hashEntryValue('phone', '+54 11 5555 0001')]));
    });

    it('keeping mine (even the NEWER one) vs a foreign profile: a request storing my choice, no merge', async () => {
        expect(await mergePendingDedupPair('cand-b', { keepId: 'mine-new' })).toEqual({ success: true, outcome: 'requested', toName: 'owner', toAdmins: false });
        expect(mergeSpy).not.toHaveBeenCalled();
        expect(requests()).toEqual([expect.objectContaining({ primary_id: 'mine-new', secondary_id: 'theirs-old', owner_email: OWNER, status: 'pending' })]);
    });

    it("no keepId: the older side is kept (here the other rescuer's), so it merges", async () => {
        sqlite.prepare(`UPDATE adopters SET contact_entries = ? WHERE id = 'mine-new'`).run(JSON.stringify([{ id: 'p1', type: 'phone', value: '+54 11 5555 0002' }]));
        expect(await mergePendingDedupPair('cand-b')).toEqual({ success: true, outcome: 'merged' });
        expect(mergeSpy).toHaveBeenCalledWith('theirs-old', 'mine-new', STRANGER);
        expect(grantsOn('theirs-old')).toEqual([{ email: STRANGER, scope: 'entry', origin: 'merge' }]);
    });

    it('a crafted keepId (a real foreign profile, not in the pair): not_found, nothing merged or filed', async () => {
        expect(await mergePendingDedupPair('cand-a', { keepId: 'theirs-old' })).toEqual({ success: false, error: 'not_found', errorId: 'gen12345' });
        expect(mergeSpy).not.toHaveBeenCalled();
        expect(requests()).toEqual([]);
    });

    it('keeping a profile with no real owner: keep_not_allowed (D42); keeping mine asks the admins', async () => {
        expect(await mergePendingDedupPair('cand-anon', { keepId: 'anon' })).toEqual({ success: false, error: 'keep_not_allowed', errorId: 'gen12345' });
        expect(mergeSpy).not.toHaveBeenCalled();
        expect(await mergePendingDedupPair('cand-anon', { keepId: 'mine-old' })).toEqual({ success: true, outcome: 'requested', toName: null, toAdmins: true });
        expect(requests()).toEqual([expect.objectContaining({ primary_id: 'mine-old', secondary_id: 'anon', owner_email: null })]);
    });
});

describe('the owner flips a request (D26)', () => {
    it("«Conservar el mío»: the owner's profile survives, the requester gets access and a notice", async () => {
        await mergePendingDedupPair('cand-a', { keepId: 'mine-old' });
        const id = requests()[0].id as string;
        notify.create.length = 0;
        expect(await as(OWNER, () => resolveMergeRequest(id, 'flip'))).toEqual({ success: true });
        expect(mergeSpy).toHaveBeenCalledWith('theirs-new', 'mine-old', OWNER);
        expect(deleted('mine-old')).toBe(true);
        expect(deleted('theirs-new')).toBe(false);
        expect(requests()[0]).toMatchObject({ status: 'accepted', resolved_by_email: OWNER });
        expect(grantsOn('theirs-new')).toEqual([{ email: STRANGER, scope: 'all_contact', origin: 'merge' }]);
        expect(notify.create).toEqual([expect.objectContaining({ type: 'merge_request_resolved', userId: STRANGER, url: '/adopter/theirs-new' })]);
    });

    it('the requester cannot flip their own request', async () => {
        await mergePendingDedupPair('cand-a', { keepId: 'mine-old' });
        const id = requests()[0].id as string;
        expect(await resolveMergeRequest(id, 'flip')).toMatchObject({ success: false, error: 'not_allowed' });
        expect(mergeSpy).not.toHaveBeenCalled();
    });

    it('flip and an admin approval at once: one merge, the other call is not_open', async () => {
        await mergePendingDedupPair('cand-a', { keepId: 'mine-old' });
        const id = requests()[0].id as string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the drizzle handle under test
        const db = state.db as any;
        const results = await Promise.all([
            answerMergeRequest(db, id, OWNER, 'flip'),
            answerMergeRequest(db, id, ADMIN, 'accept'),
        ]);
        expect(mergeSpy).toHaveBeenCalledTimes(1);
        expect(results.filter(r => r.ok)).toHaveLength(1);
        expect(results.filter(r => !r.ok)).toEqual([{ ok: false, reason: 'not_open' }]);
    });
});

describe('after «Rechazado» (D27, D43, D49)', () => {
    let id: string;
    beforeEach(async () => {
        await mergePendingDedupPair('cand-a', { keepId: 'mine-old' });
        id = requests()[0].id as string;
        expect(await as(OWNER, () => resolveMergeRequest(id, 'decline'))).toEqual({ success: true });
        notify.create.length = 0;
    });

    it('the pair stays on the lists; asking the same owner again is declined_before, nothing filed or sent', async () => {
        expect(candidate('cand-a')).toBe('pending');
        expect(await mergePendingDedupPair('cand-a', { keepId: 'mine-old' })).toEqual({ success: false, error: 'declined_before', errorId: 'gen12345' });
        expect(requests()).toHaveLength(1);
        expect(notify.create).toEqual([]);
    });

    it("the requester keeping the other's profile no longer merges: a dispute request goes to the admins (D49)", async () => {
        notify.admins.length = 0;
        expect(await mergePendingDedupPair('cand-a', { keepId: 'theirs-new' })).toEqual({ success: true, outcome: 'disputed' });
        expect(mergeSpy).not.toHaveBeenCalled();
        expect(deleted('mine-old') || deleted('theirs-new')).toBe(false);
        expect(requests()).toEqual([
            expect.objectContaining({ id, status: 'declined', dispute: 0 }),
            expect.objectContaining({ primary_id: 'theirs-new', secondary_id: 'mine-old', requester_email: STRANGER, owner_email: null, status: 'pending', dispute: 1 }),
        ]);
        // The admins hear it as a dispute; the owner who declined is not asked again.
        expect(notify.create).toEqual([]);
        expect(notify.admins).toEqual([expect.objectContaining({
            type: 'merge_request', actorEmail: STRANGER, url: '/admin/merge-requests',
            title: 'stranger pide que un administrador revise dos perfiles',
            metadata: expect.objectContaining({ dispute: true }),
            template: expect.objectContaining({ params: expect.objectContaining({ dispute: '1' }) }),
        })]);
        // Asking again is the same open dispute: nothing new filed or sent.
        expect(await mergePendingDedupPair('cand-a', { keepId: 'theirs-new' })).toEqual({ success: true, outcome: 'disputed' });
        expect(requests()).toHaveLength(2);
        expect(notify.admins).toHaveLength(1);
    });

    it("no way around it: no keepId (the row's default), the same pair from a flag, a crafted keepId — never a merge", async () => {
        expect(await mergePendingDedupPair('cand-a')).toEqual({ success: true, outcome: 'disputed' });
        expect(await mergePendingDedupPair('cand-a', { keepId: 'mine-old' })).toMatchObject({ success: false, error: 'declined_before' });
        expect(await mergePendingDedupPair('cand-a', { keepId: 'theirs-old' })).toMatchObject({ success: false, error: 'not_found' });
        sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, target_adopter_id, reason, details, flagged_by, created_at)
            VALUES ('flag-a', 'mine-old', 'theirs-new', 'duplicate', NULL, ?, 1)`).run(STRANGER);
        expect(await mergePendingDedupPair('flag-a', { keepId: 'theirs-new' })).toEqual({ success: true, outcome: 'disputed' });
        expect(mergeSpy).not.toHaveBeenCalled();
        expect(requests().filter(r => r.dispute === 1)).toHaveLength(1);
    });

    it('the admins answer the dispute like any request to them: approve merges with the requester\'s survivor', async () => {
        await mergePendingDedupPair('cand-a', { keepId: 'theirs-new' });
        const dispute = requests().find(r => r.dispute === 1)!.id as string;
        expect(await resolveMergeRequest(dispute, 'accept')).toMatchObject({ success: false, error: 'not_allowed' });
        expect(await as(OWNER, () => resolveMergeRequest(dispute, 'accept'))).toMatchObject({ success: false, error: 'not_allowed' });
        expect(mergeSpy).not.toHaveBeenCalled();
        notify.create.length = 0;
        expect(await as(ADMIN, () => resolveMergeRequest(dispute, 'accept'))).toEqual({ success: true });
        expect(mergeSpy).toHaveBeenCalledWith('theirs-new', 'mine-old', ADMIN);
        // The requester hears the answer; the owner who rejected the pair hears that an admin merged it,
        // with the way back to the admins (D50). Never the admin.
        expect(notify.create.map(n => [n.userId, n.type]).sort()).toEqual([[OWNER, 'adopter_merged'], [STRANGER, 'merge_request_resolved']]);
        expect(notify.create.find(n => n.userId === OWNER)).toMatchObject({ url: expect.stringMatching(/^\/adopter\/theirs-new\?dispute=[\w-]+$/) });
    });

    // KNOWN (task-1-report, «Race»): two answerable requests on one pair, opposite survivors —
    // each claims only its own row, so both merge, in both directions. Flip to `it` once fixed.
    it.fails('the decliner accepting and an admin approving the dispute at once: one merge, never both directions', async () => {
        await mergePendingDedupPair('cand-a', { keepId: 'theirs-new' });
        const dispute = requests().find(r => r.dispute === 1)!.id as string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the drizzle handle under test
        const db = state.db as any;
        const results = await Promise.all([
            answerMergeRequest(db, id, OWNER, 'accept'),
            answerMergeRequest(db, dispute, ADMIN, 'accept'),
        ]);
        expect(results.filter(r => r.ok)).toHaveLength(1);
        expect([deleted('mine-old'), deleted('theirs-new')].filter(Boolean)).toHaveLength(1);
        expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'adopter_merge'`).get()!.n).toBe(1);
    });

    it('the decliner may still change their mind while the dispute is open: their accept merges, the dispute closes', async () => {
        await mergePendingDedupPair('cand-a', { keepId: 'theirs-new' });
        expect(await as(OWNER, () => resolveMergeRequest(id, 'accept'))).toEqual({ success: true });
        expect(mergeSpy).toHaveBeenCalledWith('mine-old', 'theirs-new', OWNER);
        expect(requests().find(r => r.dispute === 1)).toMatchObject({ status: 'closed' });
    });

    it('the owner changes their mind and accepts later: merged with the requester\'s survivor', async () => {
        expect(await as(OWNER, () => resolveMergeRequest(id, 'accept'))).toEqual({ success: true });
        expect(mergeSpy).toHaveBeenCalledWith('mine-old', 'theirs-new', OWNER);
        expect(deleted('theirs-new')).toBe(true);
        expect(requests()[0]).toMatchObject({ status: 'accepted' });
        expect(grantsOn('mine-old').map(g => g.email)).toEqual([MATE, OWNER]);
    });
});

describe('two answerable requests on one pair (pre-dates D49)', () => {
    // KNOWN (task-1-report, «Race»): the same hole without any dispute. OWNER declines, then
    // asks the other way round; OWNER accepting the old request and STRANGER accepting the
    // new one at once merge in both directions. Flip to `it` once fixed.
    it.fails('the decliner accepting their declined request and the requester accepting the reverse request at once: one merge', async () => {
        await mergePendingDedupPair('cand-a', { keepId: 'mine-old' });
        const declined = requests()[0].id as string;
        expect(await as(OWNER, () => resolveMergeRequest(declined, 'decline'))).toEqual({ success: true });
        expect(await as(OWNER, () => mergePendingDedupPair('cand-a', { keepId: 'theirs-new' }))).toMatchObject({ outcome: 'requested' });
        const reverse = requests().find(r => r.id !== declined)!.id as string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the drizzle handle under test
        const db = state.db as any;
        const results = await Promise.all([
            answerMergeRequest(db, declined, OWNER, 'accept'),
            answerMergeRequest(db, reverse, STRANGER, 'accept'),
        ]);
        expect(results.filter(r => r.ok)).toHaveLength(1);
        expect([deleted('mine-old'), deleted('theirs-new')].filter(Boolean)).toHaveLength(1);
    });
});

describe('«¿Es la misma persona?» (D35)', () => {
    it('different names matched on a phone: identity_required before anything happens', async () => {
        for (const keepId of ['hh-mine', 'hh-theirs']) {
            expect(await mergePendingDedupPair('cand-hh', { keepId })).toEqual({ success: false, error: 'identity_required', errorId: 'gen12345' });
        }
        expect(mergeSpy).not.toHaveBeenCalled();
        expect(requests()).toEqual([]);
    });

    it('«Sí, la misma persona»: merges as usual', async () => {
        expect(await mergePendingDedupPair('cand-hh', { keepId: 'hh-theirs', identity: 'same' })).toEqual({ success: true, outcome: 'merged' });
        expect(mergeSpy).toHaveBeenCalledWith('hh-theirs', 'hh-mine', STRANGER);
    });

    it("«alguien de su hogar»: no merge; the other person is added by name on MY profile only, linked; the pair is resolved", async () => {
        expect(await mergePendingDedupPair('cand-hh', { identity: 'household' })).toEqual({ success: true, outcome: 'household' });
        expect(mergeSpy).not.toHaveBeenCalled();
        expect(household('hh-mine')).toEqual([expect.objectContaining({
            name: 'Lucía Pérez', relationship: 'unknown', profileId: 'hh-theirs', contactEntries: [], addedBy: STRANGER,
        })]);
        expect(household('hh-theirs')).toEqual([]);
        expect(sqlite.prepare(`SELECT updated_at FROM adopters WHERE id = 'hh-theirs'`).get()!.updated_at).toBe(2000);
        expect(candidate('cand-hh')).toBe('dismissed');
        expect(requests()).toEqual([]);
        expect(deleted('hh-mine') || deleted('hh-theirs')).toBe(false);
    });

    it('«alguien de su hogar» on a pair inside my team: each side gets the other', async () => {
        expect(await as(OWNER, () => mergePendingDedupPair('cand-hh-team', { identity: 'household' }))).toEqual({ success: true, outcome: 'household' });
        expect(household('hh-owner')).toEqual([expect.objectContaining({ name: 'Lucía Pérez', profileId: 'hh-mate' })]);
        expect(household('hh-mate')).toEqual([expect.objectContaining({ name: 'Ana Pérez', profileId: 'hh-owner' })]);
    });

    it("«alguien de su hogar» on two of my profiles, one whose added_by has capitals: both get the other", async () => {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('hh-caps', 'Lucía Pérez', '5', 'Stranger@Example.com', 3000, 3000)`).run();
        sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at)
            VALUES ('cand-hh-caps', 'hh-caps', 'hh-mine', '["phone"]', 90, 'high', 'pending', 1)`).run();
        expect(await mergePendingDedupPair('cand-hh-caps', { identity: 'household' })).toEqual({ success: true, outcome: 'household' });
        expect(household('hh-mine')).toEqual([expect.objectContaining({ name: 'Lucía Pérez', profileId: 'hh-caps' })]);
        expect(household('hh-caps')).toEqual([expect.objectContaining({ name: 'Ana Pérez', profileId: 'hh-mine' })]);
    });

    it('a stranger to both sides cannot use the household path either', async () => {
        expect(await as('nobody@example.com', () => mergePendingDedupPair('cand-hh', { identity: 'household' }))).toMatchObject({ success: false, error: 'not_yours' });
        expect(household('hh-mine')).toEqual([]);
    });

    it('«alguien de su hogar» is only accepted where the question is asked (D35)', async () => {
        expect(await mergePendingDedupPair('cand-a', { identity: 'household' })).toEqual({ success: false, error: 'identity_not_applicable', errorId: 'gen12345' });
        expect(household('mine-old')).toEqual([]);
        expect(candidate('cand-a')).toBe('pending');
    });

    it("«alguien de su hogar» on a pair someone asked me about: their request becomes my decline, they are told, and can't re-ask", async () => {
        // OWNER keeps their own profile → a request asking STRANGER.
        expect(await as(OWNER, () => mergePendingDedupPair('cand-hh', { keepId: 'hh-theirs', identity: 'same' }))).toMatchObject({ outcome: 'requested' });
        notify.create.length = 0;
        expect(await mergePendingDedupPair('cand-hh', { identity: 'household' })).toEqual({ success: true, outcome: 'household' });
        expect(requests()).toEqual([expect.objectContaining({ status: 'declined', resolved_by_email: STRANGER, requester_email: OWNER })]);
        expect(notify.create).toEqual([expect.objectContaining({
            type: 'merge_request_resolved', userId: OWNER, title: 'stranger rechazó combinar dos perfiles', url: '/my-adopters#pendientes',
        })]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the drizzle handle under test
        expect(await createMergeRequest(state.db as any, {
            primaryId: 'hh-theirs', secondaryId: 'hh-mine', candidateId: null, flagId: null, requesterEmail: OWNER, ownerEmail: STRANGER,
        })).toEqual({ refused: 'declined_before' });
    });

    it('«alguien de su hogar»: my own pending request closes; an earlier decline stays a decline', async () => {
        await mergePendingDedupPair('cand-hh', { keepId: 'hh-mine', identity: 'same' });
        const first = requests()[0].id as string;
        await as(OWNER, () => resolveMergeRequest(first, 'decline'));
        // A second, still-pending request on the pair, filed by me before the decline (seeded).
        sqlite.prepare(`INSERT INTO merge_requests (id, primary_id, secondary_id, requester_email, owner_email, status, created_at)
            VALUES ('mine-pending', 'hh-mine', 'hh-theirs', ?, ?, 'pending', 1)`).run(STRANGER, OWNER);
        notify.create.length = 0;
        expect(await mergePendingDedupPair('cand-hh', { identity: 'household' })).toEqual({ success: true, outcome: 'household' });
        const status = (id: string) => sqlite.prepare('SELECT status FROM merge_requests WHERE id = ?').get(id)!.status;
        expect(status(first)).toBe('declined');
        expect(status('mine-pending')).toBe('closed');
        expect(notify.create).toEqual([]);
    });

    it('a bogus identity value is ignored (still asks)', async () => {
        expect(await mergePendingDedupPair('cand-hh', { identity: 'yes' as 'same' })).toMatchObject({ success: false, error: 'identity_required' });
    });
});

describe('admins choose freely (D24)', () => {
    it("an admin keeping their own profile vs a rescuer's: merged now (no request), the owner told, the owner team keeps access", async () => {
        expect(await as(ADMIN, () => mergePendingDedupPair('cand-adm', { keepId: 'adm-mine' }))).toEqual({ success: true, outcome: 'merged' });
        expect(mergeSpy).toHaveBeenCalledWith('adm-mine', 'adm-theirs', ADMIN);
        expect(requests()).toEqual([]);
        expect(notify.create).toEqual([expect.objectContaining({ type: 'adopter_merged', userId: OWNER, url: expect.stringMatching(/^\/adopter\/adm-mine\?dispute=[\w-]+$/) })]);
        expect(grantsOn('adm-mine').map(g => g.email)).toEqual([MATE, OWNER]);
    });

    it("the owner's added_by has capitals: the admin-merge notice goes to the normalized email, and never to the admin", async () => {
        sqlite.prepare(`UPDATE adopters SET added_by = 'Owner@Example.com' WHERE id = 'adm-theirs'`).run();
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('adm-exact', 'Juan Ruiz', '5', ?, 900, 900)`).run(ADMIN);
        sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at)
            VALUES ('cand-adm-caps', 'adm-theirs', 'adm-exact', '["phone","name_full"]', 90, 'high', 'pending', 1)`).run();
        expect(await as(ADMIN, () => mergePendingDedupPair('cand-adm-caps', { keepId: 'adm-exact' }))).toEqual({ success: true, outcome: 'merged' });
        expect(notify.create.map(n => n.userId)).toEqual([OWNER]);
    });

    it('an admin may keep a profile with no real owner', async () => {
        expect(await as(ADMIN, () => mergePendingDedupPair('cand-adm-anon', { keepId: 'adm-anon' }))).toEqual({ success: true, outcome: 'merged' });
        expect(mergeSpy).toHaveBeenCalledWith('adm-anon', 'adm-mine', ADMIN);
        expect(notify.create).toEqual([]);
    });

    it("an admin still can't use a keepId outside the pair", async () => {
        expect(await as(ADMIN, () => mergePendingDedupPair('cand-adm', { keepId: 'theirs-old' }))).toMatchObject({ success: false, error: 'not_found' });
        expect(mergeSpy).not.toHaveBeenCalled();
    });
});
