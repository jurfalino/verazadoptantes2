'use server';

import { eq } from 'drizzle-orm';
import { getDb, getUser } from './_db';
import { adopters, adopterHistory } from '@/db/schema';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import {
    joinedAddressValue,
    detectSocialPlatform,
    mergeContactEntries,
    contactEntryKey,
    type ContactEntry,
    type SocialPlatform,
    type MessagingApp,
} from '@/lib/contactEntries';
import {
    deserializeHouseholdMembers,
    serializeHouseholdMembers,
    RELATIONSHIPS,
    currentAge,
    type HouseholdMember,
    type Relationship,
} from '@/lib/householdMembers';
import { tokenizeAdopter } from '@/lib/adopterTokenize';
import { isRealActorEmail } from '@/lib/piiAccess';
import { isModeratorOrAdminAsync } from '@/config/admins';
import { casAdopterLists } from '@/lib/adopterListCas';
import { itemAuthors } from '@/lib/collabAttribution';
import { hashEntryValue } from '@/lib/piiAccess';
import { recordHouseholdLink, deleteHouseholdLink, notifyHouseholdLinked } from '@/lib/householdLinks';
import { runAfterResponse } from '@/lib/background';
import { HOUSEHOLD_NOT_AUTHORIZED } from '@/domain/householdPermissions';
import { insertContributionGrant, notifyApprovers, fileContributionAccessRequest } from '@/lib/contributionSideEffects';

/**
 * Server actions for the structured household/family section.
 *
 * Who may write (D54, spec 2026-10-25 pendientes D — household follows the
 * contact-details model of `addContactEntry`):
 * - **Add** a member, or a contact on any member: any signed-in rescuer on a
 *   live profile. The item is credited to them (`addedBy`).
 * - **Edit / remove** a member: privileged (owner ∨ admin/moderator ∨ org-mate
 *   of the owner), or the member's `addedBy` is the actor. A contributor's edit
 *   changes name / relationship / age only; they may remove their member only
 *   while every contact on it is theirs too. **Edit / remove** a contact on a
 *   member: privileged, or the entry's `addedBy` is the actor. Items with no
 *   `addedBy` (legacy) stay privileged-only. The verdict is taken on the
 *   CURRENT stored item inside the compare-and-swap, never on client input.
 * - Privileged writes keep the editor path: history kind='edit', no notice.
 *   A non-privileged write is a contribution: history kind='contribution' for
 *   EVERY write, on the host AND on a linked profile ('edit' is the editor
 *   trail; loadApprovers counts an editor only while privileged, so this is
 *   defence in depth, and the history says honestly who had standing). On an add: an entry-scope grant per
 *   contact they typed (so they see it unmasked; everyone else sees the
 *   profile's normal protection); the owner + editors notified
 *   ('household_contribution'); and, when a contact was added, the access
 *   request auto-filed — both after the response
 *   (src/lib/contributionSideEffects.ts, shared with addContactEntry). A
 *   contact the member already has appends nothing and sends nothing, but the
 *   contributor still gets its grant. On the profile page, members and
 *   entries the viewer added carry `own: true` and the member's name stays
 *   unmasked for them (maskHouseholdMembers, `viewerEmail`).
 *
 * Every write re-tokenizes the adopter (household names + contacts feed dedup)
 * and is audited. Each read-modify-write of the household list is a
 * compare-and-swap that re-applies the change to a fresh read after a lost
 * race; an edit or removal can carry what the person saw, and is refused
 * (who + changed/deleted) if a teammate changed it since.
 */

type Err = { ok: false; error: string };
const REL_SET = new Set<string>(RELATIONSHIPS);
const VALID_TYPES = new Set<ContactEntry['type']>(['phone', 'email', 'social', 'id', 'address', 'alias', 'other']);

async function authActor(): Promise<string | null> {
    let actor = '';
    try { actor = await getUser(); } catch { /* anonymous */ }
    return isRealActorEmail(actor) ? actor : null;
}

/**
 * Load a live adopter row and say whether the actor is privileged on its
 * household (owner ∨ admin/moderator ∨ org-mate of the owner). Refuses nothing else:
 * each action decides what a non-privileged actor may do (D54).
 */
