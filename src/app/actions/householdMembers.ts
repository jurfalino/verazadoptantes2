'use server';

import { and, eq, isNull } from 'drizzle-orm';
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
import { tokenizeAdopter } from './duplicates';
import { isRealActorEmail } from '@/lib/piiAccess';
import { isAdminAsync } from '@/config/admins';

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
 * once Phase 4 wires the tokenizer) and is audited. Optimistic concurrency on
 * `updatedAt` guards the read-modify-write of the whole household blob.
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

/** Optimistic write of the household blob + re-tokenize; false on concurrent-modify. */
async function persist(
    db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
    adopterId: string,
    members: HouseholdMember[],
    prevUpdatedAt: Date | null,
): Promise<boolean> {
    const res = await db.update(adopters)
        .set({ householdMembers: serializeHouseholdMembers(members), updatedAt: new Date() })
        .where(and(
            eq(adopters.id, adopterId),
            prevUpdatedAt ? eq(adopters.updatedAt, prevUpdatedAt) : isNull(adopters.updatedAt),
        ));
    const rowsAffected = (res as unknown as { rowsAffected?: number }).rowsAffected ?? 1;
    if (rowsAffected === 0) return false;
    await tokenizeAdopter(adopterId).catch(e => logger.error('householdMembers: tokenize failed', e, { adopterId }));
    return true;
}

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

const CONCURRENT = { ok: false, error: 'This record was modified by another user. Please refresh and try again.' } as Err;

// ─────────────────────────── Member CRUD ───────────────────────────

export async function addHouseholdMember(
    input: { adopterId: string; name?: string; relationship?: Relationship | null },
): Promise<{ ok: true; memberId: string } | Err> {
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
        const members = [...r.members, member];
        if (!await persist(r.db, adopterId, members, r.target.updatedAt)) return CONCURRENT;
        await insertHouseholdHistory(r.db, adopterId, actor, { household_member_added: { relationship } });
        logAudit({ userEmail: actor, action: 'household_member_added', target: adopterId, details: { relationship } });
        return { ok: true, memberId: member.id };
    } catch (error) {
        const errorId = logger.error('addHouseholdMember failed', error, { adopterId, actor });
        return { ok: false, error: `Failed (Error ID: ${errorId})` };
    }
}

export async function updateHouseholdMember(
    input: { adopterId: string; memberId: string; name?: string; relationship?: Relationship | null },
): Promise<{ ok: true } | Err> {
    const actor = await authActor();
    if (!actor) return { ok: false, error: 'Not authenticated' };
    const adopterId = String(input.adopterId || '');
    try {
        const r = await loadEditable(adopterId, actor);
        if (!r.ok) return r;
        const m = r.members.find(x => x.id === input.memberId);
        if (!m) return { ok: false, error: 'Member not found' };
        if (input.name !== undefined) m.name = String(input.name).trim();
        if (input.relationship !== undefined) m.relationship = input.relationship && REL_SET.has(input.relationship) ? input.relationship : null;
        if (!m.name && !m.relationship && m.contactEntries.length === 0) return { ok: false, error: 'A name or relationship is required' };
        if (!await persist(r.db, adopterId, r.members, r.target.updatedAt)) return CONCURRENT;
        await insertHouseholdHistory(r.db, adopterId, actor, { household_member_updated: { id: input.memberId } });
        logAudit({ userEmail: actor, action: 'household_member_updated', target: adopterId, details: { memberId: input.memberId } });
        return { ok: true };
    } catch (error) {
        const errorId = logger.error('updateHouseholdMember failed', error, { adopterId, actor });
        return { ok: false, error: `Failed (Error ID: ${errorId})` };
    }
}

export async function removeHouseholdMember(
    input: { adopterId: string; memberId: string },
): Promise<{ ok: true } | Err> {
    const actor = await authActor();
    if (!actor) return { ok: false, error: 'Not authenticated' };
    const adopterId = String(input.adopterId || '');
    try {
        const r = await loadEditable(adopterId, actor);
        if (!r.ok) return r;
        if (!r.members.some(x => x.id === input.memberId)) return { ok: false, error: 'Member not found' };
        const members = r.members.filter(x => x.id !== input.memberId);
        if (!await persist(r.db, adopterId, members, r.target.updatedAt)) return CONCURRENT;
        await insertHouseholdHistory(r.db, adopterId, actor, { household_member_removed: { id: input.memberId } });
        logAudit({ userEmail: actor, action: 'household_member_removed', target: adopterId, details: { memberId: input.memberId } });
        return { ok: true };
    } catch (error) {
        const errorId = logger.error('removeHouseholdMember failed', error, { adopterId, actor });
        return { ok: false, error: `Failed (Error ID: ${errorId})` };
    }
}

