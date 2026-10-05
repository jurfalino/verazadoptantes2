'use server';

import { eq } from 'drizzle-orm';
import { getDb, getUser } from './_db';
import { adopters, adopterHistory } from '@/db/schema';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import {
    joinedAddressValue,
    detectSocialPlatform,
    type ContactEntry,
    type SocialPlatform,
    type MessagingApp,
} from '@/lib/contactEntries';
import {
    deserializeHouseholdMembers,
    serializeHouseholdMembers,
    RELATIONSHIPS,
    type HouseholdMember,
    type Relationship,
} from '@/lib/householdMembers';
import { tokenizeAdopter } from '@/lib/adopterTokenize';
import { isRealActorEmail } from '@/lib/piiAccess';
import { isAdminAsync } from '@/config/admins';
import { casAdopterLists } from '@/lib/adopterListCas';
import { itemAuthors } from '@/lib/collabAttribution';
import { hashEntryValue } from '@/lib/piiAccess';

/**
 * Server actions for the structured household/family section.
 *
 * v1 scope decision: ALL household writes (member add/edit/remove and each
 * member's contact add/edit/remove) are gated to **owner ∨ admin ∨ org-mate**
 * — the `saveAdopter` mutation model — NOT the open-contribution model that
 * `addContactEntry` uses for the titular's contacts. This keeps the PII surface
 * closed (only privileged editors, who already see everything unmasked, can
 * touch household contacts, so no contribution grants are needed) and is much
 * simpler. Open collaborative contribution to household is a deliberate v1
 * non-goal (follow-up). See .agents/plans/2026-08-26-household-members-redesign.md.
 *
 * Every write re-tokenizes the adopter (household names + contacts feed dedup
 * once Phase 4 wires the tokenizer) and is audited. Each read-modify-write of
 * the household list is a compare-and-swap that re-applies the change to a
 * fresh read after a lost race; an edit or removal can carry what the person
 * saw, and is refused (who + changed/deleted) if a teammate changed it since.
 */

type Err = { ok: false; error: string };
const REL_SET = new Set<string>(RELATIONSHIPS);
const VALID_TYPES = new Set<ContactEntry['type']>(['phone', 'email', 'social', 'id', 'address', 'alias', 'other']);

async function authActor(): Promise<string | null> {
    let actor = '';
    try { actor = await getUser(); } catch { /* anonymous */ }
    return isRealActorEmail(actor) ? actor : null;
}

