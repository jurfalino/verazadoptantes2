/**
 * Final review C1: a fold nobody on the survivor's team agreed to must not buy
 * full contact access. A rescuer who flags a throwaway profile as a
 * "duplicate" of another rescuer's profile and merges keeping theirs gets
 * back only the contact values their own profile brought — never
 * `all_contact` — and the victim's own contacts stay masked. Consented folds
 * (accept, flip, admin) keep `all_contact` (D40). And flagging someone else's
 * profile as a duplicate is refused (C1c).
 *
 * Real SQL, real flagAdopter / mergePendingDedupPair / mergeAdopters /
 * grantAccessAfterFold / resolveAdopterVisibility; the session is the actor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { session, OWNER, MATE, STRANGER, ADMIN } = mocks;

const { state, logs } = vi.hoisted(() => ({
    state: { db: null as unknown },
    logs: { warn: [] as Array<[string, Record<string, unknown>]> },
}));

vi.mock('@/auth', () => ({ auth: vi.fn(async () => null) }));
vi.mock('./_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser, checkIsAdminAsync: mocks.isAdmin }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/config/admins', () => ({ isAdminAsync: mocks.isAdmin, isModeratorOrAdminAsync: mocks.isAdmin }));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOrgMate: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    isOwnerOrOrgMate: (v: string | null | undefined, o: string | null | undefined) => mocks.isOwnerOrOrgMate(v?.trim().toLowerCase(), o?.trim().toLowerCase()),
    getTeamEmails: async (email: string) => mocks.getOrgMemberEmailsFor((email ?? '').trim().toLowerCase()),
}));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async () => undefined) }));
vi.mock('./notifications', () => ({
    createNotification: vi.fn(async () => 'n'),
    notifyAdmins: vi.fn(async () => undefined),
    resolveDisplayName: vi.fn(async (email: string) => email.split('@')[0]),
    resolveDisplayNames: vi.fn(async (emails: string[]) => new Map(emails.map(e => [e.toLowerCase(), e.split('@')[0]]))),
}));
vi.mock('@/lib/logger', () => ({
    logger: {
        warn: vi.fn((m: string, ctx: Record<string, unknown>) => { logs.warn.push([m, ctx]); }),
        info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345'),
    },
    generateErrorId: () => 'gen12345',
}));

import { flagAdopter } from './flags';
import { flagAdopterAsDuplicate } from './flagAdopterAsDuplicate';
import { logger } from '@/lib/logger';
import { mergePendingDedupPair } from './duplicates';
import { resolveMergeRequest } from './mergeRequests';
import { resolveAdopterVisibility } from '@/lib/piiAccessServer';
import { hashEntryValue, maskContactEntries } from '@/lib/piiAccess';
import { deserializeContactEntries } from '@/lib/contactEntries';
import { unmergeAdopters } from '@/lib/adopterMerge';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };

const VICTIM_PHONE = '+54 11 4444 9999';
const VICTIM_EMAIL = 'carla.real@example.org';
const THROWAWAY_PHONE = '+54 11 5555 0001';

const entries = (...e: Array<[string, string, string]>) => JSON.stringify(e.map(([id, type, value]) => ({ id, type, value })));
const grantsOn = (id: string) => sqlite.prepare(`SELECT grantee_email AS email, scope, entry_ref AS ref, origin FROM pii_access_grants
    WHERE adopter_id = ? AND revoked_at IS NULL ORDER BY grantee_email, entry_ref`).all(id);
const flagIds = () => sqlite.prepare('SELECT id FROM adopter_flags').all().map(r => r.id as string);

/** What `viewer` sees of `adopterId`'s contact entries: value → masked? */
async function seenBy(viewer: string, adopterId: string): Promise<Record<string, boolean>> {
    const row = sqlite.prepare('SELECT added_by, contact_entries FROM adopters WHERE id = ?').get(adopterId)!;
    const vis = await resolveAdopterVisibility(viewer, { id: adopterId, addedBy: row.added_by as string });
    const original = deserializeContactEntries(row.contact_entries as string);
    const { entries: shown } = maskContactEntries(original, vis);
    return Object.fromEntries(original.map((e, i) => [e.value, !!shown[i].masked]));
}

