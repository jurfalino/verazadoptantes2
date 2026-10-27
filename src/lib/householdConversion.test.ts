/**
 * Households as profiles, Task 7 — converting today's household data. Real SQL
 * (every drizzle/*.sql replayed), the real visibility resolver and masking, the
 * real token index and duplicate engine, the real merge / unmerge.
 *
 * The bulk fixture mirrors production (2026-10-27): 19 hosts, 29 inline
 * members — 24 'unknown', 4 'partner', 1 'child'; 3 of them with contacts;
 * nobody linked, nameless or with an age. One host is «público» (h01), one
 * has an all_contact grant (h02), one an entry grant (h03). h02's member
 * shares the applicant's phone of a form FORMTEAM received; h03's member was
 * typed by an outside contributor (CONTRIB, with the contribution grant D54
 * gives). Hosts are OWNER's (team: MATE) except h03 (OTHER_OWNER's).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { OWNER, MATE, STRANGER, ADMIN } = mocks;
const OTHER_OWNER = 'rescue-b@example.com';
const GRANTEE = 'grantee@example.com';
const ENTRY_V = 'entry-viewer@example.com';
const CONTRIB = 'contrib@example.com';
const FORMTEAM = 'formteam@example.com';

const { state, notify, flags, bg } = vi.hoisted(() => ({
    state: { db: null as unknown },
    notify: { create: [] as Array<Record<string, unknown>>, admins: [] as Array<Record<string, unknown>> },
    flags: { publicProfiles: true },
    bg: { errors: [] as unknown[] },
}));

vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/auth', () => ({ auth: vi.fn(async () => (mocks.session.user ? { user: { email: mocks.session.user } } : null)) }));
vi.mock('@/config/admins', async (orig) => ({
    ...(await orig()), isAdminAsync: mocks.isAdmin, isModeratorOrAdminAsync: mocks.isAdmin, isAdmin: (e: string | null | undefined) => e === ADMIN,
}));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOrgMate: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    getTeamEmails: async (e: string) => mocks.getOrgMemberEmailsFor(e),
    isOwnerOrOrgMate: (v: string | null | undefined, o: string | null | undefined) => mocks.isOwnerOrOrgMate(v?.trim().toLowerCase(), o?.trim().toLowerCase()),
}));
vi.mock('@/config/features', async (orig) => ({
    ...(await orig()),
    getFeatureFlag: vi.fn(async (flag: string) => flag === 'ENABLE_PII_ACCESS_GATING' || (flag === 'ENABLE_PUBLIC_PROFILES' && flags.publicProfiles)),
}));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/background', () => ({
    runAfterResponse: vi.fn(async (_n: string, task: () => Promise<unknown>) => { try { await task(); } catch (e) { bg.errors.push(e); } }),
}));
vi.mock('@/app/actions/notifications', () => ({
    createNotification: vi.fn(async (d: Record<string, unknown>) => { notify.create.push(d); return 'n'; }),
    notifyAdmins: vi.fn(async (d: Record<string, unknown>) => { notify.admins.push(d); }),
    notifyOrgMembers: vi.fn(async () => undefined),
    resolveDisplayName: vi.fn(async (email: string) => email.split('@')[0]),
    resolveDisplayNames: vi.fn(async (emails: string[]) => Object.fromEntries(emails.map(e => [e, e.split('@')[0]]))),
}));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: (_op: string, fn: () => unknown) => fn(),
}));

import {
    convertInlineHouseholds, convertedProfileId, ensureHostConverted, inlineKey, linkKey, type ConversionReport,
} from './householdConversion';
import { getHouseholdsFor, removeMembership } from './households';
import { mergeAdopters, unmergeAdopters } from './adopterMerge';
import { resolveAdopterVisibility, maskOptionsFor } from './piiAccessServer';
import { hashEntryValue, maskAdopterContact, maskHouseholdMembers } from './piiAccess';
import { deserializeContactEntries, normalizeEntryValue } from './contactEntries';
import { logger } from './logger';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };
const db = () => state.db as Parameters<typeof convertInlineHouseholds>[0];

type Contact = { id: string; type: string; value: string; addedBy?: string };
type Member = { id: string; name: string; relationship: string | null; contactEntries: Contact[]; addedBy?: string; profileId?: string; giftRecipient?: boolean; age?: number; ageAsOf?: string };

function adopter(id: string, name: string, o: { owner?: string; members?: Member[]; contacts?: Contact[]; isPublic?: boolean; deleted?: 'MERGED' | 'DELETED' } = {}) {
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at, household_members, contact_entries, is_public, deleted_at, token_hash)
        VALUES (?, ?, '5', ?, 1000, 1000, ?, ?, ?, ?, ?)`)
        .run(id, name, o.owner ?? OWNER, o.members ? JSON.stringify(o.members) : null, o.contacts ? JSON.stringify(o.contacts) : null,
            o.isPublic ? 1 : 0, o.deleted ? 5000 : null, o.deleted ?? null);
}
function grant(id: string, adopterId: string, grantee: string, scope: 'all_contact' | 'entry', ref: string | null = null, origin = 'request') {
    sqlite.prepare(`INSERT INTO pii_access_grants (id, adopter_id, grantee_email, scope, entry_ref, origin, granted_by_email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1000)`)
        .run(id, adopterId, grantee, scope, ref, origin, OWNER);
}
const ref = (type: string, value: string) => hashEntryValue(type as 'phone', value);
const hostMembersJson = (id: string) => JSON.parse(String(sqlite.prepare('SELECT household_members FROM adopters WHERE id = ?').get(id)!.household_members ?? '[]')) as Member[];
const ledger = () => sqlite.prepare('SELECT * FROM household_conversions ORDER BY source_key').all();
const membershipsOfHost = (hostId: string) => sqlite.prepare(`SELECT m.* FROM household_memberships m WHERE m.household_id IN (SELECT household_id FROM household_memberships WHERE adopter_id = ?) ORDER BY m.id`).all(hostId);
const householdOf = (hh: string) => sqlite.prepare('SELECT adopter_id FROM household_memberships WHERE household_id = ? ORDER BY id').all(hh).map(r => r.adopter_id);
const profile = (id: string) => sqlite.prepare('SELECT * FROM adopters WHERE id = ?').get(id);
const liveGrantsOn = (id: string) => sqlite.prepare('SELECT grantee_email, scope, entry_ref, origin FROM pii_access_grants WHERE adopter_id = ? AND revoked_at IS NULL ORDER BY grantee_email, scope, entry_ref').all(id);

/** Every row of every table (the dry-run check: nothing at all is written). */
function dump(): string {
    const tables = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map(r => String(r.name));
    return JSON.stringify(tables.map(t => [t, sqlite.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all()]));
}

async function runAll(dryRun: boolean, actor = ADMIN): Promise<ConversionReport> {
    const total: ConversionReport = { dryRun, hosts: 0, members: 0, createdProfiles: 0, reusedProfiles: 0, alreadyConverted: 0, updatedMembers: 0, grantsCopied: 0, corrections: 0, skipped: [], failed: 0, deletedHostsSkipped: 0, next: null, details: [] };
    let cursor: string | null = null;
    for (let page = 0; page < 50; page++) {
        const r = await convertInlineHouseholds(db(), { dryRun, actor, cursor });
        for (const k of ['hosts', 'members', 'createdProfiles', 'reusedProfiles', 'alreadyConverted', 'updatedMembers', 'grantsCopied', 'corrections', 'failed'] as const) total[k] += r[k];
        total.skipped.push(...r.skipped);
        total.details.push(...r.details);
        if (page === 0) total.deletedHostsSkipped = r.deletedHostsSkipped;
        if (!r.next) return total;
        cursor = r.next;
    }
    throw new Error('runAll: too many pages');
}

