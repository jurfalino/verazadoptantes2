/**
 * One shared reality (D43, D49, D50): the pair verdict holds on EVERY
 * non-admin merge entry point, not only «Pendientes». A contract result
 * («Es la misma persona», attachContractToExistingAdopter) and an adoption
 * form linked to a match (linkFormToExistingAdopter) fold the rescuer's new
 * profile into the matched one with mergeAdopters — refused ('pair_disputed')
 * when an owner rejected the team's request on that pair or an admin ruled it
 * separate. Real SQL; the session is the only source of the actor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { session, OWNER, STRANGER, ADMIN } = mocks;

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));

vi.mock('./_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/config/admins', () => ({ isAdminAsync: mocks.isAdmin, isAdminAsyncStrict: mocks.isAdmin, isModeratorOrAdminAsync: mocks.isAdmin, isAdmin: (e: string) => e === ADMIN }));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOrgMate: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    isOwnerOrOrgMate: (v: string | null | undefined, o: string | null | undefined) => mocks.isOwnerOrOrgMate(v?.trim().toLowerCase(), o?.trim().toLowerCase()),
    getTeamEmails: async (email: string) => mocks.getOrgMemberEmailsFor((email ?? '').trim().toLowerCase()),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async () => undefined) }));
vi.mock('./notifications', () => ({
    createNotification: vi.fn(async () => 'n'),
    notifyAdmins: vi.fn(async () => undefined),
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

import { attachContractToExistingAdopter } from './duplicates';
import { linkFormToExistingAdopter } from './formSubmission';
import { mergeAdopters } from '@/lib/adopterMerge';
import { createNotification } from './notifications';
import { raiseMergeDispute } from './mergeDisputes';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };
const mergeSpy = vi.mocked(mergeAdopters);
const deleted = (id: string) => sqlite.prepare('SELECT deleted_at FROM adopters WHERE id = ?').get(id)!.deleted_at !== null;
const as = async <T>(user: string | null, fn: () => Promise<T>): Promise<T> => {
    const before = session.user;
    session.user = user;
    try { return await fn(); } finally { session.user = before; }
};
const request = (status: string, requester: string) => sqlite.prepare(`INSERT INTO merge_requests (id, primary_id, secondary_id, requester_email, owner_email, status, created_at)
    VALUES (?, 's-orphan', 'o-match', ?, ?, ?, 1)`).run(`r-${status}`, requester, OWNER, status);

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    mergeSpy.mockClear();
    vi.mocked(createNotification).mockClear();
    // STRANGER's new profile (from a contract / an adoption form) matched OWNER's existing one.
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES
        ('o-match', 'Carla Gómez', '5', ?, 1000, 1000), ('s-orphan', 'Carla Gomez', '5', ?, 2000, 2000)`).run(OWNER, STRANGER);
    sqlite.prepare(`INSERT INTO notifications (id, user_id, type, title, body, metadata, created_at) VALUES ('n-contract', ?, 'contract_result', 't', 'b', ?, 1)`)
        .run(STRANGER, JSON.stringify({ adopterId: 's-orphan', matchedAdopters: [{ id: 'o-match' }] }));
    sqlite.prepare(`INSERT INTO form_submissions (id, user_id, name, status, linked_adopter_id, auto_adopter_id, created_at) VALUES ('sub-1', ?, 'Carla Gomez', 'pending', 's-orphan', 's-orphan', 1)`).run(STRANGER);
    sqlite.prepare(`INSERT INTO notifications (id, user_id, type, title, body, metadata, created_at) VALUES ('n-form', ?, 'form_submission', 't', 'b', ?, 1)`)
        .run(STRANGER, JSON.stringify({ submissionId: 'sub-1', matchedAdopters: [{ id: 'o-match' }] }));
    session.user = STRANGER;
});

describe('attachContractToExistingAdopter consults the pair verdict', () => {
    it('no verdict on the pair: folds in as before', async () => {
        expect(await attachContractToExistingAdopter('n-contract', 'o-match')).toMatchObject({ success: true });
        expect(deleted('s-orphan')).toBe(true);
    });

    it('OWNER rejected my request on this pair: pair_disputed with an errorId, nothing merged', async () => {
        request('declined', STRANGER);
        expect(await attachContractToExistingAdopter('n-contract', 'o-match')).toEqual({ success: false, error: 'pair_disputed', errorId: 'gen12345' });
        expect(mergeSpy).not.toHaveBeenCalled();
        expect(deleted('s-orphan') || deleted('o-match')).toBe(false);
    });

    it('an admin ruled the pair separate (admin-declined request, an undone dispute): pair_disputed', async () => {
        request('admin_declined', 'someone@example.com');
        expect(await attachContractToExistingAdopter('n-contract', 'o-match')).toMatchObject({ success: false, error: 'pair_disputed' });
        sqlite.prepare(`DELETE FROM merge_requests`).run();
        sqlite.prepare(`INSERT INTO merge_disputes (id, audit_id, survivor_id, absorbed_id, raised_by, status) VALUES ('d1', 'a1', 'o-match', 's-orphan', ?, 'undone')`).run(OWNER);
        expect(await attachContractToExistingAdopter('n-contract', 'o-match')).toMatchObject({ success: false, error: 'pair_disputed' });
        expect(mergeSpy).not.toHaveBeenCalled();
    });
});

describe('linkFormToExistingAdopter consults the pair verdict', () => {
    it('OWNER rejected my request on this pair: pair_disputed before the form is claimed, nothing merged', async () => {
        request('declined', STRANGER);
        expect(await linkFormToExistingAdopter('sub-1', 'o-match')).toEqual({ success: false, error: 'pair_disputed', errorId: 'gen12345' });
        expect(mergeSpy).not.toHaveBeenCalled();
        expect(sqlite.prepare(`SELECT status, linked_adopter_id FROM form_submissions WHERE id = 'sub-1'`).get()).toEqual({ status: 'pending', linked_adopter_id: 's-orphan' });
        expect(deleted('s-orphan')).toBe(false);
    });

    it('an admin ruled the pair separate: pair_disputed', async () => {
        sqlite.prepare(`INSERT INTO merge_disputes (id, audit_id, survivor_id, absorbed_id, raised_by, status) VALUES ('d1', 'a1', 's-orphan', 'o-match', ?, 'undone')`).run(OWNER);
        expect(await linkFormToExistingAdopter('sub-1', 'o-match')).toMatchObject({ success: false, error: 'pair_disputed' });
        expect(mergeSpy).not.toHaveBeenCalled();
    });

    it('the rule both use (refuseDisputedMerge): an admin is never refused', async () => {
        request('declined', STRANGER);
        const { refuseDisputedMerge } = await import('@/lib/pairVerdict');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the drizzle handle under test
        expect(await refuseDisputedMerge(state.db as any, { keepId: 'o-match', absorbedId: 's-orphan', actor: ADMIN })).toBe(false);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the drizzle handle under test
        expect(await refuseDisputedMerge(state.db as any, { keepId: 'o-match', absorbedId: 's-orphan', actor: STRANGER })).toBe(true);
    });
});

/**
 * The «attached to your profile» notices land in ANOTHER rescuer's bell (the
 * matched profile's creator): their metadata names the actor, never by email.
 */
