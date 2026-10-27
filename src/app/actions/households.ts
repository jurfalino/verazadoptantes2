'use server';

/**
 * Households as profiles (spec 2026-10-26-households-as-profiles-design) —
 * the actions people use. Every person in a household is an adopter profile;
 * a household is a group of profiles (src/lib/households.ts). Rules live in
 * src/domain/households.ts, notices in src/lib/householdNotices.ts.
 *
 * - `addHouseholdPerson`: anyone signed in (D54). An existing profile
 *   («¿Es este perfil?» → sí) joins the household, and the contacts typed go
 *   on it through `addContactEntry` (credited, grants, no double copies).
 *   Otherwise a new profile is made — owned by the ANCHOR's owner (spec «Who
 *   owns the profile a household add creates»), contacts credited to the
 *   typist with entry grants when they have no standing (D54). A name or one
 *   contact is required (`hasMinimumIdentifier`). Re-adding a person someone
 *   said doesn't live there adds anyway and tells the admins (D48).
 * - `updateHouseholdMembership`: the relationship only (name and age are the
 *   profile's, Task 3). Anyone signed in; credited, history on the person,
 *   the household's teams told.
 * - `removeHouseholdMembership`: «Quitar del hogar» — `canRemoveMembership`
 *   (the adder, any household profile's team, admins/moderators).
 *   'mistake' («Lo cargué por error») leaves no correction; 'not_living'
 *   («No vive acá») records one, so a re-add is a dispute. History on the
 *   person and every remaining housemate, the other teams told.
 * - `getHouseholdMatchCandidates`: the «Nuevo adoptante» duplicate check
 *   (findFormDuplicates) plus each candidate's household line.
 *
 * Browser-callable: the session is the only source of the actor; every id is
 * checked against what is stored. History kinds follow profilePrivilege
 * ('contribution' for anyone without standing on that profile). Errors are
 * codes (the UI translates them); a failure carries an errorId.
 */
import { eq } from 'drizzle-orm';
import { getDb, getUser } from './_db';
import { adopterHistory, adopters } from '@/db/schema';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { runBatch } from '@/lib/dbBatch';
import { runAfterResponse } from '@/lib/background';
import { isRealActorEmail } from '@/lib/piiAccess';
import { isPrivilegedOnProfile, historyKind, historyKindForOwner } from '@/lib/profilePrivilege';
import { contactEntryFromInput, type ContactEntry } from '@/lib/contactEntries';
import { RELATIONSHIPS, type Relationship } from '@/lib/householdMembers';
import { insertContributionGrant, fileContributionAccessRequest, revokeContributionGrants } from '@/lib/contributionSideEffects';
import { extractErrorId } from '@/lib/errorUtils';
import {
    addMembership, claimMembershipRecord, createHousehold, ensureHousehold, hasCorrection, householdExists, householdIdsOf,
    householdLinesFor, isMemberOf, membershipById, membershipBySourceKey, membershipsOf, ownTeamOf, releaseMembershipRecord, removeMembership, setMembershipRelationship,
    type HouseholdLine,
} from '@/lib/households';
import {
    notifyHouseholdMemberRemoved, notifyHouseholdPersonAdded, notifyHouseholdReaddDisputed, notifyHouseholdRelationshipChanged,
} from '@/lib/householdNotices';
import { canRemoveMembership, householdNameKey, isGiftHousehold, MAX_HOUSEHOLD_MEMBERS, MAX_HOUSEHOLDS_PER_PROFILE } from '@/domain/households';
import { hasMinimumIdentifier } from '@/domain/adopterIdentity';
import { householdContactSchema } from './validation';
import { addContactEntry } from './addContactEntry';
import { createHouseholdProfile } from './_adopterFactory';
import { searchFormDuplicates } from '@/lib/formDuplicates';
import type { DiscoveryMatch } from './types';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** One contact typed with the person (addContactEntry's fields). */
export type HouseholdContactInput = {
    type: ContactEntry['type'];
    value: string;
    streetAndNumber?: string;
    locality?: string;
    platform?: ContactEntry['platform'];
    apps?: ContactEntry['apps'];
};

export type HouseholdActionError =
    | 'not_authenticated' | 'not_found' | 'invalid' | 'identifier_required'
    | 'household_full' | 'too_many_households' | 'not_authorized' | 'conflict' | 'failed'
    /**
     * An imported relative (`fromImport`) of that name already lives in that household and the
     * caller has no standing on that person: nothing is added, and who it is stays unsaid. Not a
     * failure for the importer — the relative is there.
     */
    | 'already_there';
type Fail = { ok: false; error: HouseholdActionError; errorId?: string };

export type AddHouseholdPersonInput = {
    /** The profile the person is added next to («pareja de Pedro»). */
    anchorAdopterId: string;
    /** One of the anchor's households; omitted = the anchor's household (made when it has none). */
    householdId?: string;
    /** «¿Es este perfil?» → sí: link this live profile instead of making one. */
    existingProfileId?: string;
    name?: string;
    relationship?: Relationship;
    /** A whole 0–120 (new profiles only; an existing profile's age is changed through its own form). */
    age?: number | null;
    /** «Es menor de edad» ticked (new profiles only): counts only with no age — a typed age decides by itself. */
    isMinor?: boolean;
    contactEntries?: HouseholdContactInput[];
    /** A gift recipient: a gift household of its own with the anchor (the giver), never the ordinary one. */
    giftRecipient?: boolean;
    /**
     * A relative an import names (ImportWizard, Task 4 fix round 1). Re-merging the same post
     * must not add them twice: someone of the same name already in that household is that
     * person (the interview's rule), and with the post's URL the membership gets a source key
     * built HERE from (typist, anchor, URL) + `slot` — a client can never pick another source's
     * key. `slot`: the person's place in the post ('s' = the post's person, 'r0', 'r1'…).
     */
    fromImport?: { sourceUrl?: string | null; slot: string };
};

export type AddHouseholdPersonResult =
    | {
        ok: true; profileId: string; membershipId: string; createdProfile: boolean; autoRequestFiled: boolean;
        /** The person is placed, but a later step (history, notices…) failed: logged under this id. */
        warningErrorId?: string;
    }
    | Fail;

export type HouseholdMatchCandidate = DiscoveryMatch & { householdLine: HouseholdLine[] };

const REL_SET: ReadonlySet<string> = new Set(RELATIONSHIPS);
const MAX_CONTACTS = 20;
const id64 = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 64) : '');
const id200 = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 200) : '');