const H01_PHONE = '+54 11 5000 0001';
const H02_PHONE = '+54 11 5000 0002';
const H02_EMAIL = 'h02member@example.org';
const H03_PHONE = '+54 11 5000 0003';
const H03_HOST_PHONE = '+54 11 5999 0003';

/** The production-shaped fixture (see the file comment). */
function productionFixture() {
    const rels = [...Array(4).fill('partner'), 'child', ...Array(24).fill('unknown')] as string[];
    let n = 0;
    const next = (hostId: string, extra: Partial<Member> = {}): Member => {
        const i = n++;
        return { id: `m-${hostId}-${i}`, name: `Persona ${String(i).padStart(2, '0')} Apellido`, relationship: rels[i], contactEntries: [], addedBy: OWNER, ...extra };
    };
    for (let h = 1; h <= 19; h++) {
        const id = `h${String(h).padStart(2, '0')}`;
        const members: Member[] = [next(id)];
        if (h <= 10) members.push(next(id));
        if (id === 'h01') members[0].contactEntries = [{ id: 'c-h01', type: 'phone', value: H01_PHONE, addedBy: OWNER }];
        if (id === 'h02') members[0].contactEntries = [{ id: 'c-h02a', type: 'phone', value: H02_PHONE, addedBy: OWNER }, { id: 'c-h02b', type: 'email', value: H02_EMAIL, addedBy: OWNER }];
        if (id === 'h03') { members[0].contactEntries = [{ id: 'c-h03', type: 'phone', value: H03_PHONE, addedBy: CONTRIB }]; members[0].addedBy = CONTRIB; }
        adopter(id, `Titular ${id}`, {
            owner: id === 'h03' ? OTHER_OWNER : OWNER, members, isPublic: id === 'h01',
            contacts: [{ id: `own-${id}`, type: 'phone', value: id === 'h03' ? H03_HOST_PHONE : `+54 11 6000 00${String(h).padStart(2, '0')}` }],
        });
    }
    expect(n).toBe(29);
    grant('g-all', 'h02', GRANTEE, 'all_contact');
    grant('g-entry', 'h03', ENTRY_V, 'entry', ref('phone', H03_PHONE));
    grant('g-entry-host', 'h03', ENTRY_V, 'entry', ref('phone', H03_HOST_PHONE)); // the host's own phone: never copied
    grant('g-contrib', 'h03', CONTRIB, 'entry', ref('phone', H03_PHONE), 'contribution');
    sqlite.prepare(`INSERT INTO form_submissions (id, user_id, name, linked_adopter_id, email, phone, created_at) VALUES ('fs-h02', ?, 'Titular h02', 'h02', NULL, ?, 1000)`).run(FORMTEAM, H02_PHONE);
}

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    notify.create.length = 0;
    notify.admins.length = 0;
    bg.errors.length = 0;
    flags.publicProfiles = true;
    mocks.session.user = null;
    vi.mocked(logger.error).mockClear();
});

// ─────────────────────────── Visibility (Review Focus 1) ───────────────────────────

const VIEWERS = [OWNER, MATE, OTHER_OWNER, GRANTEE, ENTRY_V, CONTRIB, FORMTEAM, STRANGER, ADMIN, null] as const;
const norm = (e: { type: string; value: string }) => `${e.type}|${normalizeEntryValue(e.type as 'phone', e.value)}`;

/** What `viewer` sees of each member's contacts on the host, before: the host's visibility on its household JSON. */
async function seenBefore(viewer: string | null, hostId: string): Promise<Record<string, string[]>> {
    const host = profile(hostId)!;
    const vis = await resolveAdopterVisibility(viewer, { id: hostId, addedBy: String(host.added_by) });
    const masked = maskHouseholdMembers(host.household_members as string, vis, { ...maskOptionsFor(flags.publicProfiles, { isPublic: host.is_public as number }), viewerEmail: viewer ?? undefined });
    return Object.fromEntries(masked.members.map(m => [m.id, m.contactEntries.filter(e => !e.masked).map(norm).sort()]));
}

/** The same, after: each member's own profile, masked as getAdopter masks it for that viewer. */
async function seenAfter(viewer: string | null, hostId: string): Promise<Record<string, string[]>> {
    const out: Record<string, string[]> = {};
    for (const m of hostMembersJson(hostId)) {
        const row = ledger().find(l => l.source_key === inlineKey(hostId, m.id))!;
        const p = profile(String(row.profile_id))!;
        const vis = await resolveAdopterVisibility(viewer, { id: String(p.id), addedBy: String(p.added_by) });
        const masked = maskAdopterContact({ contactEntries: p.contact_entries as string, contactInfo: p.contact_info as string }, vis, maskOptionsFor(flags.publicProfiles, { isPublic: p.is_public as number }));
        const own = new Set(m.contactEntries.map(norm));
        out[m.id] = deserializeContactEntries(masked.contactEntries).filter(e => !e.masked).map(norm).filter(v => own.has(v)).sort();
    }
    return out;
}