type Loaded = { ok: true; db: NonNullable<Awaited<ReturnType<typeof getDb>>>; target: typeof adopters.$inferSelect; members: HouseholdMember[]; privileged: boolean };
async function loadHousehold(adopterId: string, actor: string): Promise<Loaded | Err> {
    const db = await getDb();
    if (!db) return { ok: false, error: 'No database' };
    const target = await db.select().from(adopters).where(eq(adopters.id, adopterId)).get();
    if (!target) return { ok: false, error: 'Adopter not found' };
    if (target.deletedAt) return { ok: false, error: 'Cannot edit a deleted adopter' };
    // Case-insensitive: `added_by` keeps whatever case it was written with.
    const isOwner = sameEmail(target.addedBy, actor);
    // Moderators count, as in the visibility resolver (piiAccessServer.ts).
    const [actorIsAdmin, actorIsOrgMate] = await Promise.all([
        isModeratorOrAdminAsync(actor),
        (await import('@/lib/orgMembership')).isOrgMate(actor, target.addedBy),
    ]);
    const privileged = isOwner || actorIsAdmin || actorIsOrgMate;
    return { ok: true, db, target, members: deserializeHouseholdMembers(target.householdMembers), privileged };
}

/** Case-insensitive: `added_by` keeps whatever case it was written with. */
function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
    return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

const NOT_AUTHORIZED = HOUSEHOLD_NOT_AUTHORIZED;
/** Refuse a write the actor has no right to, logged with the operation's context. */
function forbidden(op: string, ctx: Record<string, unknown>): Err {
    logger.warn(`${op}: not owner/admin/org-mate/contributor`, ctx);
    return { ok: false, error: NOT_AUTHORIZED };
}

/**
 * The side effects of a non-privileged add (D54), as `addContactEntry` does
 * them: an entry grant per contact typed, then — after the response — the
 * owner + editors notified and, when contacts came with it, the access request
 * auto-filed. The item is
 * already saved: a failed grant is logged, never a failed add (a retry would
 * add it twice).
 */
async function contributionSideEffects(
    r: Loaded,
    actor: string,
    entries: ContactEntry[],
    notice: { op: string; what: 'member' | 'contact'; memberId: string; entryType?: ContactEntry['type'] },
): Promise<void> {
    const adopterId = r.target.id;
    const ctx = { adopterId, actor, memberId: notice.memberId };
    for (const e of entries) {
        if (e.type === 'alias') continue; // aliases are never masked: a grant would be inert
        try {
            await insertContributionGrant(r.db, adopterId, actor, e);
        } catch (err) {
            logger.error(`${notice.op}: contribution grant not written`, err, { ...ctx, type: e.type });
        }
    }
    const adopterName = r.target.name;
    await runAfterResponse(`${notice.op}.notifyApprovers`, () => notifyApprovers({
        op: notice.op, adopterId, actor, type: 'household_contribution',
        build: (actorName) => ({
            key: 'household_contribution',
            params: { actorName, what: notice.what, ...(notice.entryType ? { entryType: notice.entryType } : {}), ...(adopterName ? { adopterName } : {}) },
        }),
        metadata: { memberId: notice.memberId, what: notice.what, ...(notice.entryType ? { entryType: notice.entryType } : {}) },
    }), ctx);
    // As addContactEntry: the request rides on a contact actually added — a bare member files none.
    if (entries.length > 0) {
        await runAfterResponse(`${notice.op}.autoAccessRequest`,
            () => fileContributionAccessRequest(notice.op, actor, adopterId), ctx);
    }
}

type Members = HouseholdMember[];
type EntryConflict = { kind: 'changed' | 'deleted'; by: string };
type Conflict = { ok: false; error: 'conflict'; conflict: EntryConflict };
type Busy = { ok: false; error: 'busy'; errorId: string };
type StepOut<R> = { members?: Members; result: R };

/**
 * Apply `change` to the CURRENT household list and write it with a
 * compare-and-swap (src/lib/adopterListCas.ts). After a lost race the change
 * is re-applied to a fresh read, so two people editing different members or
 * contacts at the same moment both land. `change` returns the new list, or no
 * list to write nothing. Re-tokenizes after a write.
 */