const sameEmail = (a: string | null | undefined, b: string | null | undefined) =>
    !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

async function sessionActor(): Promise<string | null> {
    let actor = '';
    try { actor = await getUser(); } catch { /* anonymous: refused by the caller */ }
    return isRealActorEmail(actor) ? actor : null;
}

type ProfileRow = { id: string; name: string; addedBy: string | null; deletedAt: Date | null };

async function liveProfile(db: Db, id: string): Promise<ProfileRow | null> {
    if (!id) return null;
    const row = await db.select({ id: adopters.id, name: adopters.name, addedBy: adopters.addedBy, deletedAt: adopters.deletedAt })
        .from(adopters).where(eq(adopters.id, id)).get() as ProfileRow | undefined;
    return row && !row.deletedAt ? row : null;
}

/** The typed contacts, validated as addContactEntry validates one; null = something malformed. */
function parseContacts(raw: unknown): HouseholdContactInput[] | null {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw) || raw.length > MAX_CONTACTS) return null;
    const out: HouseholdContactInput[] = [];
    for (const item of raw) {
        const parsed = householdContactSchema.safeParse(item);
        if (!parsed.success) return null;
        out.push(parsed.data);
    }
    return out;
}

// ─────────────────────────── Placing the membership ───────────────────────────

/**
 * The household to add into: a chosen one must exist and hold the anchor (a
 * guessed id is `not_found`); otherwise the anchor's own (ensureHousehold).
 * ensureHousehold can, in a 3+-way race, return a household a racing caller
 * then dropped (Task 1): the row is checked and ensureHousehold retried once.
 */
async function resolveHousehold(db: Db, anchorId: string, chosen: string, actor: string, ctx: Record<string, unknown>): Promise<string | 'not_found'> {
    if (chosen) {
        if (!(await householdExists(db, chosen)) || !(await isMemberOf(db, chosen, anchorId))) return 'not_found';
        // A gift household is never a home to add people to (Task 8 fix A1): only «Crear perfil» fills it.
        if (isGiftHousehold(await membershipsOf(db, chosen, MAX_HOUSEHOLD_MEMBERS + 1))) {
            logger.warn('addHouseholdPerson: a gift household was chosen as the target, refused', { ...ctx, householdId: chosen });
            return 'not_found';
        }
        return chosen;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
        const householdId = await ensureHousehold(db, anchorId, actor);
        if (await householdExists(db, householdId)) return householdId;
        logger.warn('addHouseholdPerson: household gone after ensureHousehold (lost race), retrying', { ...ctx, householdId, attempt });
    }
    throw new Error('addHouseholdPerson: the anchor household kept disappearing');
}

/** Room for one more person, and the person may join one more household. */
async function capacityError(db: Db, householdId: string, adopterId: string | null): Promise<'household_full' | 'too_many_households' | null> {
    if (adopterId && await isMemberOf(db, householdId, adopterId)) return null;
    if ((await membershipsOf(db, householdId, MAX_HOUSEHOLD_MEMBERS + 1)).length >= MAX_HOUSEHOLD_MEMBERS) return 'household_full';
    if (adopterId && (await householdIdsOf(db, adopterId)).length >= MAX_HOUSEHOLDS_PER_PROFILE) return 'too_many_households';
    return null;
}

/** A gift household is one more household for the giver, and for an existing recipient. */
async function giftCapacityError(db: Db, anchorId: string, recipientId: string | null): Promise<'too_many_households' | null> {
    const counts = await Promise.all([anchorId, ...(recipientId ? [recipientId] : [])].map(id => householdIdsOf(db, id)));
    return counts.some(c => c.length >= MAX_HOUSEHOLDS_PER_PROFILE) ? 'too_many_households' : null;
}