describe('the bulk conversion on production-shaped data', () => {
    beforeEach(productionFixture);

    it('a dry run reports every member and writes nothing at all', async () => {
        const before = dump();
        const r = await runAll(true);
        expect(dump()).toBe(before);
        expect(r).toMatchObject({ dryRun: true, hosts: 19, members: 29, createdProfiles: 29, reusedProfiles: 0, alreadyConverted: 0, failed: 0, skipped: [] });
        // h02's all_contact onto both of its members (2) + FORMTEAM's given phone (team of one: 1)
        // + h03's entry (1) + the contributor's (1).
        expect(r.grantsCopied).toBe(5);
        expect(r.details.every(d => !JSON.stringify(d).includes('Persona') && !JSON.stringify(d).includes('5000'))).toBe(true);
    });

    it('converts 29 members into 29 profiles in 19 homes, with the counts the dry run gave', async () => {
        const dry = await runAll(true);
        const r = await runAll(false);
        expect({ ...r, details: [], dryRun: true }).toEqual({ ...dry, details: [] });
        expect(sqlite.prepare('SELECT COUNT(*) AS n FROM household_memberships').get()!.n).toBe(19 + 29);
        expect(ledger().filter(l => l.outcome === 'converted')).toHaveLength(29);
        // The relationships carried over.
        const rels = sqlite.prepare(`SELECT relationship, COUNT(*) AS n FROM household_memberships WHERE relative_to_adopter_id IS NOT NULL GROUP BY relationship ORDER BY relationship`).all();
        expect(rels).toEqual([{ relationship: 'child', n: 1 }, { relationship: 'partner', n: 4 }, { relationship: 'unknown', n: 24 }]);
        // Each host's own row is an anchor row (relative NULL, added_by NULL): it is that host's home.
        const anchors = sqlite.prepare(`SELECT * FROM household_memberships WHERE relative_to_adopter_id IS NULL`).all();
        expect(anchors).toHaveLength(19);
        expect(anchors.every(a => a.added_by === null && a.household_id === `hh-${a.adopter_id}`)).toBe(true);
        // A member's row: next to the host, credited to whoever typed it, its source key, already recorded.
        const h03 = membershipsOfHost('h03').find(m => m.relative_to_adopter_id === 'h03')!;
        expect(h03).toMatchObject({ household_id: 'hh-h03', added_by: CONTRIB, source_key: inlineKey('h03', 'm-h03-4') });
        expect(h03.recorded_at).not.toBeNull();
        expect(bg.errors).toEqual([]);
    });

    it('a created profile: owned by the host\'s owner (also when an outsider typed the member), contacts credited as they were, the host\'s «público»', async () => {
        await runAll(false);
        const id = await convertedProfileId(inlineKey('h03', 'm-h03-4'));
        const p = profile(id)!;
        expect(p).toMatchObject({ name: 'Persona 04 Apellido', added_by: OTHER_OWNER, is_public: 0, source: 'manual', deleted_at: null });
        expect(deserializeContactEntries(p.contact_entries as string)).toEqual([expect.objectContaining({ type: 'phone', value: H03_PHONE, addedBy: CONTRIB })]);
        // The history names whoever typed it — a contribution (the owner can't delete what others gave without asking).
        expect(sqlite.prepare('SELECT changed_by, kind, changes FROM adopter_history WHERE adopter_id = ?').all(id)).toEqual([
            expect.objectContaining({ changed_by: CONTRIB, kind: 'contribution' }),
        ]);
        expect(profile(await convertedProfileId(inlineKey('h01', 'm-h01-0')))!.is_public).toBe(1);
        // Searchable by its own phone now (the token index).
        expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM duplicate_tokens WHERE adopter_id = ?`).get(id)!.n).toBeGreaterThan(0);
    });

    for (const publicProfiles of [true, false]) {
        it(`every viewer sees exactly the same contacts of each member before and after (public profiles ${publicProfiles ? 'on' : 'off'})`, async () => {
            flags.publicProfiles = publicProfiles;
            const hosts = ['h01', 'h02', 'h03', 'h04'];
            const before: Record<string, unknown> = {};
            for (const v of VIEWERS) for (const h of hosts) before[`${v}|${h}`] = await seenBefore(v, h);
            await runAll(false);
            for (const v of VIEWERS) for (const h of hosts) {
                expect({ viewer: v, host: h, seen: await seenAfter(v, h) }).toEqual({ viewer: v, host: h, seen: before[`${v}|${h}`] });
            }
            // The check is not vacuous: someone sees, and someone does not, each member with contacts.
            expect(before[`${GRANTEE}|h02`]).toEqual({ 'm-h02-2': [norm({ type: 'email', value: H02_EMAIL }), norm({ type: 'phone', value: H02_PHONE })].sort(), 'm-h02-3': [] });
            expect(before[`${FORMTEAM}|h02`]).toEqual({ 'm-h02-2': [norm({ type: 'phone', value: H02_PHONE })], 'm-h02-3': [] });
            expect(before[`${ENTRY_V}|h03`]).toEqual({ 'm-h03-4': [norm({ type: 'phone', value: H03_PHONE })], 'm-h03-5': [] });
            expect(before[`${STRANGER}|h03`]).toEqual({ 'm-h03-4': [], 'm-h03-5': [] });
            expect(before[`${STRANGER}|h01`]).toEqual({ 'm-h01-0': publicProfiles ? [norm({ type: 'phone', value: H01_PHONE })] : [], 'm-h01-1': [] });
        });
    }

    it('the entry grant on the host\'s own phone is not copied; the all_contact grant is', async () => {
        await runAll(false);
        expect(liveGrantsOn(await convertedProfileId(inlineKey('h03', 'm-h03-4')))).toEqual([
            { grantee_email: CONTRIB, scope: 'entry', entry_ref: ref('phone', H03_PHONE), origin: 'contribution' },
            { grantee_email: ENTRY_V, scope: 'entry', entry_ref: ref('phone', H03_PHONE), origin: 'request' },
        ]);
        expect(liveGrantsOn(await convertedProfileId(inlineKey('h02', 'm-h02-2')))).toEqual([
            { grantee_email: FORMTEAM, scope: 'entry', entry_ref: ref('phone', H02_PHONE), origin: 'household_conversion' },
            { grantee_email: GRANTEE, scope: 'all_contact', entry_ref: null, origin: 'request' },
        ]);
    });

    it('a second run changes nothing', async () => {
        await runAll(false);
        const after = dump();
        const r = await runAll(false);
        expect(dump()).toBe(after);
        expect(r).toMatchObject({ hosts: 19, members: 29, createdProfiles: 0, reusedProfiles: 0, alreadyConverted: 29, grantsCopied: 0, skipped: [], failed: 0 });
    });

    it('a member an old tab adds to the JSON after the run is converted by the next one (Review Focus 2)', async () => {
        await runAll(false);
        const members = hostMembersJson('h05');
        sqlite.prepare('UPDATE adopters SET household_members = ? WHERE id = ?')
            .run(JSON.stringify([...members, { id: 'late-1', name: 'Recién Llegada', relationship: 'sibling', contactEntries: [{ id: 'cl', type: 'phone', value: '+54 11 7000 0001' }], addedBy: MATE }]), 'h05');
        const r = await runAll(false);
        expect(r).toMatchObject({ createdProfiles: 1, alreadyConverted: 29, failed: 0 });
        const late = await convertedProfileId(inlineKey('h05', 'late-1'));
        expect(membershipsOfHost('h05').map(m => m.adopter_id)).toContain(late);
        expect(profile(late)).toMatchObject({ name: 'Recién Llegada', added_by: OWNER });
    });

    it('a contact an old tab adds to a converted member arrives on the profile; one the owner removed since stays gone', async () => {
        await runAll(false);
        const id = await convertedProfileId(inlineKey('h01', 'm-h01-0'));
        // The owner removes the phone from the new profile…
        sqlite.prepare(`UPDATE adopters SET contact_entries = '[]', contact_info = NULL WHERE id = ?`).run(id);
        // …then an old tab (deploy skew) adds an email to the member in the JSON, with D54's contribution grant on the host.
        const NEW_EMAIL = 'late-email@example.org';
        const members = hostMembersJson('h01');
        members[0].contactEntries.push({ id: 'c-late', type: 'email', value: NEW_EMAIL, addedBy: STRANGER });
        sqlite.prepare('UPDATE adopters SET household_members = ? WHERE id = ?').run(JSON.stringify(members), 'h01');
        grant('g-late', 'h01', STRANGER, 'entry', ref('email', NEW_EMAIL), 'contribution');
        const r = await runAll(false);
        expect(r).toMatchObject({ updatedMembers: 1, createdProfiles: 0, failed: 0 });
        expect(deserializeContactEntries(profile(id)!.contact_entries as string)).toEqual([expect.objectContaining({ type: 'email', value: NEW_EMAIL, addedBy: STRANGER })]);
        expect(liveGrantsOn(id)).toContainEqual({ grantee_email: STRANGER, scope: 'entry', entry_ref: ref('email', NEW_EMAIL), origin: 'contribution' });
        // Recorded: the next run has nothing to do.
        const after = dump();
        expect(await runAll(false)).toMatchObject({ updatedMembers: 0, alreadyConverted: 29 });
        expect(dump()).toBe(after);
    });

    it('the first view of a host converts it (lazily, no notices), and shows its people', async () => {
        const views = await getHouseholdsFor(db(), STRANGER, 'h02');
        expect(views).toHaveLength(1);
        expect(views[0].members.map(m => m.name).sort()).toEqual(['Persona 02 Apellido', 'Persona 03 Apellido']);
        // Names follow the profile rule now (Task 2 ruling): a signed-in stranger sees them in full; the contacts stay masked.
        expect(views[0].members.find(m => m.name === 'Persona 02 Apellido')!.contacts.every(c => c.masked)).toBe(true);
        expect(ledger().map(l => l.host_adopter_id)).toEqual(['h02', 'h02']);
        expect(ledger().every(l => l.actor === 'system')).toBe(true);
        expect(notify.create).toEqual([]);
        expect(notify.admins).toEqual([]);
        // Only h02 was touched.
        expect(sqlite.prepare('SELECT COUNT(*) AS n FROM household_memberships').get()!.n).toBe(3);
    });
});

// ─────────────────────────── The ledger: converted means converted ───────────────────────────

describe('a person taken out after the conversion never comes back from the old JSON', () => {
    beforeEach(() => {
        adopter('pedro', 'Pedro Paez', { members: [
            { id: 'pm1', name: 'Marta Paez', relationship: 'partner', contactEntries: [], addedBy: OWNER },
            { id: 'pm2', name: 'Lucas Paez', relationship: 'child', contactEntries: [], addedBy: OWNER },
        ] });
    });
    const people = async () => (await getHouseholdsFor(db(), OWNER, 'pedro'))[0]?.members.map(m => m.name).sort() ?? [];

    it('after «Lo cargué por error», «No vive acá» or «Eliminar perfil»', async () => {
        expect(await people()).toEqual(['Lucas Paez', 'Marta Paez']);
        const marta = await convertedProfileId(inlineKey('pedro', 'pm1'));
        const lucas = await convertedProfileId(inlineKey('pedro', 'pm2'));
        const rowOf = (id: string) => String(sqlite.prepare('SELECT id FROM household_memberships WHERE adopter_id = ?').get(id)!.id);
        await removeMembership(db(), rowOf(marta), OWNER, { correction: true });
        await removeMembership(db(), rowOf(lucas), OWNER, { correction: false });
        expect(await people()).toEqual([]);
        expect(await runAll(false)).toMatchObject({ createdProfiles: 0, alreadyConverted: 2 });
        expect(await people()).toEqual([]);
        expect(notify.admins).toEqual([]); // no false «volvió a dejar» dispute
        // A deleted converted profile is not re-made either.
        sqlite.prepare(`UPDATE adopters SET deleted_at = 6000, token_hash = 'DELETED' WHERE id = ?`).run(marta);
        await ensureHostConverted(db(), 'pedro');
        expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM adopters WHERE name = 'Marta Paez'`).get()!.n).toBe(1);
    });

    it('a crashed run (profile made, not placed) is completed without a second profile', async () => {
        const id = await convertedProfileId(inlineKey('pedro', 'pm1'));
        adopter(id, 'Marta Paez');
        await ensureHostConverted(db(), 'pedro');
        expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM adopters WHERE name = 'Marta Paez'`).get()!.n).toBe(1);
        expect(await people()).toEqual(['Lucas Paez', 'Marta Paez']);
    });

    it('someone of the same name already home is reused, not made twice', async () => {
        adopter('marta-real', 'Marta  PÁEZ');
        sqlite.prepare(`INSERT INTO households (id, created_by, created_at) VALUES ('hh-pedro', ?, 900)`).run(OWNER);
        sqlite.prepare(`INSERT INTO household_memberships (id, household_id, adopter_id, relationship, relative_to_adopter_id, gift_recipient, added_by, added_at) VALUES
            ('hm-a', 'hh-pedro', 'pedro', 'unknown', NULL, 0, NULL, 900), ('hm-b', 'hh-pedro', 'marta-real', 'partner', 'pedro', 0, ?, 901)`).run(MATE);
        const r = await runAll(false);
        expect(r).toMatchObject({ createdProfiles: 1, reusedProfiles: 1 });
        expect(ledger().find(l => l.source_key === inlineKey('pedro', 'pm1'))).toMatchObject({ profile_id: 'marta-real', membership_id: 'hm-b', reason: 'same_name' });
        expect(membershipsOfHost('pedro')).toHaveLength(3);
    });

    it('a member with no name and no contact, and a gift recipient, are reported and left in the JSON', async () => {
        sqlite.prepare('UPDATE adopters SET household_members = ? WHERE id = ?').run(JSON.stringify([
            { id: 'pm3', name: '', relationship: 'sibling', contactEntries: [] },
            { id: 'pm4', name: 'Sofía Regalo', relationship: 'other_relative', contactEntries: [], giftRecipient: true },
        ]), 'pedro');
        const r = await runAll(false);
        expect(r.skipped).toEqual([
            { hostId: 'pedro', memberId: 'pm3', reason: 'no_identifier' },
            { hostId: 'pedro', memberId: 'pm4', reason: 'gift_without_form' },
        ]);
        expect(await runAll(false)).toMatchObject({ skipped: [], alreadyConverted: 2 });
        expect(hostMembersJson('pedro')).toHaveLength(2); // the JSON is never written
    });
});

// ─────────────────────────── Linked members (D44), corrections (D48) ───────────────────────────

describe('linked members and «No convive» corrections', () => {
    const JON_PHONE = '+54 11 5555 0101';
    const JON_NEW_PHONE = '+54 11 5555 0909';
    beforeEach(() => {
        adopter('jonathan', 'Jonathan Urfalino', { owner: OTHER_OWNER, contacts: [{ id: 'j1', type: 'phone', value: JON_PHONE }, { id: 'j2', type: 'email', value: 'jon@example.org' }] });
        adopter('pedro', 'Pedro Paez', { members: [
            { id: 'pm1', name: 'Jonathan Urfalino', relationship: 'unknown', profileId: 'jonathan', addedBy: OWNER,
                contactEntries: [{ id: 'x1', type: 'phone', value: JON_NEW_PHONE, addedBy: OWNER }] },
        ] });
        sqlite.prepare(`INSERT INTO household_links (id, host_adopter_id, linked_adopter_id, member_id, created_by, created_at) VALUES ('hl-pedro-pm1', 'pedro', 'jonathan', 'pm1', ?, 1000)`).run(OWNER);
        grant('g-pedro-all', 'pedro', GRANTEE, 'all_contact');
    });

    it('the linked profile joins the host\'s home under link:{id}; the member\'s new phone is added to it, granted per value only', async () => {
        // Viewing Jonathan converts Pedro (the host that links to him).
        const views = await getHouseholdsFor(db(), OTHER_OWNER, 'jonathan');
        expect(views[0].members.map(m => m.profileId)).toEqual(['pedro']);
        expect(ledger()).toEqual([expect.objectContaining({ source_key: linkKey('hl-pedro-pm1'), outcome: 'converted', profile_id: 'jonathan', reason: 'linked', created_profile: 0 })]);
        expect(deserializeContactEntries(profile('jonathan')!.contact_entries as string).map(e => e.value)).toEqual([JON_PHONE, 'jon@example.org', JON_NEW_PHONE]);
        // Pedro's all_contact grantee and Pedro's team see the phone they saw on Pedro — not Jonathan's own contacts.
        const grants = liveGrantsOn('jonathan');
        expect(grants.every(g => g.scope === 'entry' && g.entry_ref === ref('phone', JON_NEW_PHONE))).toBe(true);
        expect(grants.map(g => g.grantee_email).sort()).toEqual([GRANTEE, MATE, OWNER].sort());
        const seen = async (viewer: string) => {
            const p = profile('jonathan')!;
            const vis = await resolveAdopterVisibility(viewer, { id: 'jonathan', addedBy: OTHER_OWNER });
            return deserializeContactEntries(maskAdopterContact({ contactEntries: p.contact_entries as string }, vis).contactEntries).filter(e => !e.masked).map(e => e.value);
        };
        expect(await seen(GRANTEE)).toEqual([JON_NEW_PHONE]);
        expect(await seen(MATE)).toEqual([JON_NEW_PHONE]);
        expect(await seen(STRANGER)).toEqual([]);
        // ACCEPTED EXCEPTION (reported for Jon): an EXISTING profile's own team and grantees now also see the phone
        // that was only on Pedro's household — as for any contact added to an existing profile (addContactEntry).
        // Created profiles (all of production's 29) have no such gain: see the per-viewer test above.
        grant('g-jon-all', 'jonathan', ENTRY_V, 'all_contact');
        expect(await seen(OTHER_OWNER)).toEqual([JON_PHONE, 'jon@example.org', JON_NEW_PHONE]);
        expect(await seen(ENTRY_V)).toEqual([JON_PHONE, 'jon@example.org', JON_NEW_PHONE]);
    });

    it('a member whose profile was merged follows the merge (old D51 merges left the JSON id on the absorbed profile)', async () => {
        adopter('jon-old', 'Jonathan U.', { owner: OTHER_OWNER, deleted: 'MERGED' });
        sqlite.prepare(`INSERT INTO audit_log (id, user_id, user_email, action, target, details, created_at) VALUES ('am', ?, ?, 'adopter_merge', 'jonathan', ?, 4000)`)
            .run(ADMIN, ADMIN, JSON.stringify({ primaryId: 'jonathan', secondaryId: 'jon-old' }));
        sqlite.prepare('UPDATE adopters SET household_members = ? WHERE id = ?').run(JSON.stringify([{ id: 'pm1', name: 'Jonathan U.', relationship: 'unknown', profileId: 'jon-old', contactEntries: [] }]), 'pedro');
        await runAll(false);
        expect(ledger()[0]).toMatchObject({ source_key: linkKey('hl-pedro-pm1'), profile_id: 'jonathan' });
        expect(membershipsOfHost('pedro').map(m => m.adopter_id).sort()).toEqual(['jonathan', 'pedro']);
    });

    it('a linked profile deleted for good is skipped and retried (not made again from the JSON)', async () => {
        sqlite.prepare(`UPDATE adopters SET deleted_at = 6000, token_hash = 'DELETED' WHERE id = 'jonathan'`).run();
        const r = await runAll(false);
        expect(r.skipped).toEqual([{ hostId: 'pedro', memberId: 'pm1', reason: 'linked_profile_gone' }]);
        expect(ledger()).toEqual([]);
        sqlite.prepare(`UPDATE adopters SET deleted_at = NULL, token_hash = NULL WHERE id = 'jonathan'`).run(); // restored from the Papelera
        expect(await runAll(false)).toMatchObject({ reusedProfiles: 1, skipped: [] });
    });

    it('a «No convive» correction becomes one for (the host\'s home, that person)', async () => {
        sqlite.prepare(`INSERT INTO household_link_corrections (id, host_adopter_id, linked_adopter_id, member_id, member_snapshot, corrected_by, created_at) VALUES ('corr1', 'pedro', 'marta', 'pm9', '{}', ?, 3000)`).run(OTHER_OWNER);
        adopter('marta', 'Marta Paez');
        const r = await runAll(false);
        expect(r.corrections).toBe(1);
        expect(sqlite.prepare('SELECT * FROM household_corrections').all()).toEqual([expect.objectContaining({ id: 'hc-link-corr1', household_id: 'hh-pedro', adopter_id: 'marta', corrected_by: OTHER_OWNER })]);
        expect((await runAll(false)).corrections).toBe(0);
    });
});

// ─────────────────────────── Merges ───────────────────────────

describe('merges and the conversion (Task 6 carries)', () => {
    it('a merge converts both profiles first, so the absorbed host\'s people move with it', async () => {
        adopter('ana', 'Ana Gómez', { members: [{ id: 'am1', name: 'Lucía Gómez', relationship: 'child', contactEntries: [] }] });
        adopter('ana2', 'Ana Gomez', { members: [{ id: 'bm1', name: 'Raúl Gómez', relationship: 'partner', contactEntries: [{ id: 'r1', type: 'phone', value: '+54 11 8000 0001' }] }] });
        const res = await mergeAdopters('ana', 'ana2', ADMIN);
        expect(res.success).toBe(true);
        const raul = await convertedProfileId(inlineKey('ana2', 'bm1'));
        const lucia = await convertedProfileId(inlineKey('ana', 'am1'));
        // Ana's own home keeps Lucía; the absorbed profile's home comes along with Raúl (Task 6 moves it whole).
        expect(householdOf('hh-ana')).toEqual(['ana', lucia]);
        expect(householdOf('hh-ana2')).toEqual(['ana', raul]);
        expect(profile(raul)).toMatchObject({ deleted_at: null });
    });

    it('a conversion that fails refuses the merge (nothing moves)', async () => {
        adopter('ana', 'Ana Gómez', { members: [{ id: 'am1', name: 'Lucía Gómez', relationship: 'child', contactEntries: [] }] });
        adopter('ana2', 'Ana Gomez');
        const realPrepare = sqlite.prepare.bind(sqlite);
        sqlite.prepare = ((s: string) => { if (/insert into "households"/i.test(s)) throw new Error('injected'); return realPrepare(s); }) as typeof sqlite.prepare;
        try {
            const res = await mergeAdopters('ana', 'ana2', ADMIN);
            expect(res.success).toBe(false);
        } finally {
            sqlite.prepare = realPrepare;
        }
        expect(profile('ana2')!.deleted_at).toBeNull();
    });

    /**
     * A merge recorded BEFORE the release (old payload: the survivor's JSON got
     * the absorbed host's members as copies under new ids; links were moved),
     * then the conversion ran on the survivor, then the merge is undone.
     */
    describe('undo of an old merge after the conversion', () => {
        const RAUL_PHONE = '+54 11 8000 0001';
        beforeEach(() => {
            const original: Member = { id: 'orig-1', name: 'Raúl Gómez', relationship: 'partner', addedBy: OTHER_OWNER, contactEntries: [{ id: 'r1', type: 'phone', value: RAUL_PHONE, addedBy: OTHER_OWNER }] };
            const linkedOrig: Member = { id: 'orig-2', name: 'Lucas Gómez', relationship: 'child', addedBy: OTHER_OWNER, profileId: 'lucas', contactEntries: [] };
            adopter('lucas', 'Lucas Gómez', { owner: OTHER_OWNER });
            // The absorbed host: OTHER_OWNER's, its JSON intact (old merges never wrote it), soft-deleted by the merge.
            adopter('ana2', 'Ana Gomez', { owner: OTHER_OWNER, members: [original, linkedOrig], deleted: 'MERGED' });
            // The survivor: OWNER's, with the copies (new ids, same content) the merge appended.
            adopter('ana', 'Ana Gómez', { members: [{ ...original, id: 'copy-1', contactEntries: [{ ...original.contactEntries[0], id: 'r1-copy' }] }, { ...linkedOrig, id: 'copy-2' }] });
            sqlite.prepare(`INSERT INTO household_links (id, host_adopter_id, linked_adopter_id, member_id, created_by, created_at) VALUES ('hl-ana2-orig-2', 'ana', 'lucas', 'copy-2', ?, 1000)`).run(OTHER_OWNER);
            grant('g-ana-all', 'ana', GRANTEE, 'all_contact');
            grant('g-ana2-all', 'ana2', ENTRY_V, 'all_contact');
            const snap = profile('ana')!;
            const undo = {
                primarySnapshot: { contactInfo: snap.contact_info, contactEntries: snap.contact_entries, addressInfo: null, familyMembers: null, sourceUrl: null, isPublic: 0 },
                placementIds: [], adopterEventIds: [], imageIds: [], flagIds: [], historyIds: [], statsIds: [], formSubmissionIds: [], candidates: [], annotatedFlags: [],
                addedHouseholdMemberIds: ['copy-1', 'copy-2'],
                householdLinks: [{ id: 'hl-ana2-orig-2', hostAdopterId: 'ana2', linkedAdopterId: 'lucas', memberId: 'orig-2' }],
                householdLinkCorrections: [],
            };
            sqlite.prepare(`INSERT INTO audit_log (id, user_id, user_email, action, target, details, created_at) VALUES ('audit-old', ?, ?, 'adopter_merge', 'ana', ?, 5000)`)
                .run(ADMIN, ADMIN, JSON.stringify({ primaryId: 'ana', secondaryId: 'ana2', secondaryName: 'Ana Gomez', mergeDetails: {}, undo }));
        });

        it('the converted copies go back to the absorbed profile\'s home — same profiles, owner and grants follow — and its next view makes nobody twice', async () => {
            await getHouseholdsFor(db(), OWNER, 'ana'); // the survivor is converted (lazily, on a view)
            const raul = await convertedProfileId(inlineKey('ana', 'copy-1'));
            expect(profile(raul)).toMatchObject({ added_by: OWNER });
            expect(liveGrantsOn(raul)).toEqual([{ grantee_email: GRANTEE, scope: 'all_contact', entry_ref: null, origin: 'request' }]);
            expect(membershipsOfHost('ana').map(m => m.adopter_id).sort()).toEqual(['ana', 'lucas', raul].sort());

            expect((await unmergeAdopters('audit-old', ADMIN)).success).toBe(true);
            // Back where they lived before the merge, under the original's key.
            expect(householdOf('hh-ana')).toEqual(['ana']); // the survivor's home keeps only its anchor
            const home = membershipsOfHost('ana2');
            expect(home.map(m => m.adopter_id).sort()).toEqual(['ana2', 'lucas', raul].sort());
            expect(home.find(m => m.adopter_id === raul)).toMatchObject({ source_key: inlineKey('ana2', 'orig-1'), relative_to_adopter_id: 'ana2' });
            // The profile the conversion made from the copy is the absorbed team's again, with the absorbed host's grants.
            expect(profile(raul)).toMatchObject({ added_by: OTHER_OWNER });
            expect(liveGrantsOn(raul)).toEqual([{ grantee_email: ENTRY_V, scope: 'all_contact', entry_ref: null, origin: 'request' }]);
            // The revived host's first view converts nothing twice.
            await getHouseholdsFor(db(), OTHER_OWNER, 'ana2');
            expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM adopters WHERE name = 'Raúl Gómez'`).get()!.n).toBe(1);
            expect(membershipsOfHost('ana2')).toHaveLength(3);
            expect(vi.mocked(logger.error)).not.toHaveBeenCalled();
        });

        it('a retried undo after the revived absorbed host was converted meanwhile: the copy leaves the survivor\'s home (nobody lives twice)', async () => {
            await getHouseholdsFor(db(), OWNER, 'ana');
            const copyRaul = await convertedProfileId(inlineKey('ana', 'copy-1'));
            // A first undo attempt died after reviving the absorbed profile; a view converted it from its own JSON then.
            const details = JSON.parse(String(sqlite.prepare(`SELECT details FROM audit_log WHERE id = 'audit-old'`).get()!.details));
            sqlite.prepare(`UPDATE audit_log SET details = ? WHERE id = 'audit-old'`).run(JSON.stringify({ ...details, undoStartedAt: 5500 }));
            sqlite.prepare(`UPDATE adopters SET deleted_at = NULL, token_hash = NULL WHERE id = 'ana2'`).run();
            await getHouseholdsFor(db(), OTHER_OWNER, 'ana2');
            const origRaul = await convertedProfileId(inlineKey('ana2', 'orig-1'));
            expect((await unmergeAdopters('audit-old', ADMIN)).success).toBe(true);
            expect(householdOf('hh-ana')).toEqual(['ana']);
            const homeA = householdOf('hh-ana2');
            expect(homeA).toContain(origRaul);
            expect(homeA).not.toContain(copyRaul);
            expect(homeA.filter(id => id === 'lucas')).toHaveLength(1);
        });

        it('undone before any conversion, the absorbed host converts from its own JSON as if never merged', async () => {
            expect((await unmergeAdopters('audit-old', ADMIN)).success).toBe(true);
            await getHouseholdsFor(db(), OTHER_OWNER, 'ana2');
            const raul = await convertedProfileId(inlineKey('ana2', 'orig-1'));
            expect(membershipsOfHost('ana2').map(m => m.adopter_id).sort()).toEqual(['ana2', 'lucas', raul].sort());
            expect(profile(raul)).toMatchObject({ added_by: OTHER_OWNER });
        });
    });
});