async function mutateHousehold<R>(
    db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
    adopterId: string,
    change: (members: Members) => StepOut<R>,
    ctx: Record<string, unknown>,
): Promise<{ status: 'done'; result: R; wrote: boolean } | { status: 'missing' } | { status: 'busy'; errorId: string }> {
    const out = await casAdopterLists<R>(db, adopterId, (row) => {
        const { members, result } = change(deserializeHouseholdMembers(row.householdMembers));
        return members ? { write: { householdMembers: serializeHouseholdMembers(members) }, result } : { result };
    }, ctx);
    if (out.status !== 'done') return out;
    if (out.wrote) await tokenizeAdopter(adopterId).catch(e => logger.error('householdMembers: tokenize failed', e, { adopterId }));
    return { status: 'done', result: out.result, wrote: out.wrote };
}

const MEMBER_KEYS = ['household_member_updated', 'household_member_removed'] as const;
const MEMBER_CONTACT_KEYS = ['household_contact_updated', 'household_contact_removed'] as const;

/** «<Nombre> cambió / borró esto»: who, from the history rows that name the item. */
async function conflictOf(
    db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
    adopterId: string,
    itemId: string,
    kind: 'changed' | 'deleted',
    keys: readonly string[],
    ctx: Record<string, unknown>,
): Promise<Conflict> {
    const by = (await itemAuthors(db, adopterId, [itemId], keys))[itemId] ?? '';
    logger.info('householdMembers: refused, item changed meanwhile', { adopterId, itemId, kind, ...ctx });
    return { ok: false, error: 'conflict', conflict: { kind, by } };
}

/** An optional expected text from the client, bounded. */
const expectedText = (v: unknown): string | undefined => (typeof v === 'string' ? v.slice(0, 1000) : undefined);

/** Build a ContactEntry from raw input (mirrors addContactEntry/updateContactEntry). */
function buildEntry(
    actor: string,
    type: ContactEntry['type'],
    value: string,
    opts: { streetAndNumber?: string; locality?: string; platform?: SocialPlatform; apps?: MessagingApp[] },
    keep?: { id: string; addedBy?: string },
): ContactEntry {
    const id = keep?.id ?? crypto.randomUUID();
    const addedBy = keep?.addedBy ?? actor;
    if (type === 'address' && (opts.streetAndNumber || opts.locality)) {
        return {
            id, type: 'address',
            value: joinedAddressValue(opts.streetAndNumber ?? '', opts.locality ?? '') || value,
            streetAndNumber: opts.streetAndNumber || undefined,
            locality: opts.locality || undefined,
            ...(addedBy ? { addedBy } : {}),
        };
    }
    const platform = type === 'social' ? (detectSocialPlatform(value) ?? opts.platform) : undefined;
    const apps = type === 'phone' && opts.apps?.length ? [...new Set(opts.apps)] : undefined;
    return {
        id, type, value,
        ...(addedBy ? { addedBy } : {}),
        ...(platform ? { platform } : {}),
        ...(apps ? { apps } : {}),
    };
}

const busy = (errorId: string): Busy => ({ ok: false, error: 'busy', errorId });
const sameText = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').trim() === (b ?? '').trim();

// ─────────────────────────── Member CRUD ───────────────────────────

/**
 * Optional age on a member (spec 2026-10-04): a whole 0–120 sets it, dated
 * today so the profile can show the CURRENT age; null clears it; undefined
 * leaves it as is. Anything else is ignored (never trust the client).
 */
function applyAge(m: HouseholdMember, age: number | null | undefined): void {
    if (age === undefined) return;
    if (age === null) { delete m.age; delete m.ageAsOf; return; }
    if (Number.isInteger(age) && age >= 0 && age <= 120) {
        m.age = age;
        m.ageAsOf = new Date().toISOString().slice(0, 10);
    }
}

/** True when `age` would leave the member's age as it reads today. */
function sameAge(m: HouseholdMember, age: number | null | undefined): boolean {
    if (age === undefined) return true;
    if (age === null) return m.age === undefined;
    return currentAge(m) === age;
}