/**
 * A profile made for a household add that ended up in no household: undo it
 * — soft-deleted, its tokens removed (never a search or duplicate match), any
 * contribution grant on it revoked — so a retry makes one live profile, never
 * two. Logged; a failure here is logged too (the caller already answers with
 * an error).
 */
async function undoCreatedProfile(db: Db, profileId: string, actor: string, entries: ContactEntry[], ctx: Record<string, unknown>): Promise<void> {
    const c = { ...ctx, profileId };
    try {
        const { duplicateTokens } = await import('@/db/schema');
        await runBatch(db, [
            db.update(adopters).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(adopters.id, profileId)),
            db.delete(duplicateTokens).where(eq(duplicateTokens.adopterId, profileId)),
        ]);
        await revokeContributionGrants(db, { op: 'addHouseholdPerson.undo', adopterId: profileId, actor, removed: entries, stillOnProfile: new Set() });
        logger.warn('addHouseholdPerson: membership not placed, new profile undone', c);
    } catch (e) {
        logger.error('addHouseholdPerson: membership not placed and the new profile could not be undone', e, c);
    }
}

/**
 * addMembership, then make sure the household still exists: a racing
 * ensureHousehold may drop an anchor-only household between our check and
 * our insert. Then our row is taken back (never a dangling membership) and
 * the person is placed once more in the anchor's household — never in a
 * chosen one, which is simply gone (`not_found`).
 */
async function joinHousehold(
    db: Db,
    p: { householdId: string; chosen: boolean; anchorId: string; adopterId: string; relationship: Relationship; actor: string; sourceKey?: string | null },
    ctx: Record<string, unknown>,
): Promise<{ householdId: string; membershipId: string; created: boolean } | 'not_found'> {
    let householdId = p.householdId;
    for (let attempt = 0; attempt < 2; attempt++) {
        const out = await addMembership(db, {
            householdId, adopterId: p.adopterId, relationship: p.relationship, relativeToAdopterId: p.anchorId, addedBy: p.actor, sourceKey: p.sourceKey ?? null,
            // S3: only pairs the adder is privileged on BOTH sides of leave «Pendientes».
            clearPairs: { actor: p.actor },
        });
        if (await householdExists(db, householdId)) return { householdId, ...out };
        logger.warn('addHouseholdPerson: household gone after the membership landed (lost race), membership taken back', { ...ctx, householdId, membershipId: out.membershipId, attempt });
        if (out.created) {
            await removeMembership(db, out.membershipId, p.actor, { correction: false }).catch((e: unknown) => {
                logger.error('addHouseholdPerson: dangling membership not removed', e, { ...ctx, householdId, membershipId: out.membershipId });
            });
        }
        if (p.chosen) return 'not_found';
        const again = await resolveHousehold(db, p.anchorId, '', p.actor, ctx);
        if (again === 'not_found') return 'not_found';
        householdId = again;
    }
    throw new Error('addHouseholdPerson: the household kept disappearing');
}

/** The source key of an imported relative: never chosen by the client (typist + anchor + post URL, hashed) + its slot. */
async function importSourceKey(actor: string, anchorId: string, from: { sourceUrl?: string | null; slot: string }): Promise<string | null> {
    const url = typeof from.sourceUrl === 'string' ? from.sourceUrl.trim().slice(0, 2000) : '';
    if (!url) return null;
    const bytes = new TextEncoder().encode(`${actor.trim().toLowerCase()}|${anchorId}|${url}`);
    const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
    return `import-post:${hex.slice(0, 16)}-${from.slot}`;
}

type ImportedAlready =
    /** This post's re-merge placed them in THIS household before (its source key: the caller added it). */
    | { kind: 'here'; profileId: string; membershipId: string }
    /** Placed by this post before, but in another household (the anchor moved): the same person joins this one. */
    | { kind: 'elsewhere'; profileId: string }
    /** Someone of the same name lives in this household (the interview's rule). */
    | { kind: 'same_name'; profileId: string; membershipId: string; addedBy: string | null; ownerEmail: string | null };

/**
 * An imported relative who may already be there: the membership this post's
 * re-merge wrote before (its source key — in this household, or elsewhere
 * when the anchor moved), or someone of the same name (householdNameKey:
 * case, accents, spacing) living in this household. Null = add them. Called
 * only once the caller's add is allowed (anchor live, household theirs).
 */
async function importedAlready(
    db: Db,
    p: { householdId: string; anchorId: string; importKey: string | null; name: string; ctx: Record<string, unknown> },
): Promise<ImportedAlready | null> {
    if (p.importKey) {
        const m = await membershipBySourceKey(db, p.importKey);
        if (m && await liveProfile(db, m.adopterId)) {
            if (m.householdId === p.householdId) {
                logger.info('addHouseholdPerson: this post\'s relative is already there, reused', { ...p.ctx, membershipId: m.id });
                return { kind: 'here', profileId: m.adopterId, membershipId: m.id };
            }
            logger.info('addHouseholdPerson: this post\'s relative lives in another household of the anchor\'s past, linked here', { ...p.ctx, membershipId: m.id });
            return { kind: 'elsewhere', profileId: m.adopterId };
        }
    }
    const key = householdNameKey(p.name);
    if (!key) return null;
    for (const m of await membershipsOf(db, p.householdId)) {
        if (m.adopterId === p.anchorId) continue;
        const prof = await liveProfile(db, m.adopterId);
        if (prof?.name && householdNameKey(prof.name) === key) {
            logger.info('addHouseholdPerson: someone of that name already lives there, not added again (import)', { ...p.ctx, membershipId: m.id });
            return { kind: 'same_name', profileId: prof.id, membershipId: m.id, addedBy: m.addedBy, ownerEmail: prof.addedBy };
        }
    }
    return null;
}