// ─────────────────── Member contact-entry CRUD ───────────────────

export async function addMemberContactEntry(
    input: { adopterId: string; memberId: string; type: ContactEntry['type']; value: string; streetAndNumber?: string; locality?: string; platform?: SocialPlatform; apps?: MessagingApp[] },
): Promise<{ ok: true; entryId: string } | Err> {
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
        const m = r.members.find(x => x.id === input.memberId);
        if (!m) return { ok: false, error: 'Member not found' };
        const entry = buildEntry(actor, input.type, value, input);
        m.contactEntries = [...m.contactEntries, entry];
        if (!await persist(r.db, adopterId, r.members, r.target.updatedAt)) return CONCURRENT;
        await insertHouseholdHistory(r.db, adopterId, actor, { household_contact_added: { memberId: input.memberId, type: input.type } });
        logAudit({ userEmail: actor, action: 'household_contact_added', target: adopterId, details: { memberId: input.memberId, type: input.type } });
        return { ok: true, entryId: entry.id! };
    } catch (error) {
        const errorId = logger.error('addMemberContactEntry failed', error, { adopterId, actor });
        return { ok: false, error: `Failed (Error ID: ${errorId})` };
    }
}

export async function updateMemberContactEntry(
    input: { adopterId: string; memberId: string; entryId: string; value: string; streetAndNumber?: string; locality?: string; platform?: SocialPlatform; apps?: MessagingApp[] },
): Promise<{ ok: true } | Err> {
    const actor = await authActor();
    if (!actor) return { ok: false, error: 'Not authenticated' };
    const adopterId = String(input.adopterId || '');
    try {
        const r = await loadEditable(adopterId, actor);
        if (!r.ok) return r;
        const m = r.members.find(x => x.id === input.memberId);
        if (!m) return { ok: false, error: 'Member not found' };
        const idx = m.contactEntries.findIndex(e => e.id === input.entryId);
        if (idx < 0) return { ok: false, error: 'Entry not found' };
        const original = m.contactEntries[idx];
        m.contactEntries[idx] = buildEntry(
            actor, original.type, String(input.value || '').trim(),
            { streetAndNumber: input.streetAndNumber, locality: input.locality, platform: input.platform ?? original.platform, apps: input.apps ?? original.apps },
            { id: original.id!, addedBy: original.addedBy },
        );
        if (!await persist(r.db, adopterId, r.members, r.target.updatedAt)) return CONCURRENT;
        await insertHouseholdHistory(r.db, adopterId, actor, { household_contact_updated: { memberId: input.memberId, entryId: input.entryId, type: original.type } });
        logAudit({ userEmail: actor, action: 'household_contact_updated', target: adopterId, details: { memberId: input.memberId, entryId: input.entryId } });
        return { ok: true };
    } catch (error) {
        const errorId = logger.error('updateMemberContactEntry failed', error, { adopterId, actor });
        return { ok: false, error: `Failed (Error ID: ${errorId})` };
    }
}

export async function removeMemberContactEntry(
    input: { adopterId: string; memberId: string; entryId: string },
): Promise<{ ok: true } | Err> {
    const actor = await authActor();
    if (!actor) return { ok: false, error: 'Not authenticated' };
    const adopterId = String(input.adopterId || '');
    try {
        const r = await loadEditable(adopterId, actor);
        if (!r.ok) return r;
        const m = r.members.find(x => x.id === input.memberId);
        if (!m) return { ok: false, error: 'Member not found' };
        const before = m.contactEntries.length;
        m.contactEntries = m.contactEntries.filter(e => e.id !== input.entryId);
        if (m.contactEntries.length === before) return { ok: false, error: 'Entry not found' };
        if (!await persist(r.db, adopterId, r.members, r.target.updatedAt)) return CONCURRENT;
        await insertHouseholdHistory(r.db, adopterId, actor, { household_contact_removed: { memberId: input.memberId, entryId: input.entryId } });
        logAudit({ userEmail: actor, action: 'household_contact_removed', target: adopterId, details: { memberId: input.memberId, entryId: input.entryId } });
        return { ok: true };
    } catch (error) {
        const errorId = logger.error('removeMemberContactEntry failed', error, { adopterId, actor });
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