export async function addHouseholdMember(
    input: {
        adopterId: string; name?: string; relationship?: Relationship | null; age?: number | null;
        /**
         * The member's contacts, saved in the SAME write as the member. The post
         * importer used to add them one action at a time, so a failure halfway
         * left a half-filled member and a retry made a second one (review of
         * 2.56.213, item 5).
         */
        contactEntries?: Array<{ type: ContactEntry['type']; value: string; streetAndNumber?: string; locality?: string; platform?: SocialPlatform; apps?: MessagingApp[] }>;
        /**
         * The person's own adopter profile (D35 «alguien de su hogar»,
         * mergePendingDedupPair): the row links to it. Must name an existing
         * profile other than this one; anything else is ignored.
         */
        profileId?: string;
    },
): Promise<{ ok: true; memberId: string } | Busy | Err> {
    const actor = await authActor();
    if (!actor) return { ok: false, error: 'Not authenticated' };
    const adopterId = String(input.adopterId || '');
    const name = (input.name ?? '').trim();
    const relationship = input.relationship && REL_SET.has(input.relationship) ? input.relationship : null;
    if (!name && !relationship) return { ok: false, error: 'A name or relationship is required' };
    try {
        const r = await loadHousehold(adopterId, actor);
        if (!r.ok) return r;
        const entries = (input.contactEntries ?? [])
            .slice(0, 50)
            .filter(e => VALID_TYPES.has(e.type) && (String(e.value || '').trim() || (e.type === 'address' && (e.streetAndNumber || e.locality))))
            .map(e => buildEntry(actor, e.type, String(e.value || '').trim(), e));
        const member: HouseholdMember = { id: crypto.randomUUID(), name, relationship, contactEntries: entries, addedBy: actor };
        applyAge(member, input.age);
        const profileId = typeof input.profileId === 'string' ? input.profileId.trim().slice(0, 64) : '';
        if (profileId && profileId !== adopterId) {
            // A live profile only: a soft-deleted one (merged away, removed) gets no link and no notice.
            const linked = await r.db.select({ id: adopters.id, deletedAt: adopters.deletedAt }).from(adopters).where(eq(adopters.id, profileId)).get();
            if (linked && !linked.deletedAt) member.profileId = profileId;
            else logger.info('addHouseholdMember: profileId ignored (missing or deleted profile)', { adopterId, actor, profileId });
        }
        const out = await mutateHousehold(r.db, adopterId, (members) => ({ members: [...members, member], result: null }), { op: 'addHouseholdMember', actor });
        if (out.status === 'missing') return { ok: false, error: 'Adopter not found' };
        if (out.status === 'busy') return busy(out.errorId);
        // Contact TYPES (never values) so the history shows what came with the member,
        // as the per-contact path does (re-review of 2.56.214, E).
        const contactTypes = entries.map(e => e.type);
        await insertHouseholdHistory(r.db, adopterId, actor, { household_member_added: { id: member.id, relationship, ...(contactTypes.length ? { contactTypes } : {}) } }, r.privileged);
        logAudit({ userEmail: actor, action: 'household_member_added', target: adopterId, details: { relationship, contactTypes, ...(r.privileged ? {} : { contribution: true }) } });
        if (!r.privileged) await contributionSideEffects(r, actor, entries, { op: 'addHouseholdMember', what: 'member', memberId: member.id });
        if (member.profileId) {
            // D44: the linked profile shows «Convive con» from this row; D45: its team hears about it.
            // The member is already saved — a failed link is logged, never a failed add
            // (a retry would add the person twice).
            const linkCtx = { adopterId, actor, memberId: member.id, linkedId: member.profileId };
            try {
                const created = await recordHouseholdLink(r.db, { hostId: adopterId, memberId: member.id, linkedId: member.profileId, actor });
                logger.info('addHouseholdMember: household link recorded', { ...linkCtx, created });
                if (created) await notifyHouseholdLinked({ hostId: adopterId, hostName: r.target.name, linkedId: member.profileId, actor });
            } catch (e) {
                logger.error('addHouseholdMember: household link not recorded', e, linkCtx);
            }
        }
        return { ok: true, memberId: member.id };
    } catch (error) {
        const errorId = logger.error('addHouseholdMember failed', error, { adopterId, actor });
        return { ok: false, error: `Failed (Error ID: ${errorId})` };
    }
}