// ─────────────────────────── Add ───────────────────────────

/** The lazy conversion of a profile's old inline household before a write reads it. Never fails the add (logged). */
async function convertFirst(db: Db, adopterId: string, ctx: Record<string, unknown>): Promise<void> {
    try {
        const { ensureProfileConverted } = await import('@/lib/householdConversion');
        const { failed } = await ensureProfileConverted(db, adopterId);
        if (failed) logger.warn('addHouseholdPerson: some of the anchor\'s old household was not converted yet', { ...ctx, failed });
    } catch (e) {
        logger.warn('addHouseholdPerson: old household conversion failed, the add goes on', { ...ctx, error: e instanceof Error ? e.message : String(e) });
    }
}

export async function addHouseholdPerson(input: AddHouseholdPersonInput): Promise<AddHouseholdPersonResult> {
    const actor = await sessionActor();
    if (!actor) return { ok: false, error: 'not_authenticated' };
    const anchorId = id64(input?.anchorAdopterId);
    const chosen = id200(input?.householdId);
    const existingId = id64(input?.existingProfileId);
    const name = typeof input?.name === 'string' ? input.name.trim().slice(0, 200) : '';
    const gift = input?.giftRecipient === true;
    const ctx: Record<string, unknown> = { anchorId, actor, householdId: chosen || null, existingProfileId: existingId || null, gift };

    if (!anchorId) return { ok: false, error: 'invalid' };
    const fromImport = input?.fromImport ?? null;
    if (fromImport && (typeof fromImport.slot !== 'string' || !/^[a-z0-9]{1,8}$/.test(fromImport.slot))) return { ok: false, error: 'invalid' };
    let importKey = fromImport && !gift ? await importSourceKey(actor, anchorId, fromImport) : null;
    if (input.relationship !== undefined && input.relationship !== null && !REL_SET.has(input.relationship)) return { ok: false, error: 'invalid' };
    const relationship: Relationship = input.relationship && REL_SET.has(input.relationship) ? input.relationship : 'unknown';
    const age = input.age;
    if (age !== undefined && age !== null && !(Number.isInteger(age) && age >= 0 && age <= 120)) return { ok: false, error: 'invalid' };
    const contacts = parseContacts(input.contactEntries);
    if (!contacts) return { ok: false, error: 'invalid' };
    const entries = contacts.map(c => contactEntryFromInput(c, actor));
    if (!existingId && !hasMinimumIdentifier({ name, contactEntries: entries.length ? JSON.stringify(entries) : null })) {
        return { ok: false, error: 'identifier_required' };
    }

    try {
        const db = await getDb();
        if (!db) throw new Error('No database');
        const anchor = await liveProfile(db, anchorId);
        if (!anchor) return { ok: false, error: 'not_found' };
        let existing = existingId ? await liveProfile(db, existingId) : null;
        if (existingId && (!existing || existing.id === anchor.id)) {
            logger.info('addHouseholdPerson: existing profile missing, deleted or the anchor itself', ctx);
            return { ok: false, error: 'not_found' };
        }
        const { isOwnerOrOrgMate } = await import('@/lib/orgMembership');
        const [privilegedOnAnchor, onAnchorTeam] = await Promise.all([
            isPrivilegedOnProfile(actor, anchor.addedBy),
            isOwnerOrOrgMate(actor, anchor.addedBy),
        ]);

        // Where they go — checked BEFORE a profile is made, so a refusal leaves nothing behind.
        let householdId = '';
        if (gift) {
            // A gift household is one more household for the giver (and an existing recipient).
            const full = await giftCapacityError(db, anchor.id, existing?.id ?? null);
            if (full) {
                logger.info('addHouseholdPerson: refused, cap reached (gift)', { ...ctx, cap: full });
                return { ok: false, error: full };
            }
        } else {
            // Today's inline household first (Task 7): the anchor's home and the same-name rule must see it.
            await convertFirst(db, anchor.id, ctx);
            const resolved = await resolveHousehold(db, anchor.id, chosen, actor, ctx);
            if (resolved === 'not_found') {
                logger.warn('addHouseholdPerson: chosen household missing or not the anchor\'s', ctx);
                return { ok: false, error: 'not_found' };
            }
            householdId = resolved;
            // An imported relative already there (same post re-merged, or the same name in that household).
            // Checked only now: the add itself is allowed (anchor live, the household is the anchor's).
            if (fromImport && !existing) {
                const there = await importedAlready(db, { householdId, anchorId: anchor.id, importKey, name, ctx });
                if (there?.kind === 'here') {
                    return { ok: true, profileId: there.profileId, membershipId: there.membershipId, createdProfile: false, autoRequestFiled: false };
                }
                if (there?.kind === 'elsewhere') {
                    // The same person joins this household (their key stays on the first membership).
                    existing = await liveProfile(db, there.profileId);
                    importKey = null;
                } else if (there?.kind === 'same_name') {
                    // Who it is is said only to someone with standing on that person or this household,
                    // or who added them — anyone else learns nothing beyond «already there».
                    const standing = sameEmail(there.addedBy, actor)
                        || privilegedOnAnchor
                        || await isPrivilegedOnProfile(actor, there.ownerEmail);
                    return standing
                        ? { ok: true, profileId: there.profileId, membershipId: there.membershipId, createdProfile: false, autoRequestFiled: false }
                        : { ok: false, error: 'already_there' };
                }
            }
            const full = await capacityError(db, householdId, existing?.id ?? null);
            if (full) {
                logger.info('addHouseholdPerson: refused, cap reached', { ...ctx, householdId, cap: full });
                return { ok: false, error: full };
            }
        }

        // Who they are.
        let person: ProfileRow;
        let createdProfile = false;
        let autoRequestFiled = false;
        const contactTypes = entries.map(e => e.type);
        if (existing) {
            person = existing;
        } else {
            const newId = await createHouseholdProfile(db, {
                ownerEmail: anchor.addedBy ?? 'anonymous',
                actor,
                name,
                contactEntries: entries,
                age: age ?? null,
                isMinor: input.isMinor === true,
                // Same owner as the anchor, so the same standing.
                historyKind: historyKind(privilegedOnAnchor),
                history: { created_in_household: { anchorId: anchor.id, anchorName: anchor.name, householdId: householdId || null, gift, ...(contactTypes.length ? { contactTypes } : {}) } },
            });
            logAudit({ userEmail: actor, action: 'adopter_created', target: newId, details: { name, via: 'household' } });
            person = { id: newId, name, addedBy: anchor.addedBy, deletedAt: null };
            createdProfile = true;
        }

        // The membership. A new profile that ends up in no household is undone.
        let placed: { householdId: string; membershipId: string; created: boolean };
        try {
            if (gift) {
                // Recipient first: a household is "gift" once a membership says so (Task 1).
                householdId = await createHousehold(db, actor);
                const recipient = await addMembership(db, { householdId, adopterId: person.id, relationship, relativeToAdopterId: anchor.id, giftRecipient: true, addedBy: actor });
                // The giver's own row has no adder (as ensureHousehold's anchor row).
                await addMembership(db, { householdId, adopterId: anchor.id, relationship: 'unknown', addedBy: null });
                placed = { householdId, ...recipient };
            } else {
                const joined = await joinHousehold(db, { householdId, chosen: !!chosen, anchorId: anchor.id, adopterId: person.id, relationship, actor, sourceKey: importKey }, ctx);
                if (joined === 'not_found') {
                    if (createdProfile) await undoCreatedProfile(db, person.id, actor, entries, ctx);
                    return { ok: false, error: 'not_found' };
                }
                placed = joined;
            }
        } catch (e) {
            // The import key is unique (0098): a racing re-merge placed this person first. Theirs stands.
            const winner = importKey ? await membershipBySourceKey(db, importKey) : null;
            if (winner) {
                if (createdProfile) await undoCreatedProfile(db, person.id, actor, entries, { ...ctx, lostRace: true });
                return { ok: true, profileId: winner.adopterId, membershipId: winner.id, createdProfile: false, autoRequestFiled: false };
            }
            if (createdProfile) await undoCreatedProfile(db, person.id, actor, entries, ctx);
            throw e;
        }
        const out = { ...ctx, householdId: placed.householdId, membershipId: placed.membershipId, profileId: person.id };

        // Everything after the placement is the add's side effects. The person IS placed: a
        // failure here is logged with an errorId and answered ok — never `failed`, which
        // would make a retry create the profile a second time.
        let warningErrorId: string | undefined;
        try {
            // D54 for a new profile, once it is placed: the typist sees what they typed.
            if (createdProfile && !privilegedOnAnchor) {
                for (const e of entries) {
                    if (e.type === 'alias') continue; // never masked: a grant would be inert
                    await insertContributionGrant(db, person.id, actor, e).catch((err: unknown) => {
                        logger.error('addHouseholdPerson: contribution grant not written', err, { ...out, type: e.type });
                    });
                }
                if (entries.length > 0) {
                    await runAfterResponse('addHouseholdPerson.autoAccessRequest',
                        () => fileContributionAccessRequest('addHouseholdPerson', actor, person.id), out);
                    autoRequestFiled = true;
                }
            }

            // The link's own record — history, audit, notices, dispute — right after it is
            // placed, independent of the contacts below. Recorded once (a compare-and-set claim
            // on the membership), and only by the one who added it: a retry by them completes a
            // record a failure left missing; someone else repeating the add is not credited and
            // fires nothing.
            const mayRecord = placed.created || sameEmail((await membershipById(db, placed.membershipId))?.addedBy, actor);
            if (mayRecord && await claimMembershipRecord(db, placed.membershipId)) {
                const anchorKind = historyKind(privilegedOnAnchor);
                const personKind = existing ? await historyKindForOwner(actor, existing.addedBy, out) : null;
                const now = new Date();
                try {
                    await runBatch(db, [
                        db.insert(adopterHistory).values({
                            id: crypto.randomUUID(), adopterId: anchor.id, changedBy: actor, kind: anchorKind, changedAt: now,
                            changes: JSON.stringify({ household_member_added: { id: placed.membershipId, householdId: placed.householdId, profileId: person.id, relationship, ...(contactTypes.length ? { contactTypes } : {}) } }),
                        }),
                        ...(existing && personKind ? [db.insert(adopterHistory).values({
                            id: crypto.randomUUID(), adopterId: existing.id, changedBy: actor, kind: personKind, changedAt: now,
                            changes: JSON.stringify({ household_joined: { hostId: anchor.id, hostName: anchor.name, householdId: placed.householdId, relationship } }),
                        })] : []),
                    ]);
                } catch (e) {
                    // Released, so the same person's next add completes the record.
                    await releaseMembershipRecord(db, placed.membershipId).catch((re: unknown) => {
                        logger.error('addHouseholdPerson: record claim not released', re, out);
                    });
                    throw e;
                }
                logAudit({ userEmail: actor, action: 'household_person_added', target: anchor.id, details: { membershipId: placed.membershipId, householdId: placed.householdId, profileId: person.id, createdProfile, relationship, contactTypes, gift, ...(privilegedOnAnchor ? {} : { contribution: true }) } });
                logger.info('addHouseholdPerson: added', { ...out, createdProfile, completedLater: !placed.created });
                await notifyHouseholdPersonAdded({
                    householdId: placed.householdId, membershipId: placed.membershipId,
                    anchor: { id: anchor.id, name: anchor.name, addedBy: anchor.addedBy },
                    person: { id: person.id, name: person.name },
                    actor, onAnchorTeam, existingProfile: !!existing,
                });
                if (await hasCorrection(db, placed.householdId, person.id)) {
                    logger.info('addHouseholdPerson: re-added after «No vive acá», dispute', out);
                    await notifyHouseholdReaddDisputed({ householdId: placed.householdId, membershipId: placed.membershipId, person: { id: person.id, name: person.name }, hostName: anchor.name, actor });
                }
            } else {
                logger.info('addHouseholdPerson: already in that household and recorded, nothing added', { ...out, mayRecord });
            }
        } catch (e) {
            warningErrorId = logger.error('addHouseholdPerson: a step after the person was placed failed (the add stands)', e, out);
        }

        // Contacts typed for an existing profile: addContactEntry's semantics exactly. A failure
        // keeps the link (and its record) and answers with addContactEntry's own errorId; a retry
        // finds the link and adds the contacts (deduped).
        if (existing) {
            for (const c of contacts) {
                const res = await addContactEntry({ adopterId: existing.id, ...c, platform: c.platform ?? undefined });
                if (!res.ok) {
                    const errorId = ('errorId' in res ? res.errorId : extractErrorId(res.error))
                        ?? logger.error('addHouseholdPerson: contact refused by addContactEntry', new Error(res.error), { ...out, type: c.type });
                    return { ok: false, error: 'failed', errorId };
                }
                if (res.autoRequestFiled) autoRequestFiled = true;
            }
        }
        return { ok: true, profileId: person.id, membershipId: placed.membershipId, createdProfile, autoRequestFiled, ...(warningErrorId ? { warningErrorId } : {}) };
    } catch (e) {
        const errorId = logger.error('addHouseholdPerson failed', e, ctx);
        return { ok: false, error: 'failed', errorId };
    }
}