const as = async <T>(user: string | null, fn: () => Promise<T>): Promise<T> => {
    const before = session.user;
    session.user = user;
    try { return await fn(); } finally { session.user = before; }
};

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    logs.warn.length = 0;
    // OWNER (team: MATE) registered the real Carla. STRANGER is the attacker.
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at, contact_entries) VALUES
        ('victim', 'Carla Gómez', '5', ?, 1000, 1000, ?),
        ('throwaway', 'Carla Gómez', '5', ?, 3000, 3000, ?),
        ('throwaway2', 'Carla Gómez', '5', ?, 4000, 4000, ?)`)
        .run(OWNER, entries(['t1', 'phone', VICTIM_PHONE], ['t2', 'email', VICTIM_EMAIL]),
            STRANGER, entries(['j1', 'phone', THROWAWAY_PHONE], ['j2', 'alias', 'Carlita']),
            STRANGER, entries(['k1', 'phone', THROWAWAY_PHONE]));
    sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at) VALUES
        ('cand-attack', 'throwaway2', 'victim', '["name_full"]', 60, 'medium', 'pending', 1)`).run();
    session.user = STRANGER;
});

describe('C1: keeping another rescuer\'s profile without their consent', () => {
    it('flag a throwaway as a duplicate of theirs, merge keeping theirs: no all_contact — only the throwaway\'s own entries, the victim\'s stay masked', async () => {
        const { id: flagId } = await flagAdopter('throwaway', 'duplicate', 'same person', 'victim');
        expect(await mergePendingDedupPair(flagId, { keepId: 'victim' })).toEqual({ success: true, outcome: 'merged' });

        expect(grantsOn('victim')).toEqual([
            { email: STRANGER, scope: 'entry', ref: hashEntryValue('phone', THROWAWAY_PHONE), origin: 'merge' },
        ]);
        expect(await seenBy(STRANGER, 'victim')).toEqual({
            [VICTIM_PHONE]: true,
            [VICTIM_EMAIL]: true,
            [THROWAWAY_PHONE]: false,
            Carlita: false,
        });
        // The owner team still sees everything.
        expect(Object.values(await seenBy(MATE, 'victim'))).toEqual([false, false, false, false]);
    });

    it('same on a detected pair', async () => {
        expect(await mergePendingDedupPair('cand-attack', { keepId: 'victim' })).toEqual({ success: true, outcome: 'merged' });
        expect(grantsOn('victim').map(g => g.scope)).toEqual(['entry']);
        expect((await seenBy(STRANGER, 'victim'))[VICTIM_EMAIL]).toBe(true);
    });

    it('an entry grant the absorbed owner already held is not written again', async () => {
        sqlite.prepare(`INSERT INTO pii_access_grants (id, adopter_id, grantee_email, scope, entry_ref, origin, granted_by_email, created_at)
            VALUES ('before', 'victim', ?, 'entry', ?, 'search_match', ?, 1)`).run(STRANGER, hashEntryValue('phone', THROWAWAY_PHONE), STRANGER);
        expect(await mergePendingDedupPair('cand-attack', { keepId: 'victim' })).toMatchObject({ outcome: 'merged' });
        expect(grantsOn('victim')).toEqual([expect.objectContaining({ email: STRANGER, origin: 'search_match' })]);
    });

    it("undo revokes exactly the merge's entry grants; one held before the merge stays", async () => {
        sqlite.prepare(`INSERT INTO pii_access_grants (id, adopter_id, grantee_email, scope, entry_ref, origin, granted_by_email, created_at)
            VALUES ('before', 'victim', ?, 'entry', ?, 'search_match', ?, 1)`).run(STRANGER, hashEntryValue('phone', VICTIM_PHONE), STRANGER);
        expect(await mergePendingDedupPair('cand-attack', { keepId: 'victim' })).toMatchObject({ outcome: 'merged' });
        expect(new Set(grantsOn('victim').map(g => `${g.origin}:${g.ref}`))).toEqual(new Set([
            `search_match:${hashEntryValue('phone', VICTIM_PHONE)}`,
            `merge:${hashEntryValue('phone', THROWAWAY_PHONE)}`,
        ]));
        const auditId = sqlite.prepare(`SELECT id FROM audit_log WHERE action = 'adopter_merge'`).get()!.id as string;
        expect((await unmergeAdopters(auditId, ADMIN)).success).toBe(true);
        expect(grantsOn('victim')).toEqual([expect.objectContaining({ email: STRANGER, origin: 'search_match' })]);
    });

    it('an absorbed profile with no maskable contact: nothing granted', async () => {
        sqlite.prepare(`UPDATE adopters SET contact_entries = ? WHERE id = 'throwaway2'`).run(entries(['k9', 'alias', 'Carlita']));
        expect(await mergePendingDedupPair('cand-attack', { keepId: 'victim' })).toMatchObject({ outcome: 'merged' });
        expect(grantsOn('victim')).toEqual([]);
        expect(Object.values(await seenBy(STRANGER, 'victim'))).toEqual([true, true, false]);
    });
});

