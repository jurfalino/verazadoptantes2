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

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };
const mergeSpy = vi.mocked(mergeAdopters);
const deleted = (id: string) => sqlite.prepare('SELECT deleted_at FROM adopters WHERE id = ?').get(id)!.deleted_at !== null;
const request = (status: string, requester: string) => sqlite.prepare(`INSERT INTO merge_requests (id, primary_id, secondary_id, requester_email, owner_email, status, created_at)
    VALUES (?, 's-orphan', 'o-match', ?, ?, ?, 1)`).run(`r-${status}`, requester, OWNER, status);

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    mergeSpy.mockClear();
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