export async function updateHouseholdMember(
    input: { adopterId: string; memberId: string; name?: string; relationship?: Relationship | null; age?: number | null; expected?: { name?: string | null; relationship?: Relationship | null; age?: number | null } },
): Promise<{ ok: true } | Conflict | Busy | Err> {
    const actor = await authActor();
    if (!actor) return { ok: false, error: 'Not authenticated' };
    const adopterId = String(input.adopterId || '');
    const memberId = String(input.memberId || '');
    const expected = input.expected && typeof input.expected === 'object'
        ? {
            name: expectedText(input.expected.name ?? ''),
            relationship: input.expected.relationship ?? null,
            // The age as the editor saw it when the form opened; absent = not checked (older clients).
            ...('age' in input.expected ? { age: input.expected.age ?? null } : {}),
        }
        : null;
    try {
        const r = await loadHousehold(adopterId, actor);
        if (!r.ok) return r;
        type Res = 'forbidden' | 'not_found' | 'deleted' | 'changed' | 'empty' | 'noop' | 'updated';
        const out = await mutateHousehold<Res>(r.db, adopterId, (members) => {
            const m = members.find(x => x.id === memberId);
            // Decided on the stored member, first, so a refusal says nothing about it.
            if (!r.privileged && !sameEmail(m?.addedBy, actor)) return { result: 'forbidden' };
            if (!m) return { result: expected ? 'deleted' : 'not_found' };
            const name = input.name !== undefined ? String(input.name).trim() : m.name;
            const relationship = input.relationship !== undefined ? (input.relationship && REL_SET.has(input.relationship) ? input.relationship : null) : m.relationship;
            if (sameText(name, m.name) && (relationship ?? null) === (m.relationship ?? null) && sameAge(m, input.age)) return { result: 'noop' };
            // A teammate changed this person since the form opened: refuse.
            if (expected && (!sameText(expected.name, m.name) || (expected.relationship ?? null) !== (m.relationship ?? null)
                || ('age' in expected && (expected.age ?? null) !== (currentAge(m) ?? null)))) return { result: 'changed' };
            if (!name && !relationship && m.contactEntries.length === 0) return { result: 'empty' };
            const next: HouseholdMember = { ...m, name, relationship };
            if (!sameAge(m, input.age)) applyAge(next, input.age);
            return { members: members.map(x => (x.id === memberId ? next : x)), result: 'updated' };
        }, { op: 'updateHouseholdMember', actor, memberId });
        if (out.status === 'missing') return { ok: false, error: 'Adopter not found' };
        if (out.status === 'busy') return busy(out.errorId);
        if (out.result === 'forbidden') return forbidden('updateHouseholdMember', { adopterId, actor, memberId });
        if (out.result === 'not_found') return { ok: false, error: 'Member not found' };
        if (out.result === 'empty') return { ok: false, error: 'A name or relationship is required' };
        if (out.result === 'deleted' || out.result === 'changed') return conflictOf(r.db, adopterId, memberId, out.result, MEMBER_KEYS, { actor });
        if (out.result === 'noop') return { ok: true };
        await insertHouseholdHistory(r.db, adopterId, actor, { household_member_updated: { id: memberId } }, r.privileged);
        logAudit({ userEmail: actor, action: 'household_member_updated', target: adopterId, details: { memberId } });
        return { ok: true };
    } catch (error) {
        const errorId = logger.error('updateHouseholdMember failed', error, { adopterId, actor, memberId });
        return { ok: false, error: `Failed (Error ID: ${errorId})` };
    }
}

