/**
 * Households as profiles, Task 7 — converting today's household data into the
 * new tables (spec «Migration», «Privacy carried over»). NOT a 'use server'
 * module: every export takes the actor / db as arguments, so none of it may be
 * a browser-callable endpoint (serverActionSurface.test.ts lists them).
 *
 * What is converted, once each (the ledger `household_conversions`, keyed by
 * source key, is what "converted" means — never the membership, which may be
 * removed on purpose afterwards):
 * - each inline member of a live host's `adopters.household_members` JSON →
 *   `inline:{hostId}:{memberId}`: a new profile (owner = the host's owner,
 *   name, contacts with their own `addedBy`, age, the host's `is_public`) in
 *   the host's own home, next to the host;
 * - each member that carries a `profileId` and has a `household_links` row →
 *   `link:{linkId}`: that profile (followed through merges: the link's
 *   `linked_adopter_id` first, else the member's `profileId`, then
 *   resolveMergedAdopterId) joins the host's home; the member's contacts the
 *   profile lacks are appended to it, credited as they were;
 * - each `household_link_corrections` row → `correction:{id}`: a
 *   `household_corrections` row for (the host's home, the corrected person).
 *
 * Privacy (Review Focus 1): for every viewer, what they could see of a
 * member's contacts on the host they still see on the member's profile, and
 * nothing else. A created profile is owned by the HOST's owner (same
 * privileged team), copies the host's `is_public`, every live `all_contact`
 * grant and every live `entry` grant on a moved value. A reused profile gets
 * per-value entry grants only (an `all_contact` copy would unmask the person's
 * own other contacts): for the host's entry grantees, its all_contact
 * grantees, its owner team and the teams whose received forms unlocked a
 * value. Grant ids are deterministic (`hcg:{hostId}:…:{targetId}…`), so a
 * re-run copies nothing twice and an old merge's undo can find what came from
 * which host.
 *
 * Nothing here writes `household_members`; the column is left as is. Members
 * an old tab adds to the JSON later (deploy skew) have no ledger row and are
 * converted on the next run or view. No notices: nothing new happened.
 *
 * D1: no IN (array) — per-row reads fanned out, bounded by the JSON caps.
 */
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import {
    adopters, auditLog, formSubmissions, householdConversions, householdCorrections, householdLinkCorrections, householdLinks,
    householdMemberships, piiAccessGrants,
} from '@/db/schema';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { runBatch } from '@/lib/dbBatch';
import { runAfterResponse } from '@/lib/background';
import { deserializeHouseholdMembers, type HouseholdMember } from '@/lib/householdMembers';
import { contactEntriesToBlob, deserializeContactEntries, normalizeEntryValue, stripRenameMarks, type ContactEntry } from '@/lib/contactEntries';
import { givenEntryHashes, hashEntryValue, isRealActorEmail } from '@/lib/piiAccess';
import { historyKindForOwner } from '@/lib/profilePrivilege';
import {
    dropHousemateCandidates, ensureHousehold, membershipById, membershipIn, membershipsOf, newMembershipId, ownHomeOf,
} from '@/lib/households';
import { MAX_HOUSEHOLD_MEMBERS, householdNameKey } from '@/domain/households';
import { hasMinimumIdentifier } from '@/domain/adopterIdentity';
import { realOwner } from '@/domain/dedupPair';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type LedgerRow = typeof householdConversions.$inferSelect;
type LinkRow = typeof householdLinks.$inferSelect;
type GrantRow = typeof piiAccessGrants.$inferSelect;

/** The lazy conversion's actor (a page view): a sentinel, never the viewer — nothing is credited to them. */
export const CONVERSION_ACTOR = 'system';
/** Hosts read per call of the bulk run (an upper bound; the work budget below is what stops a page). */
export const CONVERSION_DEFAULT_LIMIT = 25;
export const CONVERSION_MAX_LIMIT = 100;
/**
 * Members (and corrections) a bulk page may actually convert before it stops and hands back its cursor —
 * each is ~25–40 D1 subrequests, so a page stays well under one Workers invocation's ceiling. A host is never
 * split: the page stops after the host that reached the budget. Already-converted members cost no budget.
 */
export const CONVERSION_DEFAULT_BUDGET = 10;
export const CONVERSION_MAX_BUDGET = 25;
/** Hosts listing one profile through household_links that a view of that profile converts first. */
const MAX_LINKING_HOSTS = 20;

export const inlineKey = (hostId: string, memberId: string) => `inline:${hostId}:${memberId}`;
export const linkKey = (linkId: string) => `link:${linkId}`;
export const correctionKey = (correctionId: string) => `correction:${correctionId}`;
/** The household_corrections row a «No convive» correction became. */
export const convertedCorrectionId = (correctionId: string) => `hc-link-${correctionId}`;
/** Every grant the conversion wrote for a host's data starts with this. */
export const conversionGrantPrefix = (hostId: string) => `hcg:${hostId}:`;

export type ConversionSkipReason =
    /** No name and no contact — nothing a profile could be made of. Permanent. */
    | 'no_identifier'
    /** The member points at the host itself. Permanent. */
    | 'self_link'
    /** A gift recipient: the gift block shows it from its form (spec: no profile automatically). Permanent. */
    | 'gift_on_form'
    /** A gift recipient whose form isn't linked to the host any more: left in the JSON for Jon. Permanent. */
    | 'gift_without_form'
    /** The linked profile is deleted (not merged): retried on every run, in case it is restored. */
    | 'linked_profile_gone'
    /** The profile this conversion made before was deleted before it was placed. Retried. */
    | 'converted_profile_deleted'
    /** The host's household is full. Retried. */
    | 'household_full'
    /** A DB failure (logged with an errorId). Retried. */
    | 'failed';

const PERMANENT: ReadonlySet<ConversionSkipReason> = new Set(['no_identifier', 'self_link', 'gift_on_form', 'gift_without_form']);

/** `updated`: converted before; an old tab added contacts to the member since, and those were carried over now. */
export type MemberOutcome = 'created' | 'reused' | 'updated' | 'already' | 'skipped';

/** One member (or correction) in the report: ids and reasons only, never names or contacts. */
export type MemberReport = {
    hostId: string;
    memberId: string | null;
    linkId: string | null;
    sourceKey: string;
    outcome: MemberOutcome;
    /** A skip reason, or how the person was found: 'created' | 'linked' | 'same_name' | 'correction'. */
    reason?: string;
    profileId?: string | null;
    householdId?: string | null;
    grantsCopied: number;
    /**
     * Things Jon should know about this member:
     * - `public_host_reused_profile`: the host is «público», the member's profile is not — viewers who saw these
     *   contacts only because the host was public no longer do (per-entry «público» is never stamped: it
     *   ignores ENABLE_PUBLIC_PROFILES and would outlive the host going protected).
     */
    notes?: string[];
    errorId?: string;
};

export type HostConversion = {
    hostId: string;
    /** False: the host is missing or soft-deleted — nothing converted. */
    live: boolean;
    members: MemberReport[];
    corrections: MemberReport[];
    /** Members / corrections that failed this time (retried next time). */
    failed: number;
    /**
     * Members that are still only in the JSON and must not be left behind on a soft-deleted row: failed, plus
     * `household_full` and `converted_profile_deleted`. A merge refuses while this is > 0.
     */
    blocked: number;
};

export type ConversionReport = {
    dryRun: boolean;
    /** Live hosts looked at in this call. */
    hosts: number;
    /** Inline members on those hosts (each JSON member once, linked or not). */
    members: number;
    createdProfiles: number;
    reusedProfiles: number;
    alreadyConverted: number;
    /** Converted members an old tab added contacts to since: those contacts carried over now. */
    updatedMembers: number;
    grantsCopied: number;
    corrections: number;
    skipped: Array<{ hostId: string; memberId: string | null; reason: string }>;
    failed: number;
    /** Soft-deleted hosts that still hold JSON members (old merges copied them to the survivor) — never converted. */
    deletedHostsSkipped: number;
    /** Pass as `cursor` for the next page; null when every host was looked at. */
    next: string | null;
    details: MemberReport[];
};

const lc = (e: string | null | undefined) => (e ?? '').trim().toLowerCase();