describe('attach notices never carry the actor\'s email', () => {
    const noticeOf = (type: string) => vi.mocked(createNotification).mock.calls.map(c => c[0] as { type: string; userId: string; metadata?: unknown }).find(n => n.type === type);

    it('contract_attached: to OWNER, metadata names STRANGER without an email', async () => {
        expect(await attachContractToExistingAdopter('n-contract', 'o-match')).toMatchObject({ success: true });
        const notice = noticeOf('contract_attached');
        expect(notice?.userId).toBe(OWNER);
        expect(notice?.metadata).toMatchObject({ attachedByName: 'stranger' });
        expect(JSON.stringify(notice?.metadata)).not.toContain('@');
    });

    it('form_attached: to OWNER, metadata names STRANGER without an email', async () => {
        expect(await linkFormToExistingAdopter('sub-1', 'o-match')).toMatchObject({ success: true });
        const notice = noticeOf('form_attached');
        expect(notice?.userId).toBe(OWNER);
        expect(notice?.metadata).toMatchObject({ attachedByName: 'stranger' });
        expect(JSON.stringify(notice?.metadata)).not.toContain('@');
    });
});

/**
 * Final review I2: a contract or a form linked to another rescuer's profile
 * FOLDS the actor's new profile into it — an immediate merge into someone
 * else's profile. Its notice leads to «¿No es la misma persona?» (D50) like
 * every other such merge, and the owner can actually raise it.
 */
describe('fold notices lead to the merge dispute (I2)', () => {
    type Notice = { type: string; userId: string; url: string; body: string; metadata?: Record<string, unknown> };
    const noticeOf = (type: string) => vi.mocked(createNotification).mock.calls.map(c => c[0] as unknown as Notice).find(n => n.type === type)!;
    const mergeAudit = () => sqlite.prepare(`SELECT id FROM audit_log WHERE action = 'adopter_merge' AND target = 'o-match'`).get()!.id as string;
    const disputes = () => sqlite.prepare('SELECT audit_id, raised_by, status FROM merge_disputes').all();

    it.each([
        ['contract_attached', () => attachContractToExistingAdopter('n-contract', 'o-match')],
        ['form_attached', () => linkFormToExistingAdopter('sub-1', 'o-match')],
    ] as const)('%s: the url carries ?dispute=<auditId>, the body says how; OWNER raises it', async (type, fold) => {
        expect(await fold()).toMatchObject({ success: true });
        const auditId = mergeAudit();
        const notice = noticeOf(type);
        expect(notice).toMatchObject({ userId: OWNER, url: `/adopter/o-match?dispute=${auditId}`, metadata: expect.objectContaining({ auditId }) });
        expect(notice.body).toMatch(/Avisale a un administrador desde el perfil\.$/);
        expect(await as(OWNER, () => raiseMergeDispute(auditId))).toEqual({ success: true });
        expect(disputes()).toEqual([{ audit_id: auditId, raised_by: OWNER, status: 'open' }]);
        // The rescuer who folded it in is not the one who disputes it.
        expect(await raiseMergeDispute(auditId)).toMatchObject({ success: false, error: 'not_found' });
    });

    it('a form linked without a merge (no profile of its own to fold): no dispute link', async () => {
        sqlite.prepare(`UPDATE form_submissions SET linked_adopter_id = NULL, auto_adopter_id = NULL WHERE id = 'sub-1'`).run();
        expect(await linkFormToExistingAdopter('sub-1', 'o-match')).toMatchObject({ success: true });
        expect(mergeSpy).not.toHaveBeenCalled();
        const notice = noticeOf('form_attached');
        expect(notice.url).toBe('/adopter/o-match');
        expect(notice.body).not.toContain('administrador');
    });
});