export async function removeHouseholdMember(
    input: { adopterId: string; memberId: string; expected?: { name?: string | null; relationship?: Relationship | null } },
): Promise<{ ok: true } | Conflict | Busy | Err> {
    const actor = await authActor();
    if (!actor) return { ok: false, error: 'Not authenticated' };
    const adopterId = String(input.adopterId || '');
    const memberId = String(input.memberId || '');
    const expected = input.expected && typeof input.expected === 'object'
        ? { name: expectedText(input.expected.name ?? ''), relationship: input.expected.relationship ?? null }
        : null;
    try {
        const r = await loadHousehold(adopterId, actor);
        if (!r.ok) return r;
        type Res = 'forbidden' | 'not_found' | 'deleted' | 'changed' | 'removed';
        const out = await mutateHousehold<Res>(r.db, adopterId, (members) => {
            const m = members.find(x => x.id === memberId);
            // A contributor removes only their own member, and only while every contact
            // on it is theirs too (removing it would delete what others added).
            if (!r.privileged && (!m || !sameEmail(m.addedBy, actor) || m.contactEntries.some(e => !sameEmail(e.addedBy, actor)))) {
                return { result: 'forbidden' };
            }
            if (!m) return { result: expected ? 'deleted' : 'not_found' };
            if (expected && (!sameText(expected.name, m.name) || (expected.relationship ?? null) !== (m.relationship ?? null))) return { result: 'changed' };
            return { members: members.filter(x => x.id !== memberId), result: 'removed' };
        }, { op: 'removeHouseholdMember', actor, memberId });
        if (out.status === 'missing') return { ok: false, error: 'Adopter not found' };
        if (out.status === 'busy') return busy(out.errorId);
        if (out.result === 'forbidden') return forbidden('removeHouseholdMember', { adopterId, actor, memberId });
        if (out.result === 'not_found') return { ok: false, error: 'Member not found' };
        if (out.result === 'deleted' || out.result === 'changed') return conflictOf(r.db, adopterId, memberId, out.result, MEMBER_KEYS, { actor });
        await insertHouseholdHistory(r.db, adopterId, actor, { household_member_removed: { id: memberId } }, r.privileged);
        logAudit({ userEmail: actor, action: 'household_member_removed', target: adopterId, details: { memberId } });
        // Its link goes with it, and the linked profile's history says so (M7).
        // A leftover row is harmless (reads check the member still exists) but is logged.
        await deleteHouseholdLink(r.db, { hostId: adopterId, hostName: r.target.name, memberId, actor, kind: r.privileged ? 'edit' : 'contribution' }).catch((e: unknown) => {
            logger.warn('removeHouseholdMember: household link / linked history not written (link ignored on read)', { adopterId, actor, memberId, error: e instanceof Error ? e.message : String(e) });
        });
        return { ok: true };
    } catch (error) {
        const errorId = logger.error('removeHouseholdMember failed', error, { adopterId, actor, memberId });
        return { ok: false, error: `Failed (Error ID: ${errorId})` };
    }
}

// ─────────────────── Member contact-entry CRUD ───────────────────

export async function addMemberContactEntry(
    input: { adopterId: string; memberId: string; type: ContactEntry['type']; value: string; streetAndNumber?: string; locality?: string; platform?: SocialPlatform; apps?: MessagingApp[] },
): Promise<{ ok: true; entryId: string } | Busy | Err> {
    const actor = await authActor();
    if (!actor) return { ok: false, error: 'Not authenticated' };
    const adopterId = String(input.adopterId || '');
    if (!VALID_TYPES.has(input.type)) return { ok: false, error: 'Invalid type' };
    const value = String(input.value || '').trim();
    const isAddress = input.type === 'address' && (input.streetAndNumber || input.locality);
    if (!value && !isAddress) return { ok: false, error: 'Value required' };
    try {
        const r = await loadHousehold(adopterId, actor);
        if (!r.ok) return r;
        const entry = buildEntry(actor, input.type, value, input);
        type Res = { kind: 'not_found' } | { kind: 'added' } | { kind: 'duplicate'; entryId: string };
        const out = await mutateHousehold<Res>(r.db, adopterId, (members) => {
            const m = members.find(x => x.id === input.memberId);
            if (!m) return { result: { kind: 'not_found' } };
            // De-duplicated like addContactEntry: a value the member already has appends nothing.
            const merged = mergeContactEntries(m.contactEntries, [entry]);
            if (!merged.some(e => e.id === entry.id)) {
                const key = contactEntryKey(entry);
                const dup = m.contactEntries.find(e => contactEntryKey(e) === key);
                return { result: { kind: 'duplicate', entryId: dup?.id ?? '' } };
            }
            return { members: members.map(x => (x.id === m.id ? { ...x, contactEntries: merged } : x)), result: { kind: 'added' } };
        }, { op: 'addMemberContactEntry', actor, memberId: input.memberId });
        if (out.status === 'missing') return { ok: false, error: 'Adopter not found' };
        if (out.status === 'busy') return busy(out.errorId);
        if (out.result.kind === 'not_found') return { ok: false, error: 'Member not found' };
        if (out.result.kind === 'duplicate') {
            // Nothing new on the profile: no history, no notice, no request. The
            // contributor still gets the grant — they showed they know the value.
            logger.info('addMemberContactEntry: value already on the member, nothing appended', { adopterId, actor, memberId: input.memberId, type: input.type });
            if (!r.privileged && entry.type !== 'alias') {
                await insertContributionGrant(r.db, adopterId, actor, entry).catch((e: unknown) => {
                    logger.error('addMemberContactEntry: contribution grant not written', e, { adopterId, actor, memberId: input.memberId, type: input.type });
                });
            }
            return { ok: true, entryId: out.result.entryId };
        }
        await insertHouseholdHistory(r.db, adopterId, actor, { household_contact_added: { memberId: input.memberId, type: input.type } }, r.privileged);
        logAudit({ userEmail: actor, action: 'household_contact_added', target: adopterId, details: { memberId: input.memberId, type: input.type, ...(r.privileged ? {} : { contribution: true }) } });
        if (!r.privileged) await contributionSideEffects(r, actor, [entry], { op: 'addMemberContactEntry', what: 'contact', memberId: input.memberId, entryType: input.type });
        return { ok: true, entryId: entry.id! };
    } catch (error) {
        const errorId = logger.error('addMemberContactEntry failed', error, { adopterId, actor });
        return { ok: false, error: `Failed (Error ID: ${errorId})` };
    }
}