describe('consented folds keep all_contact (D40)', () => {
    it("an admin keeping a rescuer's profile over their own: all_contact", async () => {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at, contact_entries) VALUES ('adm-own', 'Carla Gómez', '5', ?, 5000, 5000, ?)`)
            .run(ADMIN, entries(['a1', 'phone', THROWAWAY_PHONE]));
        sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at)
            VALUES ('cand-adm', 'adm-own', 'victim', '["name_full"]', 60, 'medium', 'pending', 1)`).run();
        expect(await as(ADMIN, () => mergePendingDedupPair('cand-adm', { keepId: 'victim' }))).toMatchObject({ outcome: 'merged' });
        expect(grantsOn('victim')).toEqual([{ email: ADMIN, scope: 'all_contact', ref: null, origin: 'merge' }]);
    });

    it('the owner accepts a request: the absorbed team gets all_contact', async () => {
        // STRANGER keeps their own → a request to OWNER, who accepts.
        expect(await mergePendingDedupPair('cand-attack', { keepId: 'throwaway2' })).toMatchObject({ outcome: 'requested' });
        const id = sqlite.prepare('SELECT id FROM merge_requests').get()!.id as string;
        expect(await as(OWNER, () => resolveMergeRequest(id, 'accept'))).toEqual({ success: true });
        expect(grantsOn('throwaway2').map(g => [g.email, g.scope])).toEqual([[MATE, 'all_contact'], [OWNER, 'all_contact']]);
    });

    it('the owner flips a request: the requester gets all_contact on the owner\'s profile', async () => {
        expect(await mergePendingDedupPair('cand-attack', { keepId: 'throwaway2' })).toMatchObject({ outcome: 'requested' });
        const id = sqlite.prepare('SELECT id FROM merge_requests').get()!.id as string;
        expect(await as(OWNER, () => resolveMergeRequest(id, 'flip'))).toEqual({ success: true });
        expect(grantsOn('victim')).toEqual([{ email: STRANGER, scope: 'all_contact', ref: null, origin: 'merge' }]);
    });
});

describe('C1c: flagging someone else\'s profile as a duplicate', () => {
    it('a stranger to the flagged profile is refused: logged at warn with an errorId, nothing written', async () => {
        await expect(flagAdopter('victim', 'duplicate', 'x', 'throwaway')).rejects.toThrow(/gen12345/);
        expect(flagIds()).toEqual([]);
        expect(logs.warn).toContainEqual(['flagAdopter: duplicate flag refused', expect.objectContaining({
            adopterId: 'victim', targetAdopterId: 'throwaway', flaggedBy: STRANGER, errorId: 'gen12345',
        })]);
    });

    it('through «Marcar como duplicados» (flagAdopterAsDuplicate): not_allowed with the errorId, not logged again as an error', async () => {
        vi.mocked(logger.error).mockClear();
        expect(await flagAdopterAsDuplicate({ currentAdopterId: 'victim', matchedAdopterId: 'throwaway', matchedAdopterName: 'Carla' }))
            .toEqual({ ok: false, error: 'not_allowed:gen12345' });
        expect(flagIds()).toEqual([]);
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('the owner, a teammate and an admin may', async () => {
        for (const user of [OWNER, MATE, ADMIN]) {
            await expect(as(user, () => flagAdopter('victim', 'duplicate', 'x', 'throwaway'))).resolves.toMatchObject({ success: true });
        }
        expect(flagIds()).toHaveLength(3);
    });

    it('other reasons are unchanged: anyone signed in may flag', async () => {
        await expect(flagAdopter('victim', 'inaccurate_information', 'wrong phone')).resolves.toMatchObject({ success: true });
        await expect(flagAdopter('victim', 'duplicate', 'no target given')).resolves.toMatchObject({ success: true });
        expect(flagIds()).toHaveLength(2);
    });
});