// ─────────────────────────── Fix round 1 ───────────────────────────

describe('fix round 1: undo of an old merge when the copy was converted onto someone else\'s membership (I1)', () => {
    it('the survivor keeps its own member, membership and grants; the absorbed home gets the person too', async () => {
        const original: Member = { id: 'orig-1', name: 'Raúl Gómez', relationship: 'partner', addedBy: OTHER_OWNER, contactEntries: [] };
        adopter('ana2', 'Ana Gomez', { owner: OTHER_OWNER, members: [original], deleted: 'MERGED' });
        // The survivor's own Raúl ('unknown') + the old merge's copy ('partner': the old merge's name+relationship key differs, so it appended it).
        adopter('ana', 'Ana Gómez', { members: [
            { id: 'own-1', name: 'Raúl Gómez', relationship: 'unknown', addedBy: OWNER, contactEntries: [] },
            { ...original, id: 'copy-1' },
        ] });
        grant('g-ana-all', 'ana', GRANTEE, 'all_contact');
        const snap = profile('ana')!;
        const undo = {
            primarySnapshot: { contactInfo: snap.contact_info, contactEntries: snap.contact_entries, addressInfo: null, familyMembers: null, sourceUrl: null, isPublic: 0 },
            placementIds: [], adopterEventIds: [], imageIds: [], flagIds: [], historyIds: [], statsIds: [], formSubmissionIds: [], candidates: [], annotatedFlags: [],
            addedHouseholdMemberIds: ['copy-1'], householdLinks: [], householdLinkCorrections: [],
        };
        sqlite.prepare(`INSERT INTO audit_log (id, user_id, user_email, action, target, details, created_at) VALUES ('audit-old', ?, ?, 'adopter_merge', 'ana', ?, 5000)`)
            .run(ADMIN, ADMIN, JSON.stringify({ primaryId: 'ana', secondaryId: 'ana2', secondaryName: 'Ana Gomez', mergeDetails: {}, undo }));
        await getHouseholdsFor(db(), OWNER, 'ana');
        const ownRaul = await convertedProfileId(inlineKey('ana', 'own-1'));
        const ownRow = sqlite.prepare('SELECT * FROM household_memberships WHERE adopter_id = ?').get(ownRaul)!;
        const grantsBefore = liveGrantsOn(ownRaul);
        expect(grantsBefore).toEqual([{ grantee_email: GRANTEE, scope: 'all_contact', entry_ref: null, origin: 'request' }]);

        expect((await unmergeAdopters('audit-old', ADMIN)).success).toBe(true);
        expect(householdOf('hh-ana')).toEqual(['ana', ownRaul]);
        expect(sqlite.prepare('SELECT * FROM household_memberships WHERE id = ?').get(ownRow.id)).toEqual(ownRow);
        expect(liveGrantsOn(ownRaul)).toEqual(grantsBefore);
        expect(profile(ownRaul)).toMatchObject({ added_by: OWNER });
        // The absorbed host lists the same person again: one profile, two homes, keyed by the original.
        expect(householdOf('hh-ana2')).toEqual(['ana2', ownRaul]);
        expect(sqlite.prepare('SELECT source_key FROM household_memberships WHERE household_id = ? AND adopter_id = ?').get('hh-ana2', ownRaul)!.source_key).toBe(inlineKey('ana2', 'orig-1'));
        await getHouseholdsFor(db(), OWNER, 'ana');
        await getHouseholdsFor(db(), OTHER_OWNER, 'ana2');
        expect(householdOf('hh-ana')).toEqual(['ana', ownRaul]);
        expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM adopters WHERE name = 'Raúl Gómez'`).get()!.n).toBe(1);
    });
});

describe('fix round 1: merges', () => {
    it('a merge converts the hosts that link to either profile first (their memberships move with the merge)', async () => {
        adopter('ana', 'Ana Gómez');
        adopter('ana2', 'Ana Gomez');
        adopter('hector', 'Héctor Paz', { members: [{ id: 'hm1', name: 'Ana Gomez', relationship: 'sibling', profileId: 'ana2', contactEntries: [] }] });
        sqlite.prepare(`INSERT INTO household_links (id, host_adopter_id, linked_adopter_id, member_id, created_by, created_at) VALUES ('hl-hector-hm1', 'hector', 'ana2', 'hm1', ?, 1000)`).run(OWNER);
        expect((await mergeAdopters('ana', 'ana2', ADMIN)).success).toBe(true);
        expect(householdOf('hh-hector')).toEqual(['hector', 'ana']);
        // …and the merge's own undo payload brings it back.
        const audit = sqlite.prepare(`SELECT id FROM audit_log WHERE action = 'adopter_merge'`).get()!;
        expect((await unmergeAdopters(String(audit.id), ADMIN)).success).toBe(true);
        expect(householdOf('hh-hector')).toEqual(['hector', 'ana2']);
    });

    it('a member that can\'t be placed (household full) refuses the merge with a clear code', async () => {
        adopter('ana', 'Ana Gómez', { members: [{ id: 'am1', name: 'Lucía Gómez', relationship: 'child', contactEntries: [] }] });
        adopter('ana2', 'Ana Gomez');
        sqlite.prepare(`INSERT INTO households (id, created_by, created_at) VALUES ('hh-ana', ?, 900)`).run(OWNER);
        sqlite.prepare(`INSERT INTO household_memberships (id, household_id, adopter_id, relationship, gift_recipient, added_by, added_at) VALUES ('hm-000', 'hh-ana', 'ana', 'unknown', 0, NULL, 900)`).run();
        for (let i = 1; i < 30; i++) {
            adopter(`p${i}`, `Persona Llena ${i}`);
            sqlite.prepare(`INSERT INTO household_memberships (id, household_id, adopter_id, relationship, relative_to_adopter_id, gift_recipient, added_by, added_at) VALUES (?, 'hh-ana', ?, 'unknown', 'ana', 0, ?, 900)`).run(`hm-${String(i).padStart(3, '0')}`, `p${i}`, OWNER);
        }
        expect(await mergeAdopters('ana', 'ana2', ADMIN)).toMatchObject({ success: false, error: 'household_not_converted' });
        expect(profile('ana2')!.deleted_at).toBeNull();
    });
});

describe('fix round 1: an old tab\'s edit follows the person through a merge', () => {
    beforeEach(() => {
        adopter('pedro', 'Pedro Paez', { members: [{ id: 'pm1', name: 'Marta Paez', relationship: 'partner', addedBy: OWNER, contactEntries: [] }] });
    });
    const addEmailInOldTab = (value: string) => {
        const members = hostMembersJson('pedro');
        members[0].contactEntries.push({ id: `c-${value}`, type: 'email', value, addedBy: OWNER });
        sqlite.prepare('UPDATE adopters SET household_members = ? WHERE id = ?').run(JSON.stringify(members), 'pedro');
    };

    it('the contact lands on the profile Marta was merged into', async () => {
        await ensureHostConverted(db(), 'pedro');
        const marta = await convertedProfileId(inlineKey('pedro', 'pm1'));
        adopter('marta-main', 'Marta Paez');
        sqlite.prepare(`UPDATE adopters SET deleted_at = 6000, token_hash = 'MERGED' WHERE id = ?`).run(marta);
        sqlite.prepare(`INSERT INTO audit_log (id, user_id, user_email, action, target, details, created_at) VALUES ('am2', ?, ?, 'adopter_merge', 'marta-main', ?, 6000)`)
            .run(ADMIN, ADMIN, JSON.stringify({ primaryId: 'marta-main', secondaryId: marta }));
        addEmailInOldTab('marta@example.org');
        await ensureHostConverted(db(), 'pedro');
        expect(deserializeContactEntries(profile('marta-main')!.contact_entries as string).map(e => e.value)).toEqual(['marta@example.org']);
    });

    it('when the profile is gone for good, the edit is not marked as carried over (retried)', async () => {
        await ensureHostConverted(db(), 'pedro');
        const marta = await convertedProfileId(inlineKey('pedro', 'pm1'));
        const fp = ledger()[0].fingerprint;
        sqlite.prepare(`UPDATE adopters SET deleted_at = 6000, token_hash = 'DELETED' WHERE id = ?`).run(marta);
        addEmailInOldTab('marta@example.org');
        await ensureHostConverted(db(), 'pedro');
        expect(ledger()[0].fingerprint).toBe(fp);
    });
});

describe('fix round 1: the bulk run', () => {
    beforeEach(productionFixture);

    it('a page stops at its work budget and the next page goes on from there', async () => {
        const first = await convertInlineHouseholds(db(), { dryRun: false, actor: ADMIN, budget: 3 });
        expect(first.createdProfiles).toBeGreaterThanOrEqual(3);
        expect(first.createdProfiles).toBeLessThan(6);
        expect(first.next).not.toBeNull();
        const rest = await runAll(false);
        expect(first.createdProfiles + rest.createdProfiles).toBe(29);
    });

    it('two simultaneous views, a merge-time conversion and a bulk run make each person once', async () => {
        const res = await Promise.allSettled([
            getHouseholdsFor(db(), STRANGER, 'h01'), getHouseholdsFor(db(), OWNER, 'h01'), ensureHostConverted(db(), 'h01'), runAll(false),
        ]);
        expect(res.map(r => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled']);
        expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM adopters WHERE name LIKE 'Persona%'`).get()!.n).toBe(29);
        expect(sqlite.prepare('SELECT COUNT(*) AS n FROM household_memberships').get()!.n).toBe(48);
        expect(sqlite.prepare('SELECT COUNT(*) AS n FROM households').get()!.n).toBe(19);
        expect(vi.mocked(logger.error)).not.toHaveBeenCalled();
    });

    it('a revoked grant on the host is not copied', async () => {
        sqlite.prepare(`INSERT INTO pii_access_grants (id, adopter_id, grantee_email, scope, entry_ref, origin, granted_by_email, created_at, revoked_at) VALUES ('g-rev', 'h01', 'revoked@example.com', 'all_contact', NULL, 'request', ?, 1000, 2000)`).run(OWNER);
        await runAll(false);
        expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM pii_access_grants WHERE grantee_email = 'revoked@example.com'`).get()!.n).toBe(1);
    });
});

describe('fix round 1: a member\'s age moves onto the profile', () => {
    it('age and the day it was given; a minor by that age', async () => {
        adopter('pedro', 'Pedro Paez', { members: [
            { id: 'pm1', name: 'Lucas Paez', relationship: 'child', contactEntries: [], age: 9, ageAsOf: '2024-03-01' },
            { id: 'pm2', name: 'Marta Paez', relationship: 'partner', contactEntries: [], age: 41, ageAsOf: '2025-01-15' },
        ] });
        await ensureHostConverted(db(), 'pedro');
        expect(profile(await convertedProfileId(inlineKey('pedro', 'pm1')))).toMatchObject({ age: 9, age_as_of: '2024-03-01', is_minor: 1 });
        expect(profile(await convertedProfileId(inlineKey('pedro', 'pm2')))).toMatchObject({ age: 41, age_as_of: '2025-01-15', is_minor: 0 });
    });
});

describe('final fix D1(b) — an old build merged a host whose members were already converted', () => {
    const RAUL_PHONE = '+54 11 8100 0001';
    const raul: Member = { id: 'orig-1', name: 'Raúl Gómez', relationship: 'partner', addedBy: OTHER_OWNER, contactEntries: [{ id: 'r1', type: 'phone', value: RAUL_PHONE, addedBy: OTHER_OWNER }] };
    const oldBuildMerge = (absorbed: string, survivor: string) => {
        sqlite.prepare(`UPDATE adopters SET deleted_at = 6000, token_hash = 'MERGED' WHERE id = ?`).run(absorbed);
        sqlite.prepare(`INSERT INTO audit_log (id, user_id, user_email, action, target, details, created_at) VALUES (?, ?, ?, 'adopter_merge', ?, ?, 6000)`)
            .run(`audit-${absorbed}`, ADMIN, ADMIN, survivor, JSON.stringify({ primaryId: survivor, secondaryId: absorbed, secondaryName: 'x', mergeDetails: {}, undo: {} }));
    };

    it("the survivor's copy of the member reuses the profile the absorbed host's conversion made — nobody twice", async () => {
        adopter('ana2', 'Ana Gomez', { owner: OTHER_OWNER, members: [raul] });
        await getHouseholdsFor(db(), OTHER_OWNER, 'ana2'); // converted on a view, before the merge
        const made = await convertedProfileId(inlineKey('ana2', 'orig-1'));
        expect(profile(made)).toMatchObject({ name: 'Raúl Gómez' });
        // An old build merges ana2 into ana: the JSON copy (new ids, same content), no memberships moved.
        adopter('ana', 'Ana Gómez', { members: [{ ...raul, id: 'copy-1', contactEntries: [{ ...raul.contactEntries[0], id: 'r1-copy' }] }] });
        oldBuildMerge('ana2', 'ana');
        await getHouseholdsFor(db(), OWNER, 'ana');
        expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM adopters WHERE name = 'Raúl Gómez' AND deleted_at IS NULL`).get()!.n).toBe(1);
        expect(membershipsOfHost('ana').map(m => m.adopter_id)).toContain(made);
        expect(ledger().find(r => r.source_key === inlineKey('ana', 'copy-1'))).toMatchObject({ outcome: 'converted', profile_id: made, created_profile: 0 });
    });

    it('along the chain: ana2 → ana → bea', async () => {
        adopter('ana2', 'Ana Gomez', { owner: OTHER_OWNER, members: [raul] });
        await getHouseholdsFor(db(), OTHER_OWNER, 'ana2');
        const made = await convertedProfileId(inlineKey('ana2', 'orig-1'));
        adopter('ana', 'Ana Gómez', { members: [{ ...raul, id: 'copy-1' }] });
        oldBuildMerge('ana2', 'ana');
        adopter('bea', 'Ana Gómez B', { members: [{ ...raul, id: 'copy-2' }] });
        oldBuildMerge('ana', 'bea');
        await getHouseholdsFor(db(), OWNER, 'bea');
        expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM adopters WHERE name = 'Raúl Gómez' AND deleted_at IS NULL`).get()!.n).toBe(1);
        expect(membershipsOfHost('bea').map(m => m.adopter_id)).toContain(made);
    });
});

describe('final fix D2 — old-tab edits the conversion cannot replay are logged with ids', () => {
    beforeEach(() => {
        adopter('pedro', 'Pedro Paez', { members: [
            { id: 'pm1', name: 'Marta Paez', relationship: 'partner', addedBy: OWNER, contactEntries: [] },
            { id: 'pm2', name: 'Tomás Paez', relationship: 'child', addedBy: OWNER, contactEntries: [] },
        ] });
        adopter('rosa', 'Rosa Diaz');
    });
    const editInOldTab = (edit: (ms: Member[]) => Member[]) =>
        sqlite.prepare('UPDATE adopters SET household_members = ? WHERE id = ?').run(JSON.stringify(edit(hostMembersJson('pedro'))), 'pedro');
    const warned = (msg: string) => vi.mocked(logger.warn).mock.calls.filter(c => String(c[0]).includes(msg)).map(c => c[1]);

    it('a relationship change and a new profile link → warn with the host, member and profile ids', async () => {
        await ensureHostConverted(db(), 'pedro');
        vi.mocked(logger.warn).mockClear();
        editInOldTab(ms => ms.map(m => (m.id === 'pm1' ? { ...m, relationship: 'sibling' } : m.id === 'pm2' ? { ...m, profileId: 'rosa' } : m)));
        await ensureHostConverted(db(), 'pedro');
        expect(warned('relationship')).toEqual([expect.objectContaining({ hostId: 'pedro', memberId: 'pm1', profileId: expect.any(String) })]);
        expect(warned('link')).toEqual([expect.objectContaining({ hostId: 'pedro', memberId: 'pm2', linkedProfileId: 'rosa' })]);
    });

    it('a member an old tab removed from the JSON → warn with its ids (the membership stays)', async () => {
        await ensureHostConverted(db(), 'pedro');
        vi.mocked(logger.warn).mockClear();
        editInOldTab(ms => ms.filter(m => m.id !== 'pm2'));
        await ensureHostConverted(db(), 'pedro');
        expect(warned('removed')).toEqual([expect.objectContaining({ hostId: 'pedro', memberId: 'pm2', profileId: expect.any(String) })]);
    });
});

describe('final fix D1(b) — undo of that old merge after the copy reused the converted profile', () => {
    const RAUL_PHONE = '+54 11 8200 0001';
    const raul: Member = { id: 'orig-1', name: 'Raúl Gómez', relationship: 'partner', addedBy: OTHER_OWNER, contactEntries: [{ id: 'r1', type: 'phone', value: RAUL_PHONE, addedBy: OTHER_OWNER }] };

    it('the person leaves the survivor\'s home (once in the absorbed home), keeps its owner, and the survivor\'s grants on them go', async () => {
        adopter('ana2', 'Ana Gomez', { owner: OTHER_OWNER, members: [raul] });
        await getHouseholdsFor(db(), OTHER_OWNER, 'ana2'); // converted before the merge
        const made = await convertedProfileId(inlineKey('ana2', 'orig-1'));
        const homeA = membershipsOfHost('ana2')[0].household_id as string;
        // An old build merges ana2 into ana (OWNER's): the JSON copy, the soft delete, the old-shape undo payload.
        adopter('ana', 'Ana Gómez', { members: [{ ...raul, id: 'copy-1', contactEntries: [{ ...raul.contactEntries[0], id: 'r1-copy' }] }] });
        grant('g-ana-all', 'ana', GRANTEE, 'all_contact');
        sqlite.prepare(`UPDATE adopters SET deleted_at = 6000, token_hash = 'MERGED' WHERE id = 'ana2'`).run();
        const snap = profile('ana')!;
        const undo = {
            primarySnapshot: { contactInfo: snap.contact_info, contactEntries: snap.contact_entries, addressInfo: null, familyMembers: null, sourceUrl: null, isPublic: 0 },
            placementIds: [], adopterEventIds: [], imageIds: [], flagIds: [], historyIds: [], statsIds: [], formSubmissionIds: [], candidates: [], annotatedFlags: [],
            addedHouseholdMemberIds: ['copy-1'], householdLinks: [], householdLinkCorrections: [],
        };
        sqlite.prepare(`INSERT INTO audit_log (id, user_id, user_email, action, target, details, created_at) VALUES ('audit-d1b', ?, ?, 'adopter_merge', 'ana', ?, 6000)`)
            .run(ADMIN, ADMIN, JSON.stringify({ primaryId: 'ana', secondaryId: 'ana2', secondaryName: 'Ana Gomez', mergeDetails: {}, undo }));

        await getHouseholdsFor(db(), OWNER, 'ana'); // the survivor's view reuses Raúl's profile
        expect(membershipsOfHost('ana').map(m => m.adopter_id)).toContain(made);
        expect(liveGrantsOn(made).some(g => g.grantee_email === GRANTEE)).toBe(true);

        expect((await unmergeAdopters('audit-d1b', ADMIN)).success).toBe(true);
        expect(membershipsOfHost('ana').map(m => m.adopter_id)).not.toContain(made);
        expect(householdOf(homeA).filter(id => id === made)).toHaveLength(1);
        expect(profile(made)).toMatchObject({ added_by: OTHER_OWNER, deleted_at: null });
        expect(liveGrantsOn(made).some(g => g.grantee_email === GRANTEE)).toBe(false);
        expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM adopters WHERE name = 'Raúl Gómez' AND deleted_at IS NULL`).get()!.n).toBe(1);
        expect(vi.mocked(logger.error)).not.toHaveBeenCalled();
    });
});