export async function updateMemberContactEntry(
    input: { adopterId: string; memberId: string; entryId: string; value: string; streetAndNumber?: string; locality?: string; platform?: SocialPlatform; apps?: MessagingApp[]; expectedValue?: string },
): Promise<{ ok: true } | Conflict | Busy | Err> {
    const actor = await authActor();
    if (!actor) return { ok: false, error: 'Not authenticated' };
    const adopterId = String(input.adopterId || '');
    const entryId = String(input.entryId || '');
    const expectedValue = expectedText(input.expectedValue);
    try {
        const r = await loadHousehold(adopterId, actor);
        if (!r.ok) return r;
        type Res = { kind: 'forbidden' | 'member_not_found' | 'not_found' | 'deleted' | 'changed' | 'noop' } | { kind: 'updated'; entry: ContactEntry };
        const out = await mutateHousehold<Res>(r.db, adopterId, (members) => {
            const m = members.find(x => x.id === input.memberId);
            const idx = m ? m.contactEntries.findIndex(e => e.id === entryId) : -1;
            // Decided on the stored entry, first: a contributor edits only what they added.
            if (!r.privileged && (idx < 0 || !sameEmail(m!.contactEntries[idx].addedBy, actor))) return { result: { kind: 'forbidden' } };
            if (!m) return { result: { kind: expectedValue !== undefined ? 'deleted' : 'member_not_found' } };
            if (idx < 0) return { result: { kind: expectedValue !== undefined ? 'deleted' : 'not_found' } };
            const original = m.contactEntries[idx];
            const updated = buildEntry(
                actor, original.type, String(input.value || '').trim(),
                { streetAndNumber: input.streetAndNumber, locality: input.locality, platform: input.platform ?? original.platform, apps: input.apps ?? original.apps },
                { id: original.id!, addedBy: original.addedBy },
            );
            const cur = hashEntryValue(original.type, original.value);
            if (cur === hashEntryValue(updated.type, updated.value) && JSON.stringify(updated.apps ?? []) === JSON.stringify(original.apps ?? []) && updated.platform === original.platform) {
                return { result: { kind: 'noop' } };
            }
            if (expectedValue !== undefined && hashEntryValue(original.type, expectedValue) !== cur) return { result: { kind: 'changed' } };
            const entries = m.contactEntries.map((e, i) => (i === idx ? updated : e));
            return { members: members.map(x => (x.id === m.id ? { ...x, contactEntries: entries } : x)), result: { kind: 'updated', entry: updated } };
        }, { op: 'updateMemberContactEntry', actor, entryId });
        if (out.status === 'missing') return { ok: false, error: 'Adopter not found' };
        if (out.status === 'busy') return busy(out.errorId);
        const res = out.result;
        if (res.kind === 'forbidden') return forbidden('updateMemberContactEntry', { adopterId, actor, memberId: input.memberId, entryId });
        if (res.kind === 'member_not_found') return { ok: false, error: 'Member not found' };
        if (res.kind === 'not_found') return { ok: false, error: 'Entry not found' };
        if (res.kind === 'deleted' || res.kind === 'changed') return conflictOf(r.db, adopterId, entryId, res.kind, MEMBER_CONTACT_KEYS, { actor });
        if (res.kind !== 'updated') return { ok: true }; // noop
        await insertHouseholdHistory(r.db, adopterId, actor, { household_contact_updated: { memberId: input.memberId, entryId, type: res.entry.type } }, r.privileged);
        logAudit({ userEmail: actor, action: 'household_contact_updated', target: adopterId, details: { memberId: input.memberId, entryId } });
        // A contributor keeps seeing the value they just typed (the old grant names the old value).
        if (!r.privileged && res.entry.type !== 'alias') {
            await insertContributionGrant(r.db, adopterId, actor, res.entry).catch((e: unknown) => {
                logger.error('updateMemberContactEntry: contribution grant not written', e, { adopterId, actor, memberId: input.memberId, entryId });
            });
        }
        return { ok: true };
    } catch (error) {
        const errorId = logger.error('updateMemberContactEntry failed', error, { adopterId, actor, entryId });
        return { ok: false, error: `Failed (Error ID: ${errorId})` };
    }
}