async function sha256Hex(s: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** The profile id a conversion makes for this source key — fixed, so a crashed run never makes the person twice. */
export async function convertedProfileId(sourceKey: string): Promise<string> {
    const h = await sha256Hex(`household-conversion|${sourceKey}`);
    // UUID-shaped (version 5 nibble, RFC variant) so every id validator accepts it.
    const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * A member's content without any id: name, relationship, linked profile,
 * adder, gift mark, age and contacts (type + normalized value). An old merge
 * copied the absorbed host's members onto the survivor under NEW ids with the
 * same content, so this is how its undo finds the original again; a permanent
 * skip is retried only when it changes.
 */
export async function memberFingerprint(m: HouseholdMember): Promise<string> {
    const contacts = m.contactEntries.map(e => `${e.type}|${normalizeEntryValue(e.type, e.value)}`).sort();
    return sha256Hex(JSON.stringify([
        householdNameKey(m.name), m.relationship ?? '', m.profileId ?? '', lc(m.addedBy), m.giftRecipient === true, m.age ?? null, contacts,
    ]));
}

/**
 * The entries a member's contacts become on a profile: stored shape only (no
 * view marks), and never a rename alias — a pre-release API import could store
 * a client's `addedBy` (or flag) on a relative's alias; only the server's
 * rename code marks one (residual of final fix S2).
 */
function storedEntries(entries: ContactEntry[]): ContactEntry[] {
    return stripRenameMarks(entries.map(e => {
        const { own: _own, masked: _masked, ...rest } = e as ContactEntry & { own?: boolean };
        return rest;
    }));
}

/** Entry refs (pii_access_grants.entry_ref) of the values a member's contacts carry. Aliases are never masked. */
function refsOf(entries: ReadonlyArray<Pick<ContactEntry, 'type' | 'value'>>): Set<string> {
    return new Set(entries.filter(e => e.type !== 'alias').map(e => hashEntryValue(e.type, e.value)));
}

/** The ledger's record of which of a member's contacts were carried over (aliases included). */
function contactRefsJson(entries: ReadonlyArray<Pick<ContactEntry, 'type' | 'value'>>, plus: Iterable<string> = []): string {
    return JSON.stringify([...new Set([...plus, ...entries.map(e => hashEntryValue(e.type, e.value))])].sort());
}
function recordedRefs(json: string | null | undefined): Set<string> {
    try {
        const v = JSON.parse(json ?? '[]');
        return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    } catch {
        return new Set(); // our own column; unreadable = nothing recorded (every contact is offered again, deduped by value)
    }
}

type HostRow = { id: string; name: string; addedBy: string | null; isPublic: number | null; householdMembers: string | null; deletedAt: Date | null };
const HOST_COLS = {
    id: adopters.id, name: adopters.name, addedBy: adopters.addedBy, isPublic: adopters.isPublic,
    householdMembers: adopters.householdMembers, deletedAt: adopters.deletedAt,
};

async function hostRow(db: Db, id: string): Promise<HostRow | null> {
    return (await db.select(HOST_COLS).from(adopters).where(eq(adopters.id, id)).get() as HostRow | undefined) ?? null;
}

type ProfileRow = { id: string; name: string; addedBy: string | null; isPublic: number | null; contactEntries: string | null; deletedAt: Date | null; tokenHash: string | null };
async function profileRow(db: Db, id: string): Promise<ProfileRow | null> {
    return (await db.select({
        id: adopters.id, name: adopters.name, addedBy: adopters.addedBy, isPublic: adopters.isPublic,
        contactEntries: adopters.contactEntries, deletedAt: adopters.deletedAt, tokenHash: adopters.tokenHash,
    }).from(adopters).where(eq(adopters.id, id)).get() as ProfileRow | undefined) ?? null;
}

/** The live profile behind an id: itself, or the survivor of the merges it went through; null when deleted or gone. */
async function resolveLive(db: Db, id: string): Promise<string | null> {
    const row = await profileRow(db, id);
    if (!row) return null;
    if (!row.deletedAt) return row.id;
    if (row.tokenHash !== 'MERGED') return null;
    const { resolveMergedAdopterId } = await import('@/lib/mergedAdopterRedirect');
    return await resolveMergedAdopterId(id);
}

/**
 * The live profile the conversion already made for this member on a host that
 * was merged INTO `hostId` — directly or along the merge chain (each hop: the
 * live merge audits naming it as the survivor) — matched by the member's
 * content (fingerprint), since an old merge copied the member under a new id
 * (final fix D1). Null when there is none. Bounded: MAX_MERGE_HOPS hops, 20
 * merges a hop.
 */
async function profileFromAbsorbedHost(db: Db, hostId: string, fingerprint: string, ctx: Record<string, unknown>): Promise<string | null> {
    const { MAX_MERGE_HOPS } = await import('@/domain/mergeRedirect');
    const seen = new Set([hostId]);
    let frontier = [hostId];
    for (let hop = 0; hop < MAX_MERGE_HOPS && frontier.length; hop++) {
        const next: string[] = [];
        for (const survivor of frontier) {
            const rows = await db.select({ details: auditLog.details }).from(auditLog).where(and(
                eq(auditLog.action, 'adopter_merge'),
                eq(auditLog.target, survivor),
            )).limit(20).all() as Array<{ details: string | null }>;
            for (const r of rows) {
                let d: { secondaryId?: unknown; undoneAt?: unknown } = {};
                try { d = JSON.parse(r.details || '{}'); } catch {
                    logger.warn('householdConversion: unparseable merge audit row skipped', { ...ctx, survivor });
                    continue;
                }
                if (d.undoneAt || typeof d.secondaryId !== 'string' || seen.has(d.secondaryId)) continue;
                seen.add(d.secondaryId);
                next.push(d.secondaryId);
            }
        }
        for (const absorbed of next) {
            const hits = await db.select({ profileId: householdConversions.profileId }).from(householdConversions).where(and(
                eq(householdConversions.hostAdopterId, absorbed),
                eq(householdConversions.fingerprint, fingerprint),
                eq(householdConversions.outcome, 'converted'),
            )).limit(5).all() as Array<{ profileId: string | null }>;
            for (const h of hits) {
                const live = h.profileId ? await resolveLive(db, h.profileId) : null;
                if (live && live !== hostId) {
                    logger.info('householdConversion: an old merge\'s copy of a converted member reuses its profile', { ...ctx, absorbedHostId: absorbed, profileId: live });
                    return live;
                }
            }
        }
        frontier = next;
    }
    return null;
}

async function ledgerOf(db: Db, hostId: string): Promise<Map<string, LedgerRow>> {
    const rows = await db.select().from(householdConversions).where(eq(householdConversions.hostAdopterId, hostId)).all() as LedgerRow[];
    return new Map(rows.map(r => [r.sourceKey, r]));
}

async function ledgerRow(db: Db, key: string): Promise<LedgerRow | null> {
    return (await db.select().from(householdConversions).where(eq(householdConversions.sourceKey, key)).get() as LedgerRow | undefined) ?? null;
}

/** A permanent skip, recorded so it isn't retried until the member's content changes. Never overwrites a conversion. */
function recordSkip(db: Db, row: { key: string; hostId: string; memberId: string; linkId: string | null; reason: ConversionSkipReason; fingerprint: string; actor: string }) {
    const values = {
        sourceKey: row.key, hostAdopterId: row.hostId, memberId: row.memberId, linkId: row.linkId, outcome: 'skipped',
        reason: row.reason, fingerprint: row.fingerprint, actor: row.actor, convertedAt: new Date(),
    };
    return db.insert(householdConversions).values(values).onConflictDoUpdate({
        target: householdConversions.sourceKey,
        set: { reason: row.reason, fingerprint: row.fingerprint, actor: row.actor, convertedAt: values.convertedAt },
        setWhere: sql`${householdConversions.outcome} = 'skipped'`,
    });
}

// ───────────────────────────── Grants ─────────────────────────────

type GivenRow = { id: string; userId: string | null; email: string | null; phone: string | null };

/** What the host's visibility rests on, read once per host. */
type HostAccess = { grants: GrantRow[]; given: GivenRow[]; ownerTeam: string[] | null };

async function hostAccess(db: Db, host: HostRow): Promise<HostAccess> {
    const [grants, given] = await Promise.all([
        db.select().from(piiAccessGrants).where(and(eq(piiAccessGrants.adopterId, host.id), isNull(piiAccessGrants.revokedAt))).all() as Promise<GrantRow[]>,
        // «What the adopter gave you stays yours»: forms a team received, linked to the host, unlock equal values there.
        db.select({ id: formSubmissions.id, userId: formSubmissions.userId, email: formSubmissions.email, phone: formSubmissions.phone })
            .from(formSubmissions).where(eq(formSubmissions.linkedAdopterId, host.id)).limit(50).all() as Promise<GivenRow[]>,
    ]);
    return { grants, given, ownerTeam: null };
}

async function teamOf(email: string): Promise<string[]> {
    const { getOrgMemberEmailsFor } = await import('@/lib/orgMembership');
    return [...new Set([lc(email), ...(await getOrgMemberEmailsFor(email)).map(lc)].filter(Boolean))];
}

type GrantInsert = typeof piiAccessGrants.$inferInsert;

/**
 * The grants that carry the host's visibility of these values over to the
 * member's profile `targetId` (see the module comment). `created`: the target
 * is a profile this conversion made from the host's member (owned by the
 * host's owner) — it takes the host's all_contact grants as they are. Else the
 * target is someone's existing profile — per-value entry grants only.
 */
async function grantsFor(host: HostRow, access: HostAccess, targetId: string, refs: ReadonlySet<string>, created: boolean, actor: string): Promise<GrantInsert[]> {
    if (refs.size === 0 && !created) return [];
    const out = new Map<string, GrantInsert>();
    const prefix = conversionGrantPrefix(host.id);
    const add = (g: GrantInsert) => { if (!out.has(g.id)) out.set(g.id, g); };
    for (const g of access.grants) {
        const base = { adopterId: targetId, granteeEmail: g.granteeEmail, origin: g.origin, requestId: g.requestId, grantedByEmail: g.grantedByEmail, createdAt: g.createdAt ?? new Date() };
        if (g.scope === 'entry' && g.entryRef && refs.has(g.entryRef)) {
            add({ ...base, id: `${prefix}${g.id}:${targetId}`, scope: 'entry', entryRef: g.entryRef });
        } else if (g.scope === 'all_contact') {
            if (created) add({ ...base, id: `${prefix}${g.id}:${targetId}`, scope: 'all_contact', entryRef: null });
            else for (const ref of refs) add({ ...base, id: `${prefix}${g.id}:${targetId}:${ref}`, scope: 'entry', entryRef: ref });
        }
    }
    const synth = (kind: string, email: string, ref: string): GrantInsert => ({
        id: `${prefix}${kind}:${hashEntryValue('email', email)}:${targetId}:${ref}`, adopterId: targetId, granteeEmail: email,
        scope: 'entry', entryRef: ref, origin: 'household_conversion', grantedByEmail: actor, createdAt: new Date(),
    });
    // The host's owner team saw everything on the host; on someone else's profile they need the values granted.
    const owner = realOwner(host.addedBy);
    if (!created && owner && refs.size) {
        access.ownerTeam = access.ownerTeam ?? await teamOf(owner);
        for (const email of access.ownerTeam) for (const ref of refs) add(synth('team', email, ref));
    }
    // Forms a team received, linked to the host: the values they gave stay unlocked for that team.
    for (const s of access.given) {
        if (!isRealActorEmail(s.userId)) continue;
        const unlocked = [...givenEntryHashes([s])].filter(r => refs.has(r));
        if (!unlocked.length) continue;
        for (const email of await teamOf(s.userId)) for (const ref of unlocked) add(synth('given', email, ref));
    }
    return [...out.values()];
}

/** Write the grants (insert-or-ignore on their fixed ids); returns how many are new. Dry run: how many would be. */
async function writeGrants(db: Db, grants: GrantInsert[], dryRun: boolean): Promise<number> {
    let n = 0;
    for (const g of grants) {
        if (dryRun) {
            const there = await db.select({ id: piiAccessGrants.id }).from(piiAccessGrants).where(eq(piiAccessGrants.id, g.id)).get();
            if (!there) n++;
            continue;
        }
        const rows = await db.insert(piiAccessGrants).values(g).onConflictDoNothing().returning({ id: piiAccessGrants.id });
        n += rows.length;
    }
    return n;
}

// ───────────────────────────── One host ─────────────────────────────

export type ConvertHostOptions = {
    dryRun?: boolean;
    /** Who runs it: the admin (bulk) or CONVERSION_ACTOR (a view, a merge). Recorded in the ledger and the audit only. */
    actor?: string;
    /**
     * Each created profile's duplicate scan, after the response (default true). The bulk run passes false: its
     * pages stay within one invocation's subrequest budget, and Admin → Duplicates → Scan Now (the next step of
     * the runbook) scans every profile anyway.
     */
    scanDuplicates?: boolean;
};

type HostState = {
    host: HostRow;
    actor: string;
    dryRun: boolean;
    ledger: Map<string, LedgerRow>;
    access: HostAccess | null;
    home: string | null;
    /** Names already in the host's home (householdNameKey → profile id), for the same-name rule. */
    byName: Map<string, string> | null;
    gifts: Set<string> | null;
    touched: boolean;
    scanDuplicates: boolean;
};

async function accessOf(db: Db, st: HostState): Promise<HostAccess> {
    st.access = st.access ?? await hostAccess(db, st.host);
    return st.access;
}

/** The host's own home: read-only in a dry run (null = would be made), made on first need otherwise. */
async function homeOf(db: Db, st: HostState): Promise<string | null> {
    if (st.home) return st.home;
    st.home = st.dryRun ? await ownHomeOf(db, st.host.id) : await ensureHousehold(db, st.host.id, isRealActorEmail(st.actor) ? st.actor : null);
    return st.home;
}

async function namesInHome(db: Db, st: HostState): Promise<Map<string, string>> {
    if (st.byName) return st.byName;
    const byName = new Map<string, string>();
    const home = st.home ?? await ownHomeOf(db, st.host.id);
    if (home) {
        const rows = await membershipsOf(db, home, MAX_HOUSEHOLD_MEMBERS + 1);
        for (const m of rows) {
            if (m.adopterId === st.host.id) continue;
            const p = await profileRow(db, m.adopterId);
            if (p && !p.deletedAt && p.name?.trim()) byName.set(householdNameKey(p.name), p.id);
        }
    }
    st.byName = byName;
    return byName;
}

async function giftNames(db: Db, st: HostState): Promise<Set<string>> {
    if (st.gifts) return st.gifts;
    const { giftRecipientsOf } = await import('@/lib/giftRecipients');
    st.gifts = new Set((await giftRecipientsOf(db, st.host.id)).map(r => householdNameKey(r.name)));
    return st.gifts;
}

/**
 * Who a member with a `profileId` is, and the link row that recorded it
 * (household_links, unique per host member). The link counts while it still
 * names the member's profile — itself, or the survivor an old merge re-pointed
 * the link to while the JSON kept the absorbed id (D51); then the live profile
 * is followed through merges (resolveMergedAdopterId). A stale link (the
 * member points at someone else now) is ignored: the member's own profileId,
 * followed through merges, decides. Null profile: deleted, not merged.
 */
async function linkedTarget(db: Db, links: LinkRow[], m: HouseholdMember): Promise<{ link: LinkRow | null; profileId: string | null }> {
    const link = links.find(l => l.memberId === m.id) ?? null;
    const viaMember = await resolveLive(db, m.profileId!);
    if (!link) return { link: null, profileId: viaMember };
    if (link.linkedAdopterId === m.profileId) return { link, profileId: viaMember };
    const viaLink = await resolveLive(db, link.linkedAdopterId);
    if (viaLink && viaLink === viaMember) return { link, profileId: viaLink };
    // The JSON id is gone for good but the link was re-pointed by an old merge to a live survivor.
    if (!viaMember && viaLink) {
        const row = await profileRow(db, m.profileId!);
        if (row?.tokenHash === 'MERGED') return { link, profileId: viaLink };
    }
    return { link: null, profileId: viaMember };
}

/**
 * Append the member's contacts the reused profile lacks (compare-and-swap,
 * nothing on the profile is dropped or rewritten — rename aliases stay).
 * Returns the number appended (in a dry run: would be).
 */
async function appendContacts(db: Db, profileId: string, entries: ContactEntry[], dryRun: boolean, ctx: Record<string, unknown>): Promise<number | null> {
    if (!entries.length) return 0;
    const key = (e: Pick<ContactEntry, 'type' | 'value'>) => `${e.type}|${normalizeEntryValue(e.type, e.value)}`;
    const missingFrom = (json: string | null) => {
        const have = new Set(deserializeContactEntries(json).map(key));
        return entries.filter(e => !have.has(key(e)));
    };
    if (dryRun) {
        const row = await profileRow(db, profileId);
        return row && !row.deletedAt ? missingFrom(row.contactEntries).length : null;
    }
    const { casAdopterLists } = await import('@/lib/adopterListCas');
    const out = await casAdopterLists<number>(db, profileId, (row) => {
        const add = missingFrom(row.contactEntries);
        if (!add.length) return { result: 0 };
        const next = [...deserializeContactEntries(row.contactEntries), ...add.map(e => ({ ...e, id: crypto.randomUUID() }))];
        return { write: { contactEntries: JSON.stringify(next), contactInfo: contactEntriesToBlob(next) || null, tokenHash: null }, result: add.length };
    }, { op: 'householdConversion.appendContacts', ...ctx }, { requireLive: true });
    if (out.status === 'busy') throw new Error(`householdConversion: contacts not appended, profile busy (Error ID: ${out.errorId})`);
    return out.status === 'done' ? out.result : null;
}

/** Place the person in the host's home and record the conversion in ONE batch (the ledger row is what "converted" means). */
async function place(
    db: Db,
    st: HostState,
    p: { key: string; memberId: string; linkId: string | null; profileId: string; relationship: string | null; addedBy: string | null; fingerprint: string; contactRefs: string; createdProfile: boolean; ownerEmail: string | null; reason: string },
    ctx: Record<string, unknown>,
): Promise<{ householdId: string; membershipId: string | null }> {
    const home = (await homeOf(db, st))!;
    const existing = await membershipIn(db, home, p.profileId);
    if (!existing && (await membershipsOf(db, home, MAX_HOUSEHOLD_MEMBERS + 1)).length >= MAX_HOUSEHOLD_MEMBERS) {
        throw Object.assign(new Error('household full'), { full: true });
    }
    const membershipId = existing?.id ?? newMembershipId();
    const now = new Date();
    const ledger = db.insert(householdConversions).values({
        sourceKey: p.key, hostAdopterId: st.host.id, memberId: p.memberId, linkId: p.linkId, outcome: 'converted', reason: p.reason,
        fingerprint: p.fingerprint, contactRefs: p.contactRefs, householdId: home, membershipId, profileId: p.profileId, createdProfile: p.createdProfile ? 1 : 0,
        ownerEmail: p.ownerEmail, actor: st.actor, convertedAt: now,
    }).onConflictDoUpdate({
        // A permanent skip recorded earlier, whose member has changed since: it is converted now.
        target: householdConversions.sourceKey,
        set: { outcome: 'converted', reason: p.reason, fingerprint: p.fingerprint, contactRefs: p.contactRefs, householdId: home, membershipId, profileId: p.profileId, createdProfile: p.createdProfile ? 1 : 0, ownerEmail: p.ownerEmail, actor: st.actor, convertedAt: now },
        setWhere: sql`${householdConversions.outcome} = 'skipped'`,
    });
    if (existing) {
        await runBatch(db, [ledger]);
        logger.info('householdConversion: person already in the host\'s home, recorded', { ...ctx, householdId: home, membershipId });
        return { householdId: home, membershipId };
    }
    await runBatch(db, [
        db.insert(householdMemberships).values({
            id: membershipId, householdId: home, adopterId: p.profileId,
            relationship: p.relationship ?? 'unknown', relativeToAdopterId: st.host.id, giftRecipient: 0,
            addedBy: p.addedBy, addedAt: now, sourceKey: p.key,
            // The conversion is its own record: an add by the same person later must not fire «agregó a …» for it.
            recordedAt: now,
        }).onConflictDoNothing(),
        ledger,
    ]);
    const placed = await membershipById(db, membershipId);
    if (!placed) {
        // A racing run placed them first (pair or key taken): theirs stands, the ledger row says converted.
        const theirs = await membershipIn(db, home, p.profileId);
        logger.info('householdConversion: placed by a racing run, theirs kept', { ...ctx, householdId: home, membershipId: theirs?.id ?? null });
        if (theirs) await db.update(householdConversions).set({ membershipId: theirs.id }).where(eq(householdConversions.sourceKey, p.key));
        return { householdId: home, membershipId: theirs?.id ?? null };
    }
    // S3: only pairs the conversion's actor is privileged on both sides of (the system actor: none).
    await dropHousemateCandidates(db, home, p.profileId, { actor: st.actor });
    return { householdId: home, membershipId };
}

/** A created profile's likely duplicates → «Pendientes de revisar» (spec «Migration» 4), never the host or a housemate. */
async function scanDuplicates(db: Db, hostId: string, profileId: string, m: HouseholdMember, ctx: Record<string, unknown>): Promise<void> {
    await runAfterResponse('householdConversion.duplicates', async () => {
        const { findAndPersistDuplicateCandidates } = await import('@/app/actions/_adopterFactory');
        const { sameHousehold } = await import('@/lib/households');
        const first = (t: ContactEntry['type']) => m.contactEntries.find(e => e.type === t && e.value?.trim())?.value;
        await findAndPersistDuplicateCandidates(db, profileId, {
            name: m.name, phone: first('phone'), email: first('email'), documentId: first('id'),
            socials: m.contactEntries.filter(e => e.type === 'social').map(e => e.value),
        }, {
            skipPair: async other => other === hostId || await sameHousehold(db, profileId, other),
            limit: 5 + MAX_HOUSEHOLD_MEMBERS, keep: 5, ctx,
        });
    }, ctx);
}

/**
 * A member converted before whose JSON changed since — an old tab (deploy
 * skew) edited it. The contacts it gained are carried over: appended to the
 * person's profile (credited as the old tab wrote them) with the grants the
 * host's data gives on those values (the typist's contribution grant among
 * them). Only values the ledger has not recorded: a contact the owner removed
 * from the profile since stays removed. Other edits (name, relationship, a
 * removed member) are the profile's business now — not replayed (the JSON
 * is retired). Never throws (logged, retried next time).
 */
async function syncEditedMember(db: Db, st: HostState, m: HouseholdMember, row: LedgerRow, fingerprint: string, base: MemberReport): Promise<MemberReport> {
    const report: MemberReport = { ...base, linkId: row.linkId, sourceKey: row.sourceKey, outcome: 'already', reason: row.reason ?? undefined, profileId: row.profileId };
    const ctx = { hostId: st.host.id, memberId: m.id, sourceKey: row.sourceKey, profileId: row.profileId, actor: st.actor, dryRun: st.dryRun };
    try {
        await logUnreplayedEdits(db, m, row, ctx);
        const recorded = recordedRefs(row.contactRefs);
        const entries = storedEntries(m.contactEntries);
        const fresh = entries.filter(e => !recorded.has(hashEntryValue(e.type, e.value)));
        if (fresh.length) {
            // The person's profile now: the one converted, or the survivor it was merged into since.
            const target = row.profileId ? await resolveLive(db, row.profileId) : null;
            const appended = target ? await appendContacts(db, target, fresh, st.dryRun, { ...ctx, targetId: target }) : null;
            if (target === null || appended === null) {
                // Nowhere to put them yet (deleted, or gone mid-write): not marked as carried over — retried next time.
                logger.warn('householdConversion: an old tab\'s contacts for a converted member have no live profile to go to (retried)', { ...ctx, contacts: fresh.length });
                return report;
            }
            // Grants of a made profile copy as on creation only while it is still that profile (not merged into another).
            const grants = await grantsFor(st.host, await accessOf(db, st), target, refsOf(fresh), !!row.createdProfile && target === row.profileId, st.actor);
            report.grantsCopied = await writeGrants(db, grants, st.dryRun);
            if (appended && !st.dryRun) {
                const { tokenizeAdopter } = await import('@/lib/adopterTokenize');
                await tokenizeAdopter(target, { force: true });
            }
            report.outcome = 'updated';
            report.profileId = target;
            logger.info('householdConversion: contacts an old tab added to a converted member carried over', { ...ctx, targetId: target, contacts: fresh.length, appended, grants: report.grantsCopied });
        }
        if (!st.dryRun) {
            await db.update(householdConversions).set({ fingerprint, contactRefs: contactRefsJson(entries, recorded) })
                .where(and(eq(householdConversions.sourceKey, row.sourceKey), eq(householdConversions.outcome, 'converted'))).run();
        }
        return report;
    } catch (e) {
        const errorId = logger.error('householdConversion: an old tab\'s edit to a converted member not carried over (retried next time)', e, ctx);
        return { ...report, outcome: 'skipped', reason: 'failed', errorId };
    }
}

/**
 * What an old tab changed on a converted member that the conversion does NOT
 * replay (final fix D2): a relationship change, a new link to a profile. Logged
 * at warn with the ids (never names or contacts) so it can be fixed by hand.
 * Runs once per edit (syncEditedMember records the new fingerprint).
 */
async function logUnreplayedEdits(db: Db, m: HouseholdMember, row: LedgerRow, ctx: Record<string, unknown>): Promise<void> {
    if (row.membershipId) {
        const mem = await db.select({ relationship: householdMemberships.relationship }).from(householdMemberships)
            .where(eq(householdMemberships.id, row.membershipId)).get() as { relationship: string | null } | undefined;
        const told = m.relationship ?? 'unknown';
        if (mem && (mem.relationship ?? 'unknown') !== told) {
            logger.warn('householdConversion: an old tab changed a converted member\'s relationship — not replayed', { ...ctx, membershipId: row.membershipId, relationship: told, stored: mem.relationship ?? 'unknown' });
        }
    }
    if (m.profileId && m.profileId !== row.profileId) {
        const [to, was] = await Promise.all([resolveLive(db, m.profileId), row.profileId ? resolveLive(db, row.profileId) : Promise.resolve(null)]);
        if (to !== was) {
            logger.warn('householdConversion: an old tab linked a converted member to another profile — not replayed', { ...ctx, linkedProfileId: m.profileId });
        }
    }
}

/** Removed members already reported by this isolate (D2: warn once, not on every view). */
const reportedRemovals = new Set<string>();

/**
 * Converted members no longer in the host's JSON: an old tab removed them
 * (nothing new writes the JSON). Not replayed — the membership is the record
 * now — but logged at warn with the ids (final fix D2).
 */
function logRemovedMembers(hostId: string, ledger: ReadonlyMap<string, LedgerRow>, members: readonly HouseholdMember[]): void {
    const present = new Set(members.map(m => m.id));
    for (const row of ledger.values()) {
        if (row.outcome !== 'converted' || !row.memberId || row.linkId || !row.sourceKey.startsWith(inlineKey(hostId, ''))) continue;
        if (present.has(row.memberId) || reportedRemovals.has(row.sourceKey)) continue;
        reportedRemovals.add(row.sourceKey);
        logger.warn('householdConversion: an old tab removed a converted member from the household JSON — not replayed (the membership stays)', {
            hostId, memberId: row.memberId, sourceKey: row.sourceKey, membershipId: row.membershipId, profileId: row.profileId,
        });
    }
}

async function convertMember(db: Db, st: HostState, m: HouseholdMember, links: LinkRow[]): Promise<MemberReport> {
    const host = st.host;
    const fingerprint = await memberFingerprint(m);
    const base: MemberReport = { hostId: host.id, memberId: m.id, linkId: null, sourceKey: inlineKey(host.id, m.id), outcome: 'skipped', grantsCopied: 0 };

    // Converted already — under its inline key or its link's (a link recorded after its inline conversion, or the
    // reverse). Checked before anything is read: a converted host costs no query per member.
    const anyLink = links.find(l => l.memberId === m.id) ?? null;
    const prior = st.ledger.get(inlineKey(host.id, m.id)) ?? (anyLink ? st.ledger.get(linkKey(anyLink.id)) : undefined);
    if ((prior?.outcome === 'converted' || prior?.outcome === 'skipped') && prior.fingerprint === fingerprint) {
        return { ...base, linkId: prior.linkId, sourceKey: prior.sourceKey, outcome: 'already', reason: prior.reason ?? undefined, profileId: prior.profileId };
    }
    if (prior?.outcome === 'converted') return await syncEditedMember(db, st, m, prior, fingerprint, base);

    let key = base.sourceKey;
    let link: LinkRow | null = null;
    let ctx: Record<string, unknown> = { hostId: host.id, memberId: m.id, sourceKey: key, actor: st.actor, dryRun: st.dryRun };
    const skip = async (reason: ConversionSkipReason, errorId?: string): Promise<MemberReport> => {
        if (PERMANENT.has(reason) && !st.dryRun) {
            await runBatch(db, [recordSkip(db, { key, hostId: host.id, memberId: m.id, linkId: link?.id ?? null, reason, fingerprint, actor: st.actor })]);
        }
        logger.info('householdConversion: member skipped', { ...ctx, reason });
        return { ...base, linkId: link?.id ?? null, sourceKey: key, outcome: 'skipped', reason, ...(errorId ? { errorId } : {}) };
    };

    try {
        const linked = m.profileId ? await linkedTarget(db, links, m) : null;
        link = linked?.link ?? null;
        if (link) key = linkKey(link.id);
        ctx = { ...ctx, linkId: link?.id ?? null, sourceKey: key };
        const report: MemberReport = { ...base, linkId: link?.id ?? null, sourceKey: key };
        // Converted under this key from another host (an old merge moved the link, its undo moved it back).
        const elsewhere = st.ledger.get(key) ?? await ledgerRow(db, key);
        if (elsewhere?.outcome === 'converted') {
            if (elsewhere.fingerprint === fingerprint) return { ...report, outcome: 'already', reason: elsewhere.reason ?? undefined, profileId: elsewhere.profileId };
            return await syncEditedMember(db, st, m, elsewhere, fingerprint, report);
        }
        if (m.giftRecipient) {
            return await skip((await giftNames(db, st)).has(householdNameKey(m.name)) ? 'gift_on_form' : 'gift_without_form');
        }
        const entries = storedEntries(m.contactEntries);
        const refs = refsOf(entries);
        const owner = host.addedBy ?? 'anonymous';
        const credit = realOwner(m.addedBy) ?? realOwner(host.addedBy);

        // Who they are: the linked profile (followed through merges), someone of that name already home, or a new profile.
        let profileId: string | null = null;
        let reason: 'linked' | 'same_name' | 'old_merge_copy' | null = null;
        if (linked) {
            profileId = linked.profileId;
            if (!profileId) return await skip('linked_profile_gone');
            if (profileId === host.id) return await skip('self_link');
            reason = 'linked';
        } else {
            if (!hasMinimumIdentifier({ name: m.name, contactEntries: entries.length ? JSON.stringify(entries) : null })) return await skip('no_identifier');
            const nk = householdNameKey(m.name);
            const same = nk ? (await namesInHome(db, st)).get(nk) : undefined;
            if (same) { profileId = same; reason = 'same_name'; }
        }

        const notes: string[] = [];
        let created = false;
        if (!profileId) {
            // An OLD build merged a host whose members were already converted, copying them here
            // under new ids (final fix D1): the copy is that same person — reuse their profile.
            const carried = await profileFromAbsorbedHost(db, host.id, fingerprint, ctx);
            if (carried) { profileId = carried; reason = 'old_merge_copy'; }
        }
        if (!profileId) {
            // A new profile, owned by the host's owner — exactly the team that saw the member on the host.
            const id = await convertedProfileId(key);
            const there = await profileRow(db, id);
            if (there?.deletedAt) return await skip('converted_profile_deleted');
            created = true;
            profileId = id;
            if (!there && !st.dryRun) {
                const { createHouseholdProfile } = await import('@/app/actions/_adopterFactory');
                const home = await homeOf(db, st);
                try {
                    await createHouseholdProfile(db, {
                        id, ownerEmail: owner, actor: credit ?? owner, name: m.name, contactEntries: entries,
                        age: m.age ?? null, ageAsOf: m.ageAsOf ?? null, isPublic: !!host.isPublic,
                        historyKind: await historyKindForOwner(credit ?? owner, owner, ctx),
                        history: { created_in_household: { anchorId: host.id, anchorName: host.name, householdId: home, gift: false, via: 'conversion' } },
                    });
                } catch (e) {
                    // Another run made it a moment earlier (the id is fixed): use theirs.
                    if (!(await profileRow(db, id))) throw e;
                    logger.info('householdConversion: profile made by a racing run, reused', { ...ctx, profileId: id });
                }
                const { logAudit } = await import('@/lib/audit');
                logAudit({ userEmail: st.actor, action: 'adopter_created', target: id, details: { via: 'household-conversion', hostId: host.id, sourceKey: key } });
            }
        } else {
            if (host.isPublic && refs.size) {
                const target = await profileRow(db, profileId);
                if (target && !target.isPublic) notes.push('public_host_reused_profile');
            }
            const appended = await appendContacts(db, profileId, entries, st.dryRun, { ...ctx, profileId });
            if (appended && !st.dryRun) {
                const { tokenizeAdopter } = await import('@/lib/adopterTokenize');
                await tokenizeAdopter(profileId, { force: true });
            }
        }

        // Visibility carried over before the placing batch: a crash in between leaves grants that a re-run rewrites as no-ops.
        const grants = await grantsFor(host, await accessOf(db, st), profileId, refs, created, st.actor);
        report.grantsCopied = await writeGrants(db, grants, st.dryRun);

        if (st.dryRun) {
            if (reason === 'same_name' || created) (await namesInHome(db, st)).set(householdNameKey(m.name), profileId);
            return { ...report, outcome: created ? 'created' : 'reused', reason: reason ?? undefined, profileId, householdId: await homeOf(db, st), ...(notes.length ? { notes } : {}) };
        }
        await namesInHome(db, st);
        const placed = await place(db, st, {
            key, memberId: m.id, linkId: link?.id ?? null, profileId, relationship: m.relationship, addedBy: credit,
            fingerprint, contactRefs: contactRefsJson(entries), createdProfile: created, ownerEmail: created ? owner : null, reason: created ? 'created' : reason!,
        }, ctx);
        if (m.name.trim()) st.byName?.set(householdNameKey(m.name), profileId);
        st.touched = true;
        if (created && st.scanDuplicates) await scanDuplicates(db, host.id, profileId, m, { ...ctx, profileId });
        logger.info('householdConversion: member converted', { ...ctx, profileId, householdId: placed.householdId, created, reason, grants: report.grantsCopied });
        return { ...report, outcome: created ? 'created' : 'reused', reason: reason ?? undefined, profileId, householdId: placed.householdId, ...(notes.length ? { notes } : {}) };
    } catch (e) {
        if ((e as { full?: boolean }).full) {
            logger.warn('householdConversion: host\'s household full, member not converted', { ...ctx, cap: MAX_HOUSEHOLD_MEMBERS });
            return await skip('household_full');
        }
        const errorId = logger.error('householdConversion: member not converted (retried next time)', e, ctx);
        return { ...base, linkId: link?.id ?? null, sourceKey: key, outcome: 'skipped', reason: 'failed', errorId };
    }
}

async function convertCorrection(db: Db, st: HostState, c: typeof householdLinkCorrections.$inferSelect): Promise<MemberReport> {
    const key = correctionKey(c.id);
    const report: MemberReport = { hostId: st.host.id, memberId: c.memberId, linkId: null, sourceKey: key, outcome: 'already', reason: 'correction', grantsCopied: 0 };
    const ctx = { hostId: st.host.id, correctionId: c.id, actor: st.actor, dryRun: st.dryRun };
    if (st.ledger.has(key)) return report;
    try {
        const adopterId = (await resolveLive(db, c.linkedAdopterId)) ?? c.linkedAdopterId;
        const home = await homeOf(db, st);
        if (st.dryRun) return { ...report, outcome: 'created', profileId: adopterId, householdId: home };
        const now = new Date();
        await runBatch(db, [
            db.insert(householdCorrections).values({
                id: convertedCorrectionId(c.id), householdId: home!, adopterId, correctedBy: c.correctedBy,
                correctedAt: c.createdAt ?? now, snapshot: c.memberSnapshot,
            }).onConflictDoNothing(),
            db.insert(householdConversions).values({
                sourceKey: key, hostAdopterId: st.host.id, memberId: c.memberId, outcome: 'converted', reason: 'correction',
                householdId: home, profileId: adopterId, actor: st.actor, convertedAt: now,
            }).onConflictDoNothing(),
        ]);
        logger.info('householdConversion: «No convive» correction converted', { ...ctx, householdId: home, profileId: adopterId });
        return { ...report, outcome: 'created', profileId: adopterId, householdId: home };
    } catch (e) {
        const errorId = logger.error('householdConversion: correction not converted (retried next time)', e, ctx);
        return { ...report, outcome: 'skipped', reason: 'failed', errorId };
    }
}

/**
 * Convert one host: its inline members, their links and its «No convive»
 * corrections. Idempotent; cheap when nothing is left (one read each of the
 * host, its ledger, its links and its corrections). Throws only when those
 * first reads fail; each member's own failure is logged and reported
 * (`failed`), and retried next time.
 */
export async function convertHost(db: Db, hostId: string, opts: ConvertHostOptions = {}): Promise<HostConversion> {
    const out: HostConversion = { hostId, live: false, members: [], corrections: [], failed: 0, blocked: 0 };
    const host = await hostRow(db, hostId);
    if (!host || host.deletedAt) return out;
    out.live = true;
    const members = deserializeHouseholdMembers(host.householdMembers);
    const [ledger, links, corrections] = await Promise.all([
        ledgerOf(db, hostId),
        members.some(m => m.profileId)
            ? db.select().from(householdLinks).where(eq(householdLinks.hostAdopterId, hostId)).orderBy(asc(householdLinks.createdAt), asc(householdLinks.id)).all() as Promise<LinkRow[]>
            : Promise.resolve([] as LinkRow[]),
        db.select().from(householdLinkCorrections).where(eq(householdLinkCorrections.hostAdopterId, hostId)).all() as Promise<Array<typeof householdLinkCorrections.$inferSelect>>,
    ]);
    logRemovedMembers(hostId, ledger, members);
    if (members.length === 0 && corrections.length === 0) return out;
    const st: HostState = {
        host, actor: opts.actor ?? CONVERSION_ACTOR, dryRun: opts.dryRun === true, ledger,
        access: null, home: null, byName: null, gifts: null, touched: false, scanDuplicates: opts.scanDuplicates !== false,
    };
    // Members in their JSON order (one at a time: the same-name rule and the cap see the ones before).
    for (const m of members) {
        const r = await convertMember(db, st, m, links);
        if (r.reason === 'failed') out.failed++;
        if (r.outcome === 'skipped' && (r.reason === 'failed' || r.reason === 'household_full' || r.reason === 'converted_profile_deleted')) out.blocked++;
        out.members.push(r);
    }
    for (const c of corrections) {
        const r = await convertCorrection(db, st, c);
        if (r.reason === 'failed') { out.failed++; out.blocked++; }
        out.corrections.push(r);
    }
    if (st.touched) {
        // Under v8 the host's tokens no longer carry its members': re-index it now that they are profiles.
        const { tokenizeAdopter } = await import('@/lib/adopterTokenize');
        await tokenizeAdopter(hostId, { force: true });
        const { logAudit } = await import('@/lib/audit');
        const count = (o: MemberOutcome) => out.members.filter(r => r.outcome === o).length;
        logAudit({ userEmail: st.actor, action: 'household_converted', target: hostId, details: { householdId: st.home, created: count('created'), reused: count('reused'), skipped: count('skipped') } });
    }
    return out;
}

/**
 * The same conversion for one host, for the read and write paths (a view, a
 * merge, an add). `getHouseholdsFor` runs it before reading (through
 * ensureProfileConverted), so a profile is right from its first view after
 * the release and a member an old tab writes later is picked up on the next
 * view. Throws when the host's first reads fail; members' failures are in the
 * result (`failed`) and logged.
 */
export async function ensureHostConverted(db: Db, hostId: string, actor: string = CONVERSION_ACTOR): Promise<HostConversion> {
    return convertHost(db, hostId, { actor });
}

/**
 * Before a profile's households are read: convert it as a host, and convert
 * the hosts whose household_links name it (so Marta's page shows Pedro even
 * before Pedro's is viewed). Throws on a DB failure; callers log it.
 */
export async function ensureProfileConverted(db: Db, adopterId: string, actor: string = CONVERSION_ACTOR): Promise<{ failed: number; blocked: number }> {
    const own = await ensureHostConverted(db, adopterId, actor);
    let failed = own.failed;
    let blocked = own.blocked;
    const linking = await db.select({ hostAdopterId: householdLinks.hostAdopterId }).from(householdLinks)
        .where(eq(householdLinks.linkedAdopterId, adopterId)).limit(MAX_LINKING_HOSTS).all() as Array<{ hostAdopterId: string }>;
    for (const hostId of [...new Set(linking.map(l => l.hostAdopterId))]) {
        if (hostId === adopterId) continue;
        const h = await ensureHostConverted(db, hostId, actor);
        failed += h.failed;
        blocked += h.blocked;
    }
    return { failed, blocked };
}

/**
 * The bulk run (admin route; Jon approves it on production): every live host
 * with inline members or «No convive» corrections, a page at a time
 * (`cursor` = the last host id of the previous page), each page bounded by a
 * work budget (members actually converted, CONVERSION_DEFAULT_BUDGET). Created
 * profiles' duplicate scans are left to Admin → Duplicates → Scan Now, the
 * runbook's next step (not this invocation's budget). `dryRun`: reads only —
 * the per-member report of what would happen, nothing written. Idempotent.
 */
export async function convertInlineHouseholds(
    db: Db,
    opts: { dryRun: boolean; actor: string; cursor?: string | null; limit?: number; budget?: number },
): Promise<ConversionReport> {
    const limit = Math.max(1, Math.min(CONVERSION_MAX_LIMIT, Math.floor(opts.limit ?? CONVERSION_DEFAULT_LIMIT)));
    const budget = Math.max(1, Math.min(CONVERSION_MAX_BUDGET, Math.floor(opts.budget ?? CONVERSION_DEFAULT_BUDGET)));
    const cursor = opts.cursor ?? '';
    const report: ConversionReport = {
        dryRun: opts.dryRun, hosts: 0, members: 0, createdProfiles: 0, reusedProfiles: 0, alreadyConverted: 0, updatedMembers: 0, grantsCopied: 0,
        corrections: 0, skipped: [], failed: 0, deletedHostsSkipped: 0, next: null, details: [],
    };
    const hasJson = sql`${adopters.householdMembers} IS NOT NULL AND trim(${adopters.householdMembers}) NOT IN ('', '[]')`;
    const [withJson, withCorrections, deleted] = await Promise.all([
        db.select({ id: adopters.id }).from(adopters)
            .where(and(isNull(adopters.deletedAt), hasJson, gt(adopters.id, cursor)))
            .orderBy(asc(adopters.id)).limit(limit + 1).all() as Promise<Array<{ id: string }>>,
        db.selectDistinct({ id: householdLinkCorrections.hostAdopterId }).from(householdLinkCorrections)
            .where(gt(householdLinkCorrections.hostAdopterId, cursor))
            .orderBy(asc(householdLinkCorrections.hostAdopterId)).limit(limit + 1).all() as Promise<Array<{ id: string }>>,
        cursor ? Promise.resolve(null) : db.select({ n: sql<number>`COUNT(*)` }).from(adopters)
            .where(and(sql`${adopters.deletedAt} IS NOT NULL`, hasJson)).get() as Promise<{ n: number } | undefined>,
    ]);
    report.deletedHostsSkipped = deleted?.n ?? 0;
    const ids = [...new Set([...withJson, ...withCorrections].map(r => r.id))].sort();
    const page = ids.slice(0, limit);
    report.next = ids.length > limit ? page[page.length - 1] : null;

    let work = 0;
    for (let i = 0; i < page.length; i++) {
        const hostId = page[i];
        // The budget is spent: stop after the previous host; the next page starts here.
        if (work >= budget) {
            report.next = page[i - 1];
            break;
        }
        let h: HostConversion;
        try {
            h = await convertHost(db, hostId, { dryRun: opts.dryRun, actor: opts.actor, scanDuplicates: false });
        } catch (e) {
            work++;
            const errorId = logger.error('convertInlineHouseholds: host not converted (retried next run)', e, { hostId, actor: opts.actor, dryRun: opts.dryRun });
            report.failed++;
            report.skipped.push({ hostId, memberId: null, reason: 'failed' });
            report.details.push({ hostId, memberId: null, linkId: null, sourceKey: `host:${hostId}`, outcome: 'skipped', reason: 'failed', grantsCopied: 0, errorId });
            continue;
        }
        if (!h.live) continue;
        report.hosts++;
        report.members += h.members.length;
        report.failed += h.failed;
        for (const r of [...h.members, ...h.corrections]) {
            if (r.outcome !== 'already') work++;
            report.details.push(r);
            report.grantsCopied += r.grantsCopied;
            if (r.reason === 'correction') { if (r.outcome === 'created') report.corrections++; continue; }
            if (r.outcome === 'created') report.createdProfiles++;
            else if (r.outcome === 'reused') report.reusedProfiles++;
            else if (r.outcome === 'already') report.alreadyConverted++;
            else if (r.outcome === 'updated') report.updatedMembers++;
            else report.skipped.push({ hostId, memberId: r.memberId, reason: r.reason ?? 'failed' });
        }
    }
    logger.info('convertInlineHouseholds: page done', {
        actor: opts.actor, dryRun: opts.dryRun, cursor: cursor || null, hosts: report.hosts, members: report.members,
        created: report.createdProfiles, reused: report.reusedProfiles, already: report.alreadyConverted, updated: report.updatedMembers,
        skipped: report.skipped.length, failed: report.failed, grants: report.grantsCopied, work, budget, next: report.next,
    });
    return report;
}

// ─────────────────── Undo of a merge recorded before the release ───────────────────

/** What an old-shape merge undo payload says moved (src/lib/adopterMerge.ts, pre-release fields). */
export type OldMergeHouseholdUndo = {
    survivorId: string;
    absorbedId: string;
    /** The ids the absorbed host's members got on the survivor (copies with new ids, same content). */
    addedMemberIds: string[];
    /** household_links rows the merge moved, as they were before it. */
    movedLinks: Array<{ id: string; hostAdopterId: string; linkedAdopterId: string; memberId: string }>;
    /** household_link_corrections rows the merge moved, as they were before it. */
    movedCorrections: Array<{ id: string; hostAdopterId: string; linkedAdopterId: string }>;
};

/**
 * Move one membership (compare-and-set on where it is now); when the person is
 * already where it should go, the row is dropped instead (one membership per
 * person and household). Returns false when the row is not where the
 * conversion left it (removed or moved since): it stays as it is now.
 */
async function moveMembership(
    db: Db,
    membershipId: string | null,
    from: { householdId: string; adopterId: string },
    to: { householdId: string; adopterId: string; sourceKey?: string; relativeFrom?: string; relativeTo?: string },
    ctx: Record<string, unknown>,
): Promise<'moved' | 'dropped' | 'gone'> {
    const m = membershipId ? await membershipById(db, membershipId) : null;
    if (!m || m.householdId !== from.householdId || m.adopterId !== from.adopterId) {
        logger.info('householdConversion.undo: membership changed since the conversion, left as it is', { ...ctx, membershipId });
        return 'gone';
    }
    const where = and(eq(householdMemberships.id, m.id), eq(householdMemberships.householdId, from.householdId), eq(householdMemberships.adopterId, from.adopterId));
    const there = await membershipIn(db, to.householdId, to.adopterId);
    if (there && there.id !== m.id) {
        await db.delete(householdMemberships).where(where).run();
        return 'dropped';
    }
    const relative = to.relativeFrom !== undefined && m.relativeToAdopterId === to.relativeFrom ? (to.relativeTo ?? null) : m.relativeToAdopterId;
    const won = await db.update(householdMemberships).set({
        householdId: to.householdId, adopterId: to.adopterId,
        relativeToAdopterId: relative === to.adopterId ? null : relative,
        ...(to.sourceKey ? { sourceKey: to.sourceKey } : {}),
    }).where(where).returning({ id: householdMemberships.id });
    return won.length ? 'moved' : 'gone';
}

/**
 * What a ledger row alone placed: its membership (not when it reused someone of
 * the same name already home, or another row points at the same membership),
 * its profile (made by it and no other row uses it) and the host's grants on
 * that profile (no other row of the same host uses the profile). An undo only
 * moves / re-owns / revokes what the row alone owns.
 */
async function ownership(db: Db, row: LedgerRow): Promise<{ membership: boolean; profile: boolean; grants: boolean }> {
    const others = (await db.select().from(householdConversions).where(eq(householdConversions.profileId, row.profileId!)).all() as LedgerRow[])
        .filter(o => o.sourceKey !== row.sourceKey && o.outcome === 'converted');
    return {
        membership: row.reason !== 'same_name' && !others.some(o => o.membershipId && o.membershipId === row.membershipId),
        profile: row.reason !== 'same_name' && others.length === 0,
        grants: !others.some(o => o.hostAdopterId === row.hostAdopterId),
    };
}

/** Take back the grants the conversion wrote on `targetId` for `hostId`'s data (only those: their ids say so). */
async function revokeConversionGrants(db: Db, hostId: string, targetId: string, actor: string): Promise<void> {
    const prefix = conversionGrantPrefix(hostId);
    await db.update(piiAccessGrants).set({ revokedAt: new Date(), revokedByEmail: actor }).where(and(
        eq(piiAccessGrants.adopterId, targetId),
        sql`substr(${piiAccessGrants.id}, 1, ${prefix.length}) = ${prefix}`,
        isNull(piiAccessGrants.revokedAt),
    )).run();
}

/**
 * The undo of a merge recorded BEFORE this release, run after the conversion
 * (unmergeAdopters step 3e, after the old JSON and links are restored). The
 * old payload only knows the JSON and the link rows; once the survivor was
 * converted those people are memberships in the survivor's home too, so:
 * - each member the merge copied onto the survivor (`inline:{S}:{copy}`) is
 *   matched back to the absorbed host's original by content (fingerprint) and
 *   its membership moves to the absorbed profile's home under
 *   `inline:{A}:{original}` — the same profile, so whatever was added to it
 *   since stays. A profile the conversion made is re-owned to the absorbed
 *   profile's owner (compare-and-set on the owner it was given) and takes the
 *   absorbed host's «público»; the grants copied from the survivor's data are
 *   taken back and the absorbed host's are copied.
 * - each link the merge moved off the absorbed host: its membership moves to
 *   the absorbed profile's home; each link that named the absorbed profile:
 *   its membership names the absorbed profile again (grants likewise).
 * - each «No convive» correction it moved goes back with it.
 * A membership removed or moved since stays as it is now (Task 6's rule); the
 * ledger then records the original as converted so the absorbed host's old
 * JSON does not bring that person back. Re-running converges. Throws on a DB
 * failure (the unmerge is retried).
 */
export async function reverseConvertedOldMerge(db: Db, undo: OldMergeHouseholdUndo, actor: string, ctx: Record<string, unknown> = {}): Promise<{ moved: number; dropped: number; left: number }> {
    const { survivorId: S, absorbedId: A } = undo;
    const out = { moved: 0, dropped: 0, left: 0 };
    const [absorbed, survivor] = await Promise.all([hostRow(db, A), hostRow(db, S)]);
    // Run while the absorbed profile is still soft-deleted (unmergeAdopters does it before reviving it), so no
    // view converts it from its own JSON in between; a retried undo finds it revived — handled per member below.
    if (!absorbed || !survivor) {
        logger.warn('householdConversion.undo: a profile of the undone merge is missing, nothing reversed', { ...ctx, survivorId: S, absorbedId: A });
        return out;
    }
    const tally = (r: 'moved' | 'dropped' | 'gone') => { if (r === 'moved') out.moved++; else if (r === 'dropped') out.dropped++; else out.left++; };
    const absorbedMembers = deserializeHouseholdMembers(absorbed.householdMembers);
    let homeA: string | null = null;
    const home = async () => (homeA = homeA ?? await ensureHousehold(db, A, isRealActorEmail(actor) ? actor : null));
    let accessA: HostAccess | null = null;
    const access = async () => (accessA = accessA ?? await hostAccess(db, absorbed));

    // 1. Members copied onto the survivor, matched back by content.
    const byFingerprint = new Map<string, HouseholdMember[]>();
    for (const m of absorbedMembers) {
        const fp = await memberFingerprint(m);
        byFingerprint.set(fp, [...(byFingerprint.get(fp) ?? []), m]);
    }
    for (const copyId of undo.addedMemberIds) {
        const row = await ledgerRow(db, inlineKey(S, copyId));
        if (!row || row.outcome !== 'converted' || !row.profileId) continue;
        const P = row.profileId;
        const c = { ...ctx, survivorId: S, absorbedId: A, sourceKey: row.sourceKey, profileId: P };
        const original = row.fingerprint ? byFingerprint.get(row.fingerprint)?.shift() : undefined;
        if (!original) {
            logger.warn('householdConversion.undo: a copied member matches nobody on the absorbed host, left on the survivor', c);
            out.left++;
            continue;
        }
        const own = await ownership(db, row);
        const targetKey = inlineKey(A, original.id);
        const target = await ledgerRow(db, targetKey);
        if (target?.outcome === 'converted') {
            if (target.profileId === P) {
                // The absorbed host's own conversion made this profile, and the copy on the survivor
                // reused it (final fix D1(b)): the person already lives in the absorbed home — the
                // survivor's membership and the survivor's grants on them go. On a re-run there is
                // nothing left to take (the membership is gone or no longer the survivor's).
                if (row.reason === 'old_merge_copy') {
                    if (own.membership && row.householdId && row.membershipId) {
                        const gone = await db.delete(householdMemberships).where(and(
                            eq(householdMemberships.id, row.membershipId), eq(householdMemberships.householdId, row.householdId), eq(householdMemberships.adopterId, P),
                        )).returning({ id: householdMemberships.id });
                        if (gone.length) out.dropped++;
                    }
                    if (own.grants) await revokeConversionGrants(db, S, P, actor);
                    logger.info('householdConversion.undo: the reused copy left the survivor\'s home; the person stays in the absorbed home', c);
                }
                continue; // a re-run
            }
            // The revived absorbed host was converted from its own JSON meanwhile (a retried undo): the person lives
            // there already as another profile, so the copy leaves the survivor's home. The copy's profile is left
            // for the duplicate review (logged).
            if (own.membership && row.householdId && row.membershipId) {
                await db.delete(householdMemberships).where(and(
                    eq(householdMemberships.id, row.membershipId), eq(householdMemberships.householdId, row.householdId), eq(householdMemberships.adopterId, P),
                )).run();
                out.dropped++;
            }
            if (own.grants) await revokeConversionGrants(db, S, P, actor);
            logger.warn('householdConversion.undo: the absorbed host was converted meanwhile; the copy left the survivor\'s home, its profile stays for review', { ...c, otherProfileId: target.profileId });
            continue;
        }
        const hh = await home();
        let r: 'moved' | 'dropped' | 'gone' | 'added';
        if (own.membership) {
            r = row.householdId
                ? await moveMembership(db, row.membershipId, { householdId: row.householdId, adopterId: P }, { householdId: hh, adopterId: P, sourceKey: targetKey, relativeFrom: S, relativeTo: A }, c)
                : 'gone';
        } else {
            // The copy was converted onto a person the survivor already had (same name): the survivor keeps them,
            // and the absorbed home gets them too — one person, two homes.
            const there = await membershipIn(db, hh, P);
            if (!there) {
                await db.insert(householdMemberships).values({
                    id: newMembershipId(), householdId: hh, adopterId: P, relationship: original.relationship ?? 'unknown',
                    relativeToAdopterId: A, giftRecipient: 0, addedBy: realOwner(original.addedBy) ?? realOwner(absorbed.addedBy),
                    addedAt: new Date(), sourceKey: targetKey, recordedAt: new Date(),
                }).onConflictDoNothing().run();
            }
            r = 'added';
        }
        if (r === 'moved' || r === 'added') out.moved++; else tally(r);
        let ownerEmail: string | null = null;
        if (own.profile && row.createdProfile && row.ownerEmail && absorbed.addedBy && lc(row.ownerEmail) !== lc(absorbed.addedBy)) {
            const won = await db.update(adopters).set({ addedBy: absorbed.addedBy, isPublic: absorbed.isPublic ?? 0, updatedAt: new Date() })
                .where(and(eq(adopters.id, P), eq(adopters.addedBy, row.ownerEmail))).returning({ id: adopters.id });
            ownerEmail = won.length ? absorbed.addedBy : null;
            if (!won.length) logger.info('householdConversion.undo: profile re-owned since the conversion, owner left', c);
        } else if (own.profile && row.createdProfile) {
            ownerEmail = row.ownerEmail;
        }
        if (own.grants) await revokeConversionGrants(db, S, P, actor);
        await writeGrants(db, await grantsFor(absorbed, await access(), P, refsOf(storedEntries(original.contactEntries)), own.profile && !!row.createdProfile, actor), false);
        const placed = r === 'added' ? await membershipIn(db, hh, P) : null;
        await runBatch(db, [db.insert(householdConversions).values({
            sourceKey: targetKey, hostAdopterId: A, memberId: original.id, outcome: 'converted',
            reason: r === 'gone' ? 'removed_while_merged' : 'undo_moved', fingerprint: row.fingerprint, contactRefs: row.contactRefs, householdId: hh,
            membershipId: r === 'moved' ? row.membershipId : placed?.id ?? null, profileId: P, createdProfile: own.profile ? row.createdProfile : 0,
            ownerEmail, actor, convertedAt: new Date(),
        }).onConflictDoNothing()]);
        logger.info('householdConversion.undo: copied member back on the absorbed host', { ...c, result: r, ownsMembership: own.membership, ownsProfile: own.profile });
    }

    // 2. Links the merge moved.
    for (const l of undo.movedLinks) {
        const row = await ledgerRow(db, linkKey(l.id));
        if (!row || row.outcome !== 'converted' || !row.profileId || !row.householdId) continue;
        const c = { ...ctx, survivorId: S, absorbedId: A, linkId: l.id, profileId: row.profileId };
        if (l.hostAdopterId === A && row.hostAdopterId === S) {
            // Hosted by the absorbed profile: the person goes back to its home.
            const hh = await home();
            const own = await ownership(db, row);
            const member = absorbedMembers.find(m => m.id === l.memberId);
            let r: 'moved' | 'dropped' | 'gone';
            let placedId: string | null = row.membershipId;
            if (own.membership) {
                r = await moveMembership(db, row.membershipId, { householdId: row.householdId, adopterId: row.profileId }, { householdId: hh, adopterId: row.profileId, relativeFrom: S, relativeTo: A }, c);
            } else {
                // Someone else's row placed that person in the survivor's home too: it stays; the absorbed home gets them.
                if (!(await membershipIn(db, hh, row.profileId))) {
                    await db.insert(householdMemberships).values({
                        id: newMembershipId(), householdId: hh, adopterId: row.profileId, relationship: member?.relationship ?? 'unknown',
                        relativeToAdopterId: A, giftRecipient: 0, addedBy: realOwner(member?.addedBy) ?? realOwner(absorbed.addedBy),
                        addedAt: new Date(), recordedAt: new Date(),
                    }).onConflictDoNothing().run();
                }
                placedId = (await membershipIn(db, hh, row.profileId))?.id ?? null;
                r = 'moved';
            }
            tally(r);
            if (own.grants) await revokeConversionGrants(db, S, row.profileId, actor);
            if (member) await writeGrants(db, await grantsFor(absorbed, await access(), row.profileId, refsOf(storedEntries(member.contactEntries)), false, actor), false);
            await db.update(householdConversions).set({ hostAdopterId: A, memberId: l.memberId, householdId: hh, membershipId: r === 'moved' ? placedId : null })
                .where(eq(householdConversions.sourceKey, row.sourceKey)).run();
            logger.info('householdConversion.undo: linked member back on the absorbed host', { ...c, result: r });
        } else if (l.linkedAdopterId === A && row.profileId === S) {
            // A third host listed the absorbed profile: its membership names it again.
            const r = await moveMembership(db, row.membershipId, { householdId: row.householdId, adopterId: S }, { householdId: row.householdId, adopterId: A }, c);
            tally(r);
            const host = await hostRow(db, l.hostAdopterId);
            const member = host ? deserializeHouseholdMembers(host.householdMembers).find(m => m.id === l.memberId) : undefined;
            await revokeConversionGrants(db, l.hostAdopterId, S, actor);
            if (host && member) {
                const entries = storedEntries(member.contactEntries);
                await appendContacts(db, A, entries, false, c);
                await writeGrants(db, await grantsFor(host, await hostAccess(db, host), A, refsOf(entries), false, actor), false);
            }
            await db.update(householdConversions).set({ profileId: A, ...(r === 'moved' ? {} : { membershipId: null }) })
                .where(eq(householdConversions.sourceKey, row.sourceKey)).run();
            logger.info('householdConversion.undo: a third host\'s member names the absorbed profile again', { ...c, hostId: l.hostAdopterId, result: r });
        }
    }

    // 3. «No convive» corrections the merge moved go back with it.
    for (const corr of undo.movedCorrections) {
        const row = await ledgerRow(db, correctionKey(corr.id));
        if (!row || row.outcome !== 'converted') continue;
        const hh = corr.hostAdopterId === A ? await home() : (await ownHomeOf(db, corr.hostAdopterId)) ?? row.householdId;
        const adopterId = (await resolveLive(db, corr.linkedAdopterId)) ?? corr.linkedAdopterId;
        if (!hh) continue;
        await db.update(householdCorrections).set({ householdId: hh, adopterId }).where(eq(householdCorrections.id, convertedCorrectionId(corr.id))).run();
        await db.update(householdConversions).set({ hostAdopterId: corr.hostAdopterId, householdId: hh, profileId: adopterId })
            .where(eq(householdConversions.sourceKey, row.sourceKey)).run();
    }
    if (out.moved || out.dropped || out.left) logger.info('householdConversion.undo: old merge reversed on the household tables', { ...ctx, survivorId: S, absorbedId: A, ...out });
    return out;
}
