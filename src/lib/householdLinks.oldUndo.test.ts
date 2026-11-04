/**
 * Undo of a merge RECORDED BEFORE households as profiles (old payload: the
 * household JSON copied onto the survivor, links and corrections moved).
 * Moved here from the retired action suite (householdLinks.test.ts, Task 8):
 * the old actions that built the starting state are gone, so the state is
 * written directly — a host listing Jonathan in its old JSON with the
 * household_links row the old add wrote. Real SQL and the real unmergeAdopters.
 * STRANGER owns the host; OWNER owns the linked profile.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { OWNER, STRANGER, ADMIN } = mocks;

const { state, notify } = vi.hoisted(() => ({
    state: { db: null as unknown },
    notify: { create: [] as Array<Record<string, unknown>>, admins: [] as Array<Record<string, unknown>> },
}));

vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/config/admins', () => ({ isAdminAsync: mocks.isAdmin, isModeratorOrAdminAsync: mocks.isAdmin }));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOrgMate: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    isOwnerOrOrgMate: (v: string | null | undefined, o: string | null | undefined) => mocks.isOwnerOrOrgMate(v?.trim().toLowerCase(), o?.trim().toLowerCase()),
}));
vi.mock('@/config/features', async (orig) => ({
    ...(await orig()),
    getFeatureFlag: vi.fn(async (flag: string) => flag === 'ENABLE_PII_ACCESS_GATING'),
}));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async (_n: string, task: () => Promise<unknown>) => { await task(); }) }));
vi.mock('@/app/actions/notifications', () => ({
    createNotification: vi.fn(async (d: Record<string, unknown>) => { notify.create.push(d); return 'n'; }),
    notifyAdmins: vi.fn(async (d: Record<string, unknown>) => { notify.admins.push(d); }),
    resolveDisplayName: vi.fn(async (email: string) => email.split('@')[0]),
}));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: (_op: string, fn: () => unknown) => fn(),
}));

import { unmergeAdopters } from '@/lib/adopterMerge';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] }; exec: (s: string) => void };
const links = () => sqlite.prepare('SELECT * FROM household_links ORDER BY id').all();
const membersOf = (id: string) => JSON.parse((sqlite.prepare(`SELECT household_members FROM adopters WHERE id = ?`).get(id)!.household_members as string) || '[]') as Array<Record<string, unknown>>;
const corrections = () => sqlite.prepare('SELECT host_adopter_id, linked_adopter_id, corrected_by FROM household_link_corrections ORDER BY created_at, rowid').all();

const MEMBER_ID = 'm-jonathan';
const MEMBER = { id: MEMBER_ID, name: 'Jonathan Urfalino', relationship: 'unknown', profileId: 'linked', addedBy: STRANGER, contactEntries: [] };
const LINK_ID = `hl-host-${MEMBER_ID}`;

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    notify.create.length = 0;
    notify.admins.length = 0;
    mocks.session.user = ADMIN;
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at, household_members) VALUES
        ('host', 'Pedro Paez', '5', ?, 1000, 1000, ?),
        ('linked', 'Jonathan Urfalino', '5', ?, 2000, 2000, NULL),
        ('host2', 'Pedro A. Paez', '5', ?, 500, 500, NULL)`)
        .run(STRANGER, JSON.stringify([MEMBER]), OWNER, STRANGER);
    // The row the old add wrote beside a member that carries a profileId.
    sqlite.prepare(`INSERT INTO household_links (id, host_adopter_id, linked_adopter_id, member_id, created_by, created_at) VALUES (?, 'host', 'linked', ?, ?, 1500)`)
        .run(LINK_ID, MEMBER_ID, STRANGER);
});

function oldShapeMerge(o: { survivorMembersAfter: unknown[]; undo: Record<string, unknown> }): string {
    const snap = sqlite.prepare(`SELECT contact_info, contact_entries, address_info, family_members, source_url, is_public FROM adopters WHERE id = 'host2'`).get()!;
    sqlite.prepare(`UPDATE adopters SET household_members = ? WHERE id = 'host2'`).run(JSON.stringify(o.survivorMembersAfter));
    sqlite.prepare(`UPDATE adopters SET deleted_at = 5000, token_hash = 'MERGED' WHERE id = 'host'`).run();
    const undo = {
        primarySnapshot: {
            contactInfo: snap.contact_info, contactEntries: snap.contact_entries, addressInfo: snap.address_info,
            familyMembers: snap.family_members, sourceUrl: snap.source_url, isPublic: snap.is_public,
        },
        placementIds: [], adopterEventIds: [], imageIds: [], flagIds: [], historyIds: [], statsIds: [], formSubmissionIds: [],
        candidates: [], annotatedFlags: [],
        ...o.undo,
    };
    sqlite.prepare(`INSERT INTO audit_log (id, user_id, user_email, action, target, details, created_at) VALUES ('audit-old', ?, ?, 'adopter_merge', 'host2', ?, 5000)`)
        .run(ADMIN, ADMIN, JSON.stringify({ primaryId: 'host2', secondaryId: 'host', secondaryName: 'Pedro Paez', mergeDetails: {}, undo }));
    return 'audit-old';
}

describe('undo of a merge recorded before households as profiles (old payload)', () => {
    it('the host merged into another profile (D51): undo takes the copied member off the survivor and puts the link back on the host', async () => {
        // A member the survivor had of its own, which that merge enriched (gift mark + a phone).
        const own = { id: 'own-ana', name: 'Ana', relationship: 'sibling', contactEntries: [{ id: 'c-own', type: 'phone', value: '+54 11 4000 0000' }] };
        const copied = { ...MEMBER, id: 'copied-1' };
        const enriched = { ...own, giftRecipient: true, contactEntries: [...own.contactEntries, { id: 'c-carried', type: 'phone', value: '+54 11 4000 1111' }] };
        sqlite.prepare(`UPDATE household_links SET host_adopter_id = 'host2', member_id = 'copied-1' WHERE id = ?`).run(LINK_ID);
        const auditId = oldShapeMerge({
            survivorMembersAfter: [enriched, copied],
            undo: {
                addedHouseholdMemberIds: ['copied-1'],
                enrichedHouseholdMembers: [{ memberId: 'own-ana', contactIds: ['c-carried'], giftRecipient: true }],
                householdLinks: [{ id: LINK_ID, hostAdopterId: 'host', linkedAdopterId: 'linked', memberId: MEMBER_ID }],
                householdLinkCorrections: [],
            },
        });

        expect((await unmergeAdopters(auditId, ADMIN)).success).toBe(true);
        expect(membersOf('host2')).toEqual([own]);
        expect(membersOf('host').map(m => m.id)).toEqual([MEMBER_ID]);
        expect(links()).toEqual([expect.objectContaining({ id: LINK_ID, host_adopter_id: 'host', linked_adopter_id: 'linked', member_id: MEMBER_ID })]);
        // Nothing was written to the new tables for an old merge.
        expect(sqlite.prepare('SELECT COUNT(*) AS n FROM household_memberships').get()!.n).toBe(0);
    });

    it('a correction that merge moved goes back; one made on the survivor afterwards stays; a link removed since is written again (I1)', async () => {
        sqlite.prepare(`INSERT INTO household_link_corrections (id, host_adopter_id, linked_adopter_id, member_id, corrected_by, created_at) VALUES ('first', 'host', 'linked', ?, ?, 1200)`).run(MEMBER_ID, OWNER);
        // The old merge moved the link and the correction onto host2…
        sqlite.prepare(`UPDATE household_links SET host_adopter_id = 'host2', member_id = 'copied-1' WHERE id = ?`).run(LINK_ID);
        sqlite.prepare(`UPDATE household_link_corrections SET host_adopter_id = 'host2' WHERE id = 'first'`).run();
        const auditId = oldShapeMerge({
            survivorMembersAfter: [{ ...MEMBER, id: 'copied-1' }],
            undo: {
                addedHouseholdMemberIds: ['copied-1'],
                householdLinks: [{ id: LINK_ID, hostAdopterId: 'host', linkedAdopterId: 'linked', memberId: MEMBER_ID }],
                householdLinkCorrections: [{ id: 'first', hostAdopterId: 'host', linkedAdopterId: 'linked' }],
            },
        });
        // …and after it the linked team said «No convive» again on the survivor.
        sqlite.prepare(`DELETE FROM household_links`).run();
        sqlite.prepare(`INSERT INTO household_link_corrections (id, host_adopter_id, linked_adopter_id, member_id, corrected_by, created_at) VALUES ('later', 'host2', 'linked', 'copied-1', ?, 9999999999)`).run(OWNER);
        const notices = { admins: notify.admins.length, create: notify.create.length };

        expect((await unmergeAdopters(auditId, ADMIN)).success).toBe(true);
        expect(corrections()).toEqual([
            expect.objectContaining({ host_adopter_id: 'host', linked_adopter_id: 'linked' }),
            expect.objectContaining({ host_adopter_id: 'host2', linked_adopter_id: 'linked' }),
        ]);
        expect(membersOf('host').map(m => m.id)).toEqual([MEMBER_ID]);
        expect(links()).toEqual([expect.objectContaining({ id: LINK_ID, host_adopter_id: 'host', linked_adopter_id: 'linked', member_id: MEMBER_ID, created_by: STRANGER })]);
        // A restore, not a new link: nobody is told.
        expect({ admins: notify.admins.length, create: notify.create.length }).toEqual(notices);
    });

    it('a second undo of the same old merge is refused', async () => {
        const auditId = oldShapeMerge({ survivorMembersAfter: [], undo: { addedHouseholdMemberIds: [], householdLinks: [], householdLinkCorrections: [] } });
        expect((await unmergeAdopters(auditId, ADMIN)).success).toBe(true);
        expect(await unmergeAdopters(auditId, ADMIN)).toMatchObject({ success: false, error: 'This merge was already undone' });
    });
});