// ─────────────────────────── Relationship ───────────────────────────

export async function updateHouseholdMembership(
    input: { membershipId: string; relationship: Relationship; /** What the editor saw; a different stored value is a conflict. */ expected?: Relationship | null },
): Promise<{ ok: true } | Fail> {
    const actor = await sessionActor();
    if (!actor) return { ok: false, error: 'not_authenticated' };
    const membershipId = id200(input?.membershipId);
    const ctx: Record<string, unknown> = { membershipId, actor };
    if (!membershipId || !REL_SET.has(input.relationship)) return { ok: false, error: 'invalid' };
    const to = input.relationship;
    try {
        const db = await getDb();
        if (!db) throw new Error('No database');
        const m = await membershipById(db, membershipId);
        const person = m ? await liveProfile(db, m.adopterId) : null;
        if (!m || !person) return { ok: false, error: 'not_found' };
        Object.assign(ctx, { householdId: m.householdId, profileId: m.adopterId });
        if (input.expected !== undefined && input.expected !== null && input.expected !== m.relationship) {
            logger.info('updateHouseholdMembership: refused, changed since the form opened', ctx);
            return { ok: false, error: 'conflict' };
        }
        if (m.relationship === to) return { ok: true };
        if (!(await setMembershipRelationship(db, membershipId, m.relationship, to))) {
            logger.info('updateHouseholdMembership: refused, changed meanwhile', ctx);
            return { ok: false, error: 'conflict' };
        }
        const kind = await historyKindForOwner(actor, person.addedBy, ctx);
        await db.insert(adopterHistory).values({
            id: crypto.randomUUID(), adopterId: person.id, changedBy: actor, kind, changedAt: new Date(),
            changes: JSON.stringify({ household_relationship_changed: { membershipId, householdId: m.householdId, from: m.relationship, to } }),
        }).catch((e: unknown) => {
            logger.error('updateHouseholdMembership: relationship saved, history not written', e, ctx);
        });
        logAudit({ userEmail: actor, action: 'household_relationship_changed', target: person.id, details: { membershipId, householdId: m.householdId, from: m.relationship, to } });
        const relative = m.relativeToAdopterId ? await liveProfile(db, m.relativeToAdopterId) : null;
        await notifyHouseholdRelationshipChanged({
            householdId: m.householdId, membershipId, person: { id: person.id, name: person.name }, relationship: to,
            relativeName: relative && relative.id !== person.id ? relative.name : null, actor,
        });
        return { ok: true };
    } catch (e) {
        const errorId = logger.error('updateHouseholdMembership failed', e, ctx);
        return { ok: false, error: 'failed', errorId };
    }
}