export async function removeMemberContactEntry(
    input: { adopterId: string; memberId: string; entryId: string; expectedValue?: string },
): Promise<{ ok: true } | Conflict | Busy | Err> {
    const actor = await authActor();
    if (!actor) return { ok: false, error: 'Not authenticated' };
    const adopterId = String(input.adopterId || '');
    const entryId = String(input.entryId || '');
    const expectedValue = expectedText(input.expectedValue);
    try {
        const r = await loadHousehold(adopterId, actor);
        if (!r.ok) return r;
        type Res = 'forbidden' | 'member_not_found' | 'not_found' | 'deleted' | 'changed' | 'removed';
        const out = await mutateHousehold<Res>(r.db, adopterId, (members) => {
            const m = members.find(x => x.id === input.memberId);
            const entry = m?.contactEntries.find(e => e.id === entryId);
            // Decided on the stored entry, first: a contributor removes only what they added.
            if (!r.privileged && !sameEmail(entry?.addedBy, actor)) return { result: 'forbidden' };
            if (!m) return { result: expectedValue !== undefined ? 'deleted' : 'member_not_found' };
            if (!entry) return { result: expectedValue !== undefined ? 'deleted' : 'not_found' };
            if (expectedValue !== undefined && hashEntryValue(entry.type, expectedValue) !== hashEntryValue(entry.type, entry.value)) return { result: 'changed' };
            return { members: members.map(x => (x.id === m.id ? { ...x, contactEntries: x.contactEntries.filter(e => e.id !== entryId) } : x)), result: 'removed' };
        }, { op: 'removeMemberContactEntry', actor, entryId });
        if (out.status === 'missing') return { ok: false, error: 'Adopter not found' };
        if (out.status === 'busy') return busy(out.errorId);
        if (out.result === 'forbidden') return forbidden('removeMemberContactEntry', { adopterId, actor, memberId: input.memberId, entryId });
        if (out.result === 'member_not_found') return { ok: false, error: 'Member not found' };
        if (out.result === 'not_found') return { ok: false, error: 'Entry not found' };
        if (out.result === 'deleted' || out.result === 'changed') return conflictOf(r.db, adopterId, entryId, out.result, MEMBER_CONTACT_KEYS, { actor });
        await insertHouseholdHistory(r.db, adopterId, actor, { household_contact_removed: { memberId: input.memberId, entryId } }, r.privileged);
        logAudit({ userEmail: actor, action: 'household_contact_removed', target: adopterId, details: { memberId: input.memberId, entryId } });
        return { ok: true };
    } catch (error) {
        const errorId = logger.error('removeMemberContactEntry failed', error, { adopterId, actor, entryId });
        return { ok: false, error: `Failed (Error ID: ${errorId})` };
    }
}

/**
 * History row for a household mutation (never raw PII in changes): kind='edit'
 * for a privileged writer, kind='contribution' for anyone else (D54) — the
 * editor trail stays truthful (see the header).
 */
async function insertHouseholdHistory(
    db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
    adopterId: string,
    actor: string,
    changes: Record<string, unknown>,
    privileged: boolean,
): Promise<void> {
    await db.insert(adopterHistory).values({
        id: crypto.randomUUID(),
        adopterId,
        changedBy: actor,
        kind: privileged ? 'edit' : 'contribution',
        changes: JSON.stringify(changes),
        changedAt: new Date(),
    });
}
