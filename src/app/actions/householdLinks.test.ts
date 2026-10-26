/**
 * Linked convivientes (spec 2026-10-25 pendientes D, D44–D47). Real SQL, real
 * addHouseholdMember / removeHouseholdMember / hideHouseholdLink and the real
 * visibility resolver; the session is the only source of the actor.
 * STRANGER owns the host profile; OWNER (team: MATE) owns the linked profile.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { session, OWNER, MATE, STRANGER, ADMIN } = mocks;

const { state, notify } = vi.hoisted(() => ({
    state: { db: null as unknown },
    notify: { create: [] as Array<Record<string, unknown>> },
}));

vi.mock('./_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/config/admins', () => ({ isAdminAsync: mocks.isAdmin, isModeratorOrAdminAsync: mocks.isAdmin }));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOrgMate: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    isOwnerOrOrgMate: (v: string | null | undefined, o: string | null | undefined) => mocks.isOwnerOrOrgMate(v?.trim().toLowerCase(), o?.trim().toLowerCase()),
}));
// PII gating ON, so "a non-owner sees masked" actually tests masking.
vi.mock('@/config/features', async (orig) => ({
    ...(await orig()),
    getFeatureFlag: vi.fn(async (flag: string) => flag === 'ENABLE_PII_ACCESS_GATING'),
}));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
// Side effects run (not dropped): the notices are part of what is tested.
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async (_n: string, task: () => Promise<unknown>) => { await task(); }) }));
vi.mock('./notifications', () => ({
    createNotification: vi.fn(async (d: Record<string, unknown>) => { notify.create.push(d); return 'n'; }),
    resolveDisplayName: vi.fn(async (email: string) => email.split('@')[0]),
}));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
}));

import { addHouseholdMember, removeHouseholdMember } from './householdMembers';
import { hideHouseholdLink } from './householdLinks';
import { getLinkedSummaries, recordHouseholdLink } from '@/lib/householdLinks';
import { resolveAdopterVisibility } from '@/lib/piiAccessServer';
import { maskContactEntries } from '@/lib/piiAccess';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] }; exec: (s: string) => void };
const links = () => sqlite.prepare('SELECT * FROM household_links ORDER BY id').all();

const LINKED_CONTACTS = [
    { id: 'c1', type: 'phone', value: '+54 11 5555 0101', apps: ['whatsapp'] },
    { id: 'c2', type: 'email', value: 'jonathan@example.org' },
    { id: 'c3', type: 'other', value: 'Nota interna' },
];

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    notify.create.length = 0;
    session.user = STRANGER;
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at, contact_entries) VALUES
        ('host', 'Pedro Paez', '5', ?, 1000, 1000, ?),
        ('linked', 'Jonathan Urfalino', '5', ?, 2000, 2000, ?)`)
        .run(STRANGER, JSON.stringify([{ id: 'h1', type: 'phone', value: '+54 11 4444 0202' }]), OWNER, JSON.stringify(LINKED_CONTACTS));
    sqlite.prepare(`INSERT INTO user (id, name, email) VALUES ('u1', 'Gatitos Olivos', ?)`).run(OWNER);
    // The linked profile's history: one adoption placement (rated 2), one foster, two events, one open alert + a verification.
    sqlite.prepare(`INSERT INTO animals (id, name, added_by) VALUES ('an1', 'Luna', ?), ('an2', 'Tom', ?)`).run(OWNER, OWNER);
    sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, rating) VALUES
        ('p1', 'an1', 'linked', 'adoption', 2), ('p2', 'an2', 'linked', 'foster', NULL)`).run();
    sqlite.prepare(`INSERT INTO adopter_events (id, adopter_id, event_type, rating) VALUES
        ('e1', 'linked', 'observation', 2), ('e2', 'linked', 'adoption_request', NULL)`).run();
    sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason) VALUES
        ('f1', 'linked', ?, 'inaccurate_information'), ('f2', 'linked', ?, 'verified_identity')`).run(MATE, MATE);
});

const as = async <T>(user: string | null, fn: () => Promise<T>): Promise<T> => {
    const before = session.user;
    session.user = user;
    try { return await fn(); } finally { session.user = before; }
};

async function link(): Promise<string> {
    const res = await addHouseholdMember({ adopterId: 'host', name: 'Jonathan Urfalino', relationship: 'unknown', profileId: 'linked' });
    if (!res.ok) throw new Error(res.error);
    return res.memberId;
}

describe('write path (D44, D45)', () => {
    it('adding a member with a profile writes the link and tells the linked owner + team, not the actor', async () => {
        const memberId = await link();
        expect(links()).toEqual([expect.objectContaining({
            id: `hl-host-${memberId}`, host_adopter_id: 'host', linked_adopter_id: 'linked', member_id: memberId, created_by: STRANGER, hidden_at: null,
        })]);
        expect(notify.create.map(n => n.userId).sort()).toEqual([MATE, OWNER].sort());
        expect(notify.create.every(n => n.type === 'household_linked' && n.url === '/adopter/linked')).toBe(true);
        expect((notify.create[0].template as { key: string }).key).toBe('household_linked');
        expect(notify.create[0].body).toContain('Pedro Paez');
    });

    it('is idempotent per host member', async () => {
        const memberId = await link();
        const created = await recordHouseholdLink(state.db as never, { hostId: 'host', memberId, linkedId: 'linked', actor: STRANGER });
        expect(created).toBe(false);
        expect(links()).toHaveLength(1);
    });

    it('a member without a profile writes no link and no notice', async () => {
        await addHouseholdMember({ adopterId: 'host', name: 'Ana', relationship: 'sibling' });
        expect(links()).toEqual([]);
        expect(notify.create).toEqual([]);
    });

    it('a soft-deleted profile is refused: the member is added by name only, no link, no notice', async () => {
        sqlite.prepare(`UPDATE adopters SET deleted_at = 3000 WHERE id = 'linked'`).run();
        const res = await addHouseholdMember({ adopterId: 'host', name: 'Jonathan Urfalino', relationship: 'unknown', profileId: 'linked' });
        expect(res.ok).toBe(true);
        const members = JSON.parse(sqlite.prepare(`SELECT household_members FROM adopters WHERE id = 'host'`).get()!.household_members as string);
        expect(members).toEqual([expect.objectContaining({ name: 'Jonathan Urfalino' })]);
        expect(members[0]).not.toHaveProperty('profileId');
        expect(links()).toEqual([]);
        expect(notify.create).toEqual([]);
    });

    it('removing the member removes the link', async () => {
        const memberId = await link();
        expect(await removeHouseholdMember({ adopterId: 'host', memberId })).toEqual({ ok: true });
        expect(links()).toEqual([]);
        expect((await getLinkedSummaries(OWNER, 'linked')).livesWith).toEqual([]);
    });
});

describe('backfill (drizzle/0094)', () => {
    it('creates links from existing household members with a profileId; malformed JSON does not abort it', () => {
        sqlite.exec('DELETE FROM household_links');
        sqlite.prepare(`UPDATE adopters SET household_members = ? WHERE id = 'host'`).run(JSON.stringify([
            { id: 'm-old', name: 'Jonathan Urfalino', relationship: 'unknown', profileId: 'linked', addedBy: STRANGER },
            { id: 'm-plain', name: 'Ana', relationship: 'sibling' },
            { id: 'm-self', name: 'Pedro', profileId: 'host' },
            { id: 'm-gone', name: 'X', profileId: 'no-such-profile' },
        ]));
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, household_members) VALUES ('broken', 'B', '5', ?, '{not json'), ('obj', 'O', '5', ?, '{"a":1}'), ('mixed', 'M', '5', ?, ?)`)
            .run(STRANGER, STRANGER, STRANGER, JSON.stringify(['Juan', 7, null, [1], { id: 'm1', name: 'Jonathan Urfalino', profileId: 'linked' }]));
        const sql = readFileSync(resolve(process.cwd(), 'drizzle/0094_household_links.sql'), 'utf8').replace(/--.*$/gm, '');
        for (const stmt of sql.split(';').map(s => s.trim()).filter(Boolean)) sqlite.exec(stmt);
        // A text element («"Juan"») next to an object in the same array must not abort it.
        expect(links()).toEqual([
            expect.objectContaining({ id: 'hl-host-m-old', host_adopter_id: 'host', linked_adopter_id: 'linked', member_id: 'm-old', created_by: STRANGER }),
            expect.objectContaining({ id: 'hl-mixed-m1', host_adopter_id: 'mixed', linked_adopter_id: 'linked', member_id: 'm1', created_by: STRANGER }),
        ]);
    });
});

describe('read path (D46)', () => {
    it('host side: the member carries the linked profile summary; linked side: «Convive con» the host', async () => {
        const memberId = await link();
        const host = await getLinkedSummaries(STRANGER, 'host');
        expect(Object.keys(host.members)).toEqual([memberId]);
        const s = host.members[memberId];
        expect(s).toMatchObject({
            profileId: 'linked', name: 'Jonathan Urfalino', ownerName: 'Gatitos Olivos',
            rating: 2, openAlerts: 1, adoptions: 1, records: 2, canSeeContact: false,
        });
        expect(host.livesWith).toEqual([]);

        const linked = await getLinkedSummaries(OWNER, 'linked');
        expect(linked.members).toEqual({});
        expect(linked.livesWith).toEqual([expect.objectContaining({
            profileId: 'host', name: 'Pedro Paez', ownerName: 'stranger', creatorName: 'stranger', canHide: true,
        })]);
    });

    it("a non-owner sees the linked profile's contacts exactly as its profile masks them for them", async () => {
        const memberId = await link();
        const s = (await getLinkedSummaries(STRANGER, 'host')).members[memberId];
        const visibility = await resolveAdopterVisibility(STRANGER, { id: 'linked', addedBy: OWNER });
        expect(visibility.nothingMasked).toBe(false);
        const expected = maskContactEntries(LINKED_CONTACTS as never, visibility).entries.filter(e => e.type !== 'other');
        expect(s.contacts).toEqual(expected);
        expect(s.contacts.every(c => c.masked)).toBe(true);
        expect(s.contacts.map(c => c.value)).not.toContain('jonathan@example.org');
        expect(s.contacts.map(c => c.value)).not.toContain('+54 11 5555 0101');
    });

    it('the owner team sees their own profile in full; a viewer with an all-contact grant too', async () => {
        await link();
        // MATE viewing the host: host masked for MATE, but MATE's own side (linked) is full when viewed from linked page.
        const fromHostAsMate = await getLinkedSummaries(MATE, 'host');
        const s = Object.values(fromHostAsMate.members)[0];
        expect(s.canSeeContact).toBe(true);
        expect(s.contacts.map(c => c.value)).toEqual(['+54 11 5555 0101', 'jonathan@example.org']);
        // The reverse row shows the host as MATE may see it: masked.
        const rev = (await getLinkedSummaries(MATE, 'linked')).livesWith[0];
        expect(rev.canSeeContact).toBe(false);
        expect(rev.contacts.every(c => c.masked)).toBe(true);
        // A grant opens it, as it would on the profile.
        sqlite.prepare(`INSERT INTO pii_access_grants (id, adopter_id, grantee_email, scope, origin, granted_by_email) VALUES ('g1', 'host', ?, 'all_contact', 'request', ?)`).run(MATE, STRANGER);
        const opened = (await getLinkedSummaries(MATE, 'linked')).livesWith[0];
        expect(opened.contacts.map(c => c.value)).toEqual(['+54 11 4444 0202']);
    });

    it('no rescuer email in a non-admin payload', async () => {
        await link();
        for (const viewer of [STRANGER, OWNER, MATE]) {
            for (const id of ['host', 'linked']) {
                const json = JSON.stringify(await getLinkedSummaries(viewer, id));
                for (const email of [OWNER, MATE, STRANGER, ADMIN]) expect(json, `${viewer} on ${id}`).not.toContain(email);
            }
        }
    });

    it('a profileId planted in the JSON without a link shows no summary; a link whose member moved on shows nothing', async () => {
        sqlite.prepare(`UPDATE adopters SET household_members = ? WHERE id = 'host'`).run(JSON.stringify([{ id: 'planted', name: 'X', profileId: 'linked' }]));
        expect(await getLinkedSummaries(STRANGER, 'host')).toEqual({ members: {}, livesWith: [] });
        sqlite.prepare(`INSERT INTO household_links (id, host_adopter_id, linked_adopter_id, member_id) VALUES ('hl-x', 'host', 'linked', 'other-member')`).run();
        expect((await getLinkedSummaries(OWNER, 'linked')).livesWith).toEqual([]);
    });
});

describe('bounded reads', () => {
    it('stale link rows (older, many) cannot crowd out a live link on either side', async () => {
        const insert = sqlite.prepare(`INSERT INTO household_links (id, host_adopter_id, linked_adopter_id, member_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
        for (let i = 0; i < 25; i++) {
            insert.run(`stale-out-${i}`, 'host', 'linked', `gone-${i}`, STRANGER, 10 + i); // host member no longer exists
            sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by) VALUES (?, 'Old host', '5', ?)`).run(`old-host-${i}`, MATE);
            insert.run(`stale-in-${i}`, `old-host-${i}`, 'linked', `gone-${i}`, MATE, 10 + i); // that host never listed it
        }
        const memberId = await link(); // the one live link, newest
        expect(Object.keys((await getLinkedSummaries(STRANGER, 'host')).members)).toEqual([memberId]);
        expect((await getLinkedSummaries(OWNER, 'linked')).livesWith.map(r => r.profileId)).toEqual(['host']);
    });
});

describe('«Quitar de mi perfil» (D47)', () => {
    it('only the linked profile team or an admin can hide; then the row is gone for everyone and the host owner is told', async () => {
        await link();
        const [row] = links();
        notify.create.length = 0;
        expect(await as(STRANGER, () => hideHouseholdLink(row.id as string))).toEqual({ ok: false, error: 'not_found' });
        expect(links()[0].hidden_at).toBeNull();

        expect(await as(MATE, () => hideHouseholdLink(row.id as string))).toEqual({ ok: true });
        expect(links()[0]).toMatchObject({ hidden_by: MATE });
        expect(links()[0].hidden_at).not.toBeNull();
        for (const viewer of [OWNER, MATE, STRANGER, ADMIN]) {
            expect((await getLinkedSummaries(viewer, 'linked')).livesWith, viewer).toEqual([]);
        }
        expect(notify.create).toEqual([expect.objectContaining({ userId: STRANGER, type: 'household_link_hidden', url: '/adopter/host' })]);
        // The host's own member and its summary are unchanged (the host owner's data).
        expect(Object.keys((await getLinkedSummaries(STRANGER, 'host')).members)).toHaveLength(1);
        // Again: a no-op, no second notice.
        expect(await as(OWNER, () => hideHouseholdLink(row.id as string))).toEqual({ ok: true });
        expect(notify.create).toHaveLength(1);
    });

    it('an admin may hide; a visitor without a session may not', async () => {
        await link();
        const [row] = links();
        expect(await as(null, () => hideHouseholdLink(row.id as string))).toEqual({ ok: false, error: 'not_authenticated' });
        expect(await as(ADMIN, () => hideHouseholdLink(row.id as string))).toEqual({ ok: true });
        expect((await getLinkedSummaries(OWNER, 'linked')).livesWith).toEqual([]);
    });

    it('canHide is false for viewers outside the linked profile team', async () => {
        await link();
        expect((await getLinkedSummaries(STRANGER, 'linked')).livesWith[0].canHide).toBe(false);
        expect((await getLinkedSummaries(ADMIN, 'linked')).livesWith[0].canHide).toBe(true);
    });
});