// ─────────────────────────── Remove ───────────────────────────

export async function removeHouseholdMembership(
    input: { membershipId: string; reason: 'mistake' | 'not_living' },
): Promise<{ ok: true; correctionId: string | null } | Fail> {
    const actor = await sessionActor();
    if (!actor) return { ok: false, error: 'not_authenticated' };
    const membershipId = id200(input?.membershipId);
    const reason = input?.reason;
    const ctx: Record<string, unknown> = { membershipId, actor, reason };
    if (!membershipId || (reason !== 'mistake' && reason !== 'not_living')) return { ok: false, error: 'invalid' };
    try {
        const db = await getDb();
        if (!db) throw new Error('No database');
        const m = await membershipById(db, membershipId);
        if (!m) return { ok: false, error: 'not_found' };
        Object.assign(ctx, { householdId: m.householdId, profileId: m.adopterId });

        // Who may: the adder, the team of any profile in the household, admins/moderators.
        const group = await membershipsOf(db, m.householdId);
        const profiles = new Map<string, ProfileRow>();
        for (const p of await Promise.all(group.map(g => liveProfile(db, g.adopterId)))) if (p) profiles.set(p.id, p);
        const { isModeratorOrAdminAsync } = await import('@/config/admins');
        const [isStaff, privileged, isOwnTeam] = await Promise.all([
            isModeratorOrAdminAsync(actor),
            Promise.all([...profiles.values()].map(async p => [p.id, await isPrivilegedOnProfile(actor, p.addedBy)] as const)).then(e => new Map(e)),
            ownTeamOf(actor, group.map(g => g.addedBy), ctx),
        ]);
        // Standing comes from each live profile's own membership — never one the actor's team added.
        const standing = group.filter(g => profiles.has(g.adopterId));
        if (!canRemoveMembership({ email: actor, isAdmin: !!isStaff, privilegedOn: id => !!privileged.get(id), isOwnTeam }, m, standing)) {
            logger.warn('removeHouseholdMembership: refused — not the adder, a household team or staff', ctx);
            return { ok: false, error: 'not_authorized' };
        }

        const { removed, correctionId } = await removeMembership(db, membershipId, actor, { correction: reason === 'not_living' });
        if (!removed) return { ok: false, error: 'not_found' };

        const person = profiles.get(m.adopterId) ?? null;
        const remaining = [...profiles.values()].filter(p => p.id !== m.adopterId);
        // «el grupo familiar de Pedro»: the person they were added next to, else the oldest housemate.
        const host = remaining.find(p => p.id === m.relativeToAdopterId) ?? remaining[0] ?? null;
        const kinds = await Promise.all([person, ...remaining].map(p => (p ? historyKindForOwner(actor, p.addedBy, ctx) : Promise.resolve(null))));
        const now = new Date();
        const rows = [
            ...(person ? [db.insert(adopterHistory).values({
                id: crypto.randomUUID(), adopterId: person.id, changedBy: actor, kind: kinds[0]!, changedAt: now,
                changes: JSON.stringify(reason === 'not_living'
                    ? { household_not_living_together: { hostId: host?.id ?? null, hostName: host?.name ?? null, householdId: m.householdId } }
                    : { household_removed_by_host: { hostId: host?.id ?? null, hostName: host?.name ?? null, householdId: m.householdId, reason } }),
            })] : []),
            ...remaining.map((p, i) => db.insert(adopterHistory).values({
                id: crypto.randomUUID(), adopterId: p.id, changedBy: actor, kind: kinds[i + 1]!, changedAt: now,
                changes: JSON.stringify({ household_member_removed: { id: membershipId, householdId: m.householdId, reason: reason === 'not_living' ? 'not_living_together' : 'mistake', linkedId: m.adopterId } }),
            })),
        ];
        if (rows.length) {
            await runBatch(db, rows as [typeof rows[number], ...typeof rows]).catch((e: unknown) => {
                // The removal (and correction) already landed; a retry would find nothing to remove.
                logger.error('removeHouseholdMembership: removed, history not written', e, ctx);
            });
        }
        logAudit({ userEmail: actor, action: reason === 'not_living' ? 'household_not_living_together' : 'household_member_removed', target: m.adopterId, details: { membershipId, householdId: m.householdId, reason, correctionId } });
        logger.info('removeHouseholdMembership: removed', { ...ctx, correctionId });
        if (person) {
            await notifyHouseholdMemberRemoved({
                householdId: m.householdId, membershipId, person: { id: person.id, name: person.name }, hostName: host?.name ?? null,
                reason, remainingIds: remaining.map(p => p.id), actor,
            });
        }
        return { ok: true, correctionId };
    } catch (e) {
        const errorId = logger.error('removeHouseholdMembership failed', e, ctx);
        return { ok: false, error: 'failed', errorId };
    }
}