/** Load the adopter row and assert the actor may edit its household (owner/admin/org-mate). */
type Loaded = { ok: true; db: NonNullable<Awaited<ReturnType<typeof getDb>>>; target: typeof adopters.$inferSelect; members: HouseholdMember[] };
async function loadEditable(adopterId: string, actor: string): Promise<Loaded | Err> {
    const db = await getDb();
    if (!db) return { ok: false, error: 'No database' };
    const target = await db.select().from(adopters).where(eq(adopters.id, adopterId)).get();
    if (!target) return { ok: false, error: 'Adopter not found' };
    if (target.deletedAt) return { ok: false, error: 'Cannot edit a deleted adopter' };
    const isOwner = target.addedBy === actor;
    const [actorIsAdmin, actorIsOrgMate] = await Promise.all([
        isAdminAsync(actor),
        (await import('@/lib/orgMembership')).isOrgMate(actor, target.addedBy),
    ]);
    if (!isOwner && !actorIsAdmin && !actorIsOrgMate) {
        logger.warn('householdMembers: not owner/admin/org-mate', { adopterId, actor });
        return { ok: false, error: 'Not authorized to edit this household.' };
    }
    return { ok: true, db, target, members: deserializeHouseholdMembers(target.householdMembers) };
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

export async function addHouseholdMember(
    input: { adopterId: string; name?: string; relationship?: Relationship | null },
): Promise<{ ok: true; memberId: string } | Busy | Err> {
    const actor = await authActor();
    if (!actor) return { ok: false, error: 'Not authenticated' };
    const adopterId = String(input.adopterId || '');
    const name = (input.name ?? '').trim();
    const relationship = input.relationship && REL_SET.has(input.relationship) ? input.relationship : null;
    if (!name && !relationship) return { ok: false, error: 'A name or relationship is required' };
    try {
        const r = await loadEditable(adopterId, actor);
        if (!r.ok) return r;
        const member: HouseholdMember = { id: crypto.randomUUID(), name, relationship, contactEntries: [], addedBy: actor };
        const out = await mutateHousehold(r.db, adopterId, (members) => ({ members: [...members, member], result: null }), { op: 'addHouseholdMember', actor });
        if (out.status === 'missing') return { ok: false, error: 'Adopter not found' };
        if (out.status === 'busy') return busy(out.errorId);
        await insertHouseholdHistory(r.db, adopterId, actor, { household_member_added: { id: member.id, relationship } });
        logAudit({ userEmail: actor, action: 'household_member_added', target: adopterId, details: { relationship } });
        return { ok: true, memberId: member.id };
    } catch (error) {
        const errorId = logger.error('addHouseholdMember failed', error, { adopterId, actor });
        return { ok: false, error: `Failed (Error ID: ${errorId})` };
    }
}

export async function updateHouseholdMember(
    input: { adopterId: string; memberId: string; name?: string; relationship?: Relationship | null; expected?: { name?: string | null; relationship?: Relationship | null } },
): Promise<{ ok: true } | Conflict | Busy | Err> {
    const actor = await authActor();
    if (!actor) return { ok: false, error: 'Not authenticated' };
    const adopterId = String(input.adopterId || '');
    const memberId = String(input.memberId || '');
    const expected = input.expected && typeof input.expected === 'object'
        ? { name: expectedText(input.expected.name ?? ''), relationship: input.expected.relationship ?? null }
        : null;
    try {
        const r = await loadEditable(adopterId, actor);
        if (!r.ok) return r;
        type Res = 'not_found' | 'deleted' | 'changed' | 'empty' | 'noop' | 'updated';
        const out = await mutateHousehold<Res>(r.db, adopterId, (members) => {
            const m = members.find(x => x.id === memberId);
            if (!m) return { result: expected ? 'deleted' : 'not_found' };
            const name = input.name !== undefined ? String(input.name).trim() : m.name;
            const relationship = input.relationship !== undefined ? (input.relationship && REL_SET.has(input.relationship) ? input.relationship : null) : m.relationship;
            if (sameText(name, m.name) && (relationship ?? null) === (m.relationship ?? null)) return { result: 'noop' };
            // A teammate changed this person since the form opened: refuse.
            if (expected && (!sameText(expected.name, m.name) || (expected.relationship ?? null) !== (m.relationship ?? null))) return { result: 'changed' };
            if (!name && !relationship && m.contactEntries.length === 0) return { result: 'empty' };
            return { members: members.map(x => (x.id === memberId ? { ...x, name, relationship } : x)), result: 'updated' };
        }, { op: 'updateHouseholdMember', actor, memberId });
        if (out.status === 'missing') return { ok: false, error: 'Adopter not found' };
        if (out.status === 'busy') return busy(out.errorId);
        if (out.result === 'not_found') return { ok: false, error: 'Member not found' };
        if (out.result === 'empty') return { ok: false, error: 'A name or relationship is required' };
        if (out.result === 'deleted' || out.result === 'changed') return conflictOf(r.db, adopterId, memberId, out.result, MEMBER_KEYS, { actor });
        if (out.result === 'noop') return { ok: true };
        await insertHouseholdHistory(r.db, adopterId, actor, { household_member_updated: { id: memberId } });
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
        const r = await loadEditable(adopterId, actor);
        if (!r.ok) return r;
        type Res = 'not_found' | 'deleted' | 'changed' | 'removed';
        const out = await mutateHousehold<Res>(r.db, adopterId, (members) => {
            const m = members.find(x => x.id === memberId);
            if (!m) return { result: expected ? 'deleted' : 'not_found' };
            if (expected && (!sameText(expected.name, m.name) || (expected.relationship ?? null) !== (m.relationship ?? null))) return { result: 'changed' };
            return { members: members.filter(x => x.id !== memberId), result: 'removed' };
        }, { op: 'removeHouseholdMember', actor, memberId });
        if (out.status === 'missing') return { ok: false, error: 'Adopter not found' };
        if (out.status === 'busy') return busy(out.errorId);
        if (out.result === 'not_found') return { ok: false, error: 'Member not found' };
        if (out.result === 'deleted' || out.result === 'changed') return conflictOf(r.db, adopterId, memberId, out.result, MEMBER_KEYS, { actor });
        await insertHouseholdHistory(r.db, adopterId, actor, { household_member_removed: { id: memberId } });
        logAudit({ userEmail: actor, action: 'household_member_removed', target: adopterId, details: { memberId } });
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
        const r = await loadEditable(adopterId, actor);
        if (!r.ok) return r;
        const entry = buildEntry(actor, input.type, value, input);
        const out = await mutateHousehold<'not_found' | 'added'>(r.db, adopterId, (members) => {
            const m = members.find(x => x.id === input.memberId);
            if (!m) return { result: 'not_found' };
            return { members: members.map(x => (x.id === m.id ? { ...x, contactEntries: [...x.contactEntries, entry] } : x)), result: 'added' };
        }, { op: 'addMemberContactEntry', actor, memberId: input.memberId });
        if (out.status === 'missing') return { ok: false, error: 'Adopter not found' };
        if (out.status === 'busy') return busy(out.errorId);
        if (out.result === 'not_found') return { ok: false, error: 'Member not found' };
        await insertHouseholdHistory(r.db, adopterId, actor, { household_contact_added: { memberId: input.memberId, type: input.type } });
        logAudit({ userEmail: actor, action: 'household_contact_added', target: adopterId, details: { memberId: input.memberId, type: input.type } });
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
        const r = await loadEditable(adopterId, actor);
        if (!r.ok) return r;
        type Res = { kind: 'member_not_found' | 'not_found' | 'deleted' | 'changed' | 'noop' } | { kind: 'updated'; type: ContactEntry['type'] };
        const out = await mutateHousehold<Res>(r.db, adopterId, (members) => {
            const m = members.find(x => x.id === input.memberId);
            if (!m) return { result: { kind: expectedValue !== undefined ? 'deleted' : 'member_not_found' } };
            const idx = m.contactEntries.findIndex(e => e.id === entryId);
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
            return { members: members.map(x => (x.id === m.id ? { ...x, contactEntries: entries } : x)), result: { kind: 'updated', type: original.type } };
        }, { op: 'updateMemberContactEntry', actor, entryId });
        if (out.status === 'missing') return { ok: false, error: 'Adopter not found' };
        if (out.status === 'busy') return busy(out.errorId);
        const res = out.result;
        if (res.kind === 'member_not_found') return { ok: false, error: 'Member not found' };
        if (res.kind === 'not_found') return { ok: false, error: 'Entry not found' };
        if (res.kind === 'deleted' || res.kind === 'changed') return conflictOf(r.db, adopterId, entryId, res.kind, MEMBER_CONTACT_KEYS, { actor });
        if (res.kind !== 'updated') return { ok: true }; // noop
        await insertHouseholdHistory(r.db, adopterId, actor, { household_contact_updated: { memberId: input.memberId, entryId, type: res.type } });
        logAudit({ userEmail: actor, action: 'household_contact_updated', target: adopterId, details: { memberId: input.memberId, entryId } });
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
        const r = await loadEditable(adopterId, actor);
        if (!r.ok) return r;
        type Res = 'member_not_found' | 'not_found' | 'deleted' | 'changed' | 'removed';
        const out = await mutateHousehold<Res>(r.db, adopterId, (members) => {
            const m = members.find(x => x.id === input.memberId);
            if (!m) return { result: expectedValue !== undefined ? 'deleted' : 'member_not_found' };
            const entry = m.contactEntries.find(e => e.id === entryId);
            if (!entry) return { result: expectedValue !== undefined ? 'deleted' : 'not_found' };
            if (expectedValue !== undefined && hashEntryValue(entry.type, expectedValue) !== hashEntryValue(entry.type, entry.value)) return { result: 'changed' };
            return { members: members.map(x => (x.id === m.id ? { ...x, contactEntries: x.contactEntries.filter(e => e.id !== entryId) } : x)), result: 'removed' };
        }, { op: 'removeMemberContactEntry', actor, entryId });
        if (out.status === 'missing') return { ok: false, error: 'Adopter not found' };
        if (out.status === 'busy') return busy(out.errorId);
        if (out.result === 'member_not_found') return { ok: false, error: 'Member not found' };
        if (out.result === 'not_found') return { ok: false, error: 'Entry not found' };
        if (out.result === 'deleted' || out.result === 'changed') return conflictOf(r.db, adopterId, entryId, out.result, MEMBER_CONTACT_KEYS, { actor });
        await insertHouseholdHistory(r.db, adopterId, actor, { household_contact_removed: { memberId: input.memberId, entryId } });
        logAudit({ userEmail: actor, action: 'household_contact_removed', target: adopterId, details: { memberId: input.memberId, entryId } });
        return { ok: true };
    } catch (error) {
        const errorId = logger.error('removeMemberContactEntry failed', error, { adopterId, actor, entryId });
        return { ok: false, error: `Failed (Error ID: ${errorId})` };
    }
}

/** History row for a household mutation (kind='edit'; never raw PII in changes). */
async function insertHouseholdHistory(
    db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
    adopterId: string,
    actor: string,
    changes: Record<string, unknown>,
): Promise<void> {
    await db.insert(adopterHistory).values({
        id: crypto.randomUUID(),
        adopterId,
        changedBy: actor,
        kind: 'edit',
        changes: JSON.stringify(changes),
        changedAt: new Date(),
    });
}