// ─────────────────────────── «¿Es este perfil?» ───────────────────────────

/**
 * The candidates for the add form: «Nuevo adoptante»'s own duplicate check
 * (findFormDuplicates — fuzzy name, phone-suffix, masked exactly as there),
 * each with its household line («Convive con Pedro ★1») so a relative of a
 * flagged person is recognised before saving. The anchor is never its own
 * candidate. Never throws: a failure means no suggestions (logged).
 */
export async function getHouseholdMatchCandidates(
    input: { name?: string; contactEntries?: HouseholdContactInput[]; anchorAdopterId?: string },
): Promise<{ results: HouseholdMatchCandidate[]; failed?: true; errorId?: string }> {
    const actor = await sessionActor();
    if (!actor) return { results: [] };
    const anchorId = id64(input?.anchorAdopterId);
    const ctx = { actor, anchorId: anchorId || null };
    try {
        const name = typeof input?.name === 'string' ? input.name.trim().slice(0, 200) : '';
        const typed = Array.isArray(input?.contactEntries) ? input.contactEntries.slice(0, MAX_CONTACTS) : [];
        const pick = (t: ContactEntry['type']) => typed
            .filter(e => e && e.type === t && typeof e.value === 'string')
            .map(e => e.value.trim().slice(0, 500))
            .filter(Boolean);
        const { results, failed } = await searchFormDuplicates(
            { name, phones: pick('phone'), emails: pick('email'), socials: pick('social'), ...(anchorId ? { excludeAdopterId: anchorId } : {}) },
            { minRelevance: 15, allowContactOnly: true },
            async () => actor,
        );
        if (failed) throw new Error('duplicate check failed');
        const matches = results.filter(r => r.adopter.id !== anchorId);
        if (matches.length === 0) return { results: [] };
        const db = await getDb();
        if (!db) throw new Error('No database');
        // The household line already rides on each candidate (hydrateDuplicateMatches);
        // read it here only for one that came without it.
        const missing = matches.filter(r => !r.households).map(r => r.adopter.id);
        const lines = missing.length > 0 ? await householdLinesFor(db, actor, missing) : {};
        return { results: matches.map(r => ({ ...r, householdLine: r.households ?? lines[r.adopter.id] ?? [] })) };
    } catch (e) {
        // The form says the check failed (with this id) and lets the rescuer decide — never a silent «new».
        const errorId = logger.error('getHouseholdMatchCandidates failed — the form shows no suggestions', e, ctx);
        return { results: [], failed: true, errorId };
    }
}

// ─────────────────────────── Gift recipient ───────────────────────────

export type CreateGiftRecipientProfileResult =
    | { ok: true; profileId: string; householdId: string; membershipId: string; created: boolean }
    | Fail;

/**
 * «Crear perfil de {nombre}» on the giver's «Destinatario del regalo (según el
 * formulario)» (spec «Gift recipient»): a rescuer who confirmed who the
 * recipient is makes the profile from that gift form's answers — owner = the
 * giver's owner, the phone credited to the form — in a gift household with the
 * giver, never «Convive con». Open to the giver's team (owner, org-mates) and
 * admins. Once per form: a repeat answers the same profile (`created: false`);
 * two at once → one profile, the other `conflict`.
 */
export async function createGiftRecipientProfile(
    input: { giverAdopterId: string; submissionId: string },
): Promise<CreateGiftRecipientProfileResult> {
    const actor = await sessionActor();
    if (!actor) return { ok: false, error: 'not_authenticated' };
    const giverId = id64(input?.giverAdopterId);
    const submissionId = id64(input?.submissionId);
    const ctx = { actor, giverAdopterId: giverId, submissionId };
    if (!giverId || !submissionId) return { ok: false, error: 'invalid' };
    try {
        const db = await getDb();
        if (!db) throw new Error('No database');
        const giver = await liveProfile(db, giverId);
        if (!giver) return { ok: false, error: 'not_found' };
        const { mayCreateGiftRecipient, createGiftRecipientFromForm } = await import('@/lib/householdPeople');
        if (!(await mayCreateGiftRecipient(actor, giver.addedBy))) {
            logger.info('createGiftRecipientProfile: refused, not the giver\'s team or an admin', ctx);
            return { ok: false, error: 'not_authorized' };
        }
        const res = await createGiftRecipientFromForm(db, { giverAdopterId: giver.id, submissionId, actor });
        return res;
    } catch (e) {
        const errorId = logger.error('createGiftRecipientProfile failed', e, ctx);
        return { ok: false, error: 'failed', errorId };
    }
}
