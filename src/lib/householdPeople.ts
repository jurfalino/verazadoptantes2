/**
 * Households as profiles — the paths where nobody can answer «¿Es este
 * perfil?» (spec «When nobody can answer», Jon 2026-10-26): the public
 * adoption form, POST /api/adopters (post importer), the interview, plus the
 * gift recipient's «Crear perfil».
 *
 * Matching is EXACTLY the API's exact mode — `findIdentifierHits`
 * (src/lib/api/profiles.ts) + `decideExactOutcome` (src/domain/apiExactMatch.ts):
 * phone (read with the owner's country), email, ID number; the name must fit
 * the profile's own name or alias; exactly one consistent profile → that
 * profile joins the household. Anything else creates a new profile, and the
 * normal duplicate scan sends any likely match to «Pendientes de revisar».
 *
 * Nothing here writes `adopters.household_members`: the household tables are
 * the record. Plain server module (NOT 'use server'): nothing here is a
 * browser-callable endpoint. D1: no IN lists; bounded single-row queries.
 */
import { eq } from 'drizzle-orm';
import { adopterHistory, adopters, formSubmissions, householdMemberships, households } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { runBatch } from '@/lib/dbBatch';
import { isRealActorEmail, maskHouseholdMembers } from '@/lib/piiAccess';
import { isPiiGatingEnabled, isPublicProfilesEnabled, maskOptionsFor, resolveAdoptersVisibility } from '@/lib/piiAccessServer';
import { historyKind, isPrivilegedOnProfile } from '@/lib/profilePrivilege';
import { normalizeText } from '@/lib/tokenizer';
import { serializeHouseholdMembers, type HouseholdMember } from '@/lib/householdMembers';
import type { ContactEntry } from '@/lib/contactEntries';
import { findIdentifierHits, ownerCountry as apiOwnerCountry } from '@/lib/api/profiles';
import {
    addMembership, claimMembershipRecord, ensureHousehold, hasCorrection, householdExists, householdIdsOf,
    isMemberOf, membershipsOf, releaseMembershipRecord,
} from '@/lib/households';
import { notifyHouseholdPersonAdded, notifyHouseholdReaddDisputed } from '@/lib/householdNotices';
import { FORM_SENTINEL, giftProfileOf, giftRecipientsOf, giftSourceKey, type FormGiftRecipient } from '@/lib/giftRecipients';
import { decideExactOutcome, isFullName, isUsableDocumentId } from '@/domain/apiExactMatch';
import { hasMinimumIdentifier } from '@/domain/adopterIdentity';
import { MAX_HOUSEHOLD_MEMBERS, MAX_HOUSEHOLDS_PER_PROFILE } from '@/domain/households';
import { parseGiftRecipient, recipientFullName } from '@/domain/giftRecipient';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sameEmail = (a: string | null | undefined, b: string | null | undefined) =>
    !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

// ─────────────────────────── Matching ───────────────────────────

export type UnattendedPerson = { name: string; phone?: string | null; email?: string | null; documentId?: string | null };

/**
 * The existing profile an unattended add should use, or null (→ a new
 * profile). Exactly the API's exact mode, with the API's own input gates: a
 * full name («Nombre Apellido», isFullName) and at least one identifier
 * (phone, email, a usable ID number); otherwise no lookup at all.
 *
 * Only the person's OWN names count (profile name, aliases): a profile the
 * identifier hit whose HOUSEMATE carries the name is somebody else — that is
 * the API's `household_member` match, which here would put the host in their
 * own household. Phones are read with `ownerCountry` (the form's / importer's
 * owner), as the API reads them with the key owner's. Throws on a DB failure.
 */
export async function resolveHouseholdPerson(
    db: Db,
    person: UnattendedPerson,
    ownerCountry: string | null,
    requestId: string,
): Promise<{ profileId: string } | null> {
    const name = (person.name ?? '').trim();
    if (!isFullName(name)) return null;
    const phone = person.phone?.trim() || undefined;
    const email = person.email?.trim() || undefined;
    const doc = person.documentId?.trim() && isUsableDocumentId(person.documentId) ? person.documentId.trim() : undefined;
    if (!phone && !email && !doc) return null;
    const hits = await findIdentifierHits(db, { fullName: name, phone, email, ...(doc ? { documentId: { value: doc } } : {}) }, requestId, ownerCountry);
    const outcome = decideExactOutcome(name, hits.candidates.map(c => ({ ...c, householdNames: [] })));
    if (outcome.result !== 'found' || outcome.nameMatchedAs === 'household_member') return null;
    return { profileId: outcome.profileId };
}

// ─────────────────────────── Attaching people ───────────────────────────

export type AttachPerson = {
    /** May be empty when a contact identifies the person (hasMinimumIdentifier). */
    name: string;
    /** Outside RELATIONSHIPS → 'unknown'. */
    relationship?: string | null;
    /** A whole 0–120 (new profiles only: an existing profile's age is changed on its own profile). */
    age?: number | null;
    /** «Es menor de edad» with no age (new profiles only). */
    isMinor?: boolean;
    /** Their own contacts, already credited (`addedBy`). */
    contactEntries?: ContactEntry[];
    /** The stable position this person had in the caller's input (default: the array index) — the source_key suffix. */
    index?: number;
};

export type AttachInput = {
    /** The profile the people live with (the applicant, the imported person, the interviewed person). */
    anchorAdopterId: string;
    people: AttachPerson[];
    /** Who is credited: a rescuer's email, or a sentinel such as 'form-submission'. */
    actor: string;
    /** Owns every profile created here (spec: from a form, the form's owner). Also whose country phones are read with. */
    ownerEmail: string;
    /**
     * Where they came from, e.g. `form-{submissionId}`, `import:{adopterId}`, `interview:{id}`.
     * Each person's membership stores `{sourceKey}-{index}` and is looked up first, so a
     * replay reuses that membership and its person.
     */
    sourceKey: string;
    requestId?: string;
};

export type AttachSkipReason = 'no_identifier' | 'same_name_in_household' | 'same_as_anchor' | 'household_full' | 'too_many_households' | 'failed';
export type AttachResult = {
    householdId: string | null;
    /** Profiles made here. */
    created: string[];
    /** Existing profiles that joined (exact match), or that a replay found already placed. */
    reused: string[];
    skipped: Array<{ index: number; reason: AttachSkipReason; errorId?: string }>;
};

type AnchorRow = { id: string; name: string; addedBy: string | null; deletedAt: Date | null };

async function liveRow(db: Db, id: string): Promise<AnchorRow | null> {
    const row = await db.select({ id: adopters.id, name: adopters.name, addedBy: adopters.addedBy, deletedAt: adopters.deletedAt })
        .from(adopters).where(eq(adopters.id, id)).get() as AnchorRow | undefined;
    return row && !row.deletedAt ? row : null;
}

/** The membership an earlier run of the same source wrote, if it is still there. */
async function membershipBySourceKey(db: Db, sourceKey: string): Promise<{ id: string; adopterId: string; householdId: string } | null> {
    const row = await db.select({ id: householdMemberships.id, adopterId: householdMemberships.adopterId, householdId: householdMemberships.householdId })
        .from(householdMemberships).where(eq(householdMemberships.sourceKey, sourceKey)).limit(1).get() as { id: string; adopterId: string; householdId: string } | undefined;
    return row ?? null;
}

/** «form», «import», «interview»… — the history's `via`. */
const viaOf = (sourceKey: string) => sourceKey.split(/[-:]/)[0] || 'unknown';

/** Soft-delete a profile made here that never got its membership (a retry must not leave two live ones). */
async function undoCreated(db: Db, profileId: string, ctx: Record<string, unknown>): Promise<void> {
    try {
        const { duplicateTokens } = await import('@/db/schema');
        await runBatch(db, [
            db.update(adopters).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(adopters.id, profileId)),
            db.delete(duplicateTokens).where(eq(duplicateTokens.adopterId, profileId)),
        ]);
        logger.warn('attachHouseholdPeople: membership not placed, new profile undone', { ...ctx, profileId });
    } catch (e) {
        logger.error('attachHouseholdPeople: membership not placed and the new profile could not be undone', e, { ...ctx, profileId });
    }
}

/**
 * Put the people a form / import / interview names in the anchor's household
 * (its own home, made when it has none — ensureHousehold). For each person:
 * the membership an earlier run wrote under the same source key (a replay →
 * nothing new); else someone of the same name already in that household (the
 * interview's «no duplicates by name»); else the exact match
 * (resolveHouseholdPerson); else a new profile owned by `ownerEmail`
 * (createHouseholdProfile: protected, contacts as given, age) whose likely
 * duplicates — never its housemates — go to «Pendientes de revisar». Then the
 * membership next to the anchor, credited to `actor`, with its history,
 * audit and the household notices (as addHouseholdPerson). An existing
 * profile keeps its own name and age; contacts typed for it are added through
 * addContactEntry when the actor is a signed-in rescuer.
 *
 * Never writes adopters.household_members. One person's failure is logged
 * and skipped (the others still go in); never throws for a person, only when
 * the anchor's household can't be made.
 */
export async function attachHouseholdPeople(db: Db, input: AttachInput): Promise<AttachResult> {
    const result: AttachResult = { householdId: null, created: [], reused: [], skipped: [] };
    const requestId = input.requestId ?? `hh-attach-${crypto.randomUUID().slice(0, 8)}`;
    const ctx: Record<string, unknown> = { anchorId: input.anchorAdopterId, actor: input.actor, sourceKey: input.sourceKey, requestId };
    if (!input.people.length) return result;
    const anchor = await liveRow(db, input.anchorAdopterId);
    if (!anchor) {
        logger.warn('attachHouseholdPeople: anchor missing or deleted, nobody attached', ctx);
        return result;
    }
    const realActor = isRealActorEmail(input.actor);
    // Notices need a person: a form's sentinel acts for the form's owner.
    const noticeActor = realActor ? input.actor : input.ownerEmail;
    const { isOwnerOrOrgMate } = await import('@/lib/orgMembership');
    const onAnchorTeam = realActor ? await isOwnerOrOrgMate(input.actor, anchor.addedBy) : true;
    const privilegedOn = async (owner: string | null) =>
        realActor ? await isPrivilegedOnProfile(input.actor, owner) : sameEmail(owner, input.ownerEmail);

    // The owner's country reads the phones (as the API reads them with the key owner's).
    let country: string | null | undefined;
    let countryFailed = false;
    const countryOnce = async (): Promise<string | null> => {
        if (country !== undefined || countryFailed) return country ?? null;
        try {
            country = await apiOwnerCountry(db, input.ownerEmail, requestId);
        } catch (e) {
            countryFailed = true;
            logger.warn('attachHouseholdPeople: owner country unreadable, phones not matched (never guessed)', { ...ctx, error: errMsg(e) });
        }
        return country ?? null;
    };

    // The anchor's household and who is in it by name — made / read on first need.
    let householdId: string | null = null;
    const byName = new Map<string, string>();
    let memberCount = 0;
    const home = async (): Promise<string> => {
        if (householdId) return householdId;
        let id = await ensureHousehold(db, anchor.id, realActor ? input.actor : null);
        if (!(await householdExists(db, id))) {
            logger.warn('attachHouseholdPeople: household gone after ensureHousehold (lost race), retrying', { ...ctx, householdId: id });
            id = await ensureHousehold(db, anchor.id, realActor ? input.actor : null);
        }
        const members = await membershipsOf(db, id, MAX_HOUSEHOLD_MEMBERS + 1);
        memberCount = members.length;
        const rows = await Promise.all(members.filter(m => m.adopterId !== anchor.id).map(m => liveRow(db, m.adopterId)));
        for (const r of rows) if (r?.name?.trim()) byName.set(normalizeText(r.name.trim()), r.id);
        householdId = id;
        result.householdId = id;
        return id;
    };

    for (let i = 0; i < input.people.length; i++) {
        const p = input.people[i];
        const index = p.index ?? i;
        const key = `${input.sourceKey}-${index}`;
        const pctx = { ...ctx, index };
        let createdId: string | null = null;
        try {
            const prior = await membershipBySourceKey(db, key);
            if (prior) {
                result.householdId = result.householdId ?? prior.householdId;
                result.reused.push(prior.adopterId);
                logger.info('attachHouseholdPeople: already attached by an earlier run, reused', { ...pctx, membershipId: prior.id });
                continue;
            }
            const name = (p.name ?? '').trim().slice(0, 200);
            const entries = p.contactEntries ?? [];
            if (!hasMinimumIdentifier({ name, contactEntries: entries.length ? JSON.stringify(entries) : null })) {
                result.skipped.push({ index, reason: 'no_identifier' });
                continue;
            }
            // Who they are: exactly the API's exact match, else a new profile.
            const phone = entries.find(e => e.type === 'phone' && e.value?.trim())?.value;
            const email = entries.find(e => e.type === 'email' && e.value?.trim())?.value;
            const documentId = entries.find(e => e.type === 'id' && e.value?.trim())?.value;
            let personId: string | null = null;
            if (name && (phone || email || documentId)) {
                try {
                    const c = phone ? await countryOnce() : null;
                    const hit = await resolveHouseholdPerson(db, { name, phone: phone && !countryFailed ? phone : null, email, documentId }, c, requestId);
                    personId = hit?.profileId ?? null;
                } catch (e) {
                    logger.warn('attachHouseholdPeople: exact match failed, a new profile is made (the duplicate scan decides)', { ...pctx, error: errMsg(e) });
                }
            }
            if (personId === anchor.id) {
                result.skipped.push({ index, reason: 'same_as_anchor' });
                logger.info('attachHouseholdPeople: the identifier and name are the anchor\'s own, not added', pctx);
                continue;
            }
            const existing = personId ? await liveRow(db, personId) : null;
            if (personId && !existing) personId = null;

            // Their household — made only now, once someone is really going in.
            const hh = await home();
            const nameKey = name ? normalizeText(name) : '';
            if (!personId && nameKey && byName.has(nameKey)) {
                result.skipped.push({ index, reason: 'same_name_in_household' });
                logger.info('attachHouseholdPeople: someone of that name already lives there, not added again', { ...pctx, householdId: hh, profileId: byName.get(nameKey) });
                continue;
            }

            // Room for them (addHouseholdPerson's caps).
            const alreadyIn = personId ? await isMemberOf(db, hh, personId) : false;
            if (!alreadyIn && memberCount >= MAX_HOUSEHOLD_MEMBERS) {
                result.skipped.push({ index, reason: 'household_full' });
                logger.warn('attachHouseholdPeople: household full, person not added', { ...pctx, householdId: hh, cap: MAX_HOUSEHOLD_MEMBERS });
                continue;
            }
            if (personId && !alreadyIn && (await householdIdsOf(db, personId)).length >= MAX_HOUSEHOLDS_PER_PROFILE) {
                result.skipped.push({ index, reason: 'too_many_households' });
                logger.warn('attachHouseholdPeople: matched profile is in too many households, not added', { ...pctx, profileId: personId, cap: MAX_HOUSEHOLDS_PER_PROFILE });
                continue;
            }

            const contactTypes = entries.map(e => e.type);
            if (!personId) {
                const { createHouseholdProfile } = await import('@/app/actions/_adopterFactory');
                createdId = await createHouseholdProfile(db, {
                    ownerEmail: input.ownerEmail,
                    actor: input.actor,
                    name,
                    contactEntries: entries,
                    age: p.age ?? null,
                    isMinor: p.isMinor,
                    historyKind: historyKind(await privilegedOn(input.ownerEmail)),
                    history: { created_in_household: { anchorId: anchor.id, anchorName: anchor.name, householdId: hh, gift: false, via: viaOf(input.sourceKey), ...(contactTypes.length ? { contactTypes } : {}) } },
                });
                personId = createdId;
                logAudit({ userEmail: input.actor, action: 'adopter_created', target: createdId, details: { name, via: `household-${viaOf(input.sourceKey)}` } });
            }

            let placed: { membershipId: string; created: boolean };
            try {
                placed = await addMembership(db, {
                    householdId: hh, adopterId: personId, relationship: p.relationship ?? 'unknown', relativeToAdopterId: anchor.id,
                    addedBy: input.actor, sourceKey: key,
                });
            } catch (e) {
                if (createdId) await undoCreated(db, createdId, pctx);
                throw e;
            }
            const personName = existing?.name ?? name;
            if (placed.created) memberCount++;
            if (nameKey) byName.set(nameKey, personId);
            (createdId ? result.created : result.reused).push(personId);
            const out = { ...pctx, householdId: hh, membershipId: placed.membershipId, profileId: personId, createdProfile: !!createdId };

            // The add's record, once (claimMembershipRecord), as addHouseholdPerson writes it.
            try {
                if (placed.created && await claimMembershipRecord(db, placed.membershipId)) {
                    const now = new Date();
                    const relationship = p.relationship ?? 'unknown';
                    try {
                        await runBatch(db, [
                            db.insert(adopterHistory).values({
                                id: crypto.randomUUID(), adopterId: anchor.id, changedBy: input.actor, kind: historyKind(await privilegedOn(anchor.addedBy)), changedAt: now,
                                changes: JSON.stringify({ household_member_added: { id: placed.membershipId, householdId: hh, profileId: personId, relationship, via: viaOf(input.sourceKey), ...(contactTypes.length ? { contactTypes } : {}) } }),
                            }),
                            ...(existing ? [db.insert(adopterHistory).values({
                                id: crypto.randomUUID(), adopterId: existing.id, changedBy: input.actor, kind: historyKind(await privilegedOn(existing.addedBy)), changedAt: now,
                                changes: JSON.stringify({ household_joined: { hostId: anchor.id, hostName: anchor.name, householdId: hh, relationship } }),
                            })] : []),
                        ]);
                    } catch (e) {
                        await releaseMembershipRecord(db, placed.membershipId).catch((re: unknown) => {
                            logger.error('attachHouseholdPeople: record claim not released', re, out);
                        });
                        throw e;
                    }
                    logAudit({ userEmail: input.actor, action: 'household_person_added', target: anchor.id, details: { membershipId: placed.membershipId, householdId: hh, profileId: personId, createdProfile: !!createdId, relationship, contactTypes, via: viaOf(input.sourceKey) } });
                    await notifyHouseholdPersonAdded({
                        householdId: hh, membershipId: placed.membershipId,
                        anchor: { id: anchor.id, name: anchor.name, addedBy: anchor.addedBy },
                        person: { id: personId, name: personName },
                        actor: noticeActor, onAnchorTeam, existingProfile: !!existing,
                    });
                    if (await hasCorrection(db, hh, personId)) {
                        logger.info('attachHouseholdPeople: re-added after «No vive acá», dispute', out);
                        await notifyHouseholdReaddDisputed({ householdId: hh, membershipId: placed.membershipId, person: { id: personId, name: personName }, hostName: anchor.name, actor: noticeActor });
                    }
                }
            } catch (e) {
                logger.error('attachHouseholdPeople: a step after the person was placed failed (the add stands)', e, out);
            }

            // A new profile's likely duplicates → «Pendientes de revisar», never its housemates (spec anti-goal).
            if (createdId) {
                const { findAndPersistDuplicateCandidates } = await import('@/app/actions/_adopterFactory');
                const { sameHousehold } = await import('@/lib/households');
                await findAndPersistDuplicateCandidates(db, createdId, {
                    name, phone, email, documentId,
                    socials: entries.filter(e => e.type === 'social').map(e => e.value),
                }, { skipPair: async other => other === anchor.id || await sameHousehold(db, createdId!, other) });
            }

            // Contacts typed for an existing profile: addContactEntry's semantics (deduped, credited, grants).
            if (existing && realActor) {
                const { addContactEntry } = await import('@/app/actions/addContactEntry');
                for (const c of entries) {
                    if (c.type === 'alias') continue;
                    const res = await addContactEntry({
                        adopterId: existing.id, type: c.type, value: c.value,
                        ...(c.streetAndNumber ? { streetAndNumber: c.streetAndNumber } : {}),
                        ...(c.locality ? { locality: c.locality } : {}),
                        ...(c.platform ? { platform: c.platform } : {}),
                        ...(c.apps?.length ? { apps: c.apps } : {}),
                    }).catch((e: unknown) => ({ ok: false as const, error: errMsg(e) }));
                    if (!res.ok) logger.warn('attachHouseholdPeople: a contact for the matched profile was not added', { ...out, type: c.type, error: res.error });
                }
            } else if (existing && entries.length) {
                logger.info('attachHouseholdPeople: contacts for a matched profile not added (no signed-in actor)', { ...out, contacts: entries.length });
            }
        } catch (e) {
            const errorId = logger.error('attachHouseholdPeople: person not attached', e, { ...pctx, createdProfile: createdId });
            result.skipped.push({ index, reason: 'failed', errorId });
        }
    }
    logger.info('attachHouseholdPeople: done', { ...ctx, householdId: result.householdId, created: result.created.length, reused: result.reused.length, skipped: result.skipped.length });
    return result;
}

// ─────────────────────────── Gift recipient ───────────────────────────

export type GiftRecipientView = FormGiftRecipient & {
    /** Masked like the giver's household members were for this viewer (name partly revealed, phone masked). */
    masked: boolean;
};

/**
 * The gift recipients the giver's gift forms named, as `viewer` may see them
 * on the giver's profile: masked exactly as the giver's household members
 * were (maskHouseholdMembers with the giver's visibility) — never more than
 * before. Never throws: a failure is logged and gives [].
 */
export async function giftRecipientsForViewer(db: Db, viewer: string | null | undefined, giverAdopterId: string): Promise<GiftRecipientView[]> {
    const ctx = { adopterId: giverAdopterId, viewer: viewer ?? null };
    try {
        const giver = await db.select({ id: adopters.id, addedBy: adopters.addedBy, isPublic: adopters.isPublic, deletedAt: adopters.deletedAt })
            .from(adopters).where(eq(adopters.id, giverAdopterId)).get() as { id: string; addedBy: string | null; isPublic: number | null; deletedAt: Date | null } | undefined;
        if (!giver || giver.deletedAt) return [];
        const recipients = await giftRecipientsOf(db, giverAdopterId);
        if (recipients.length === 0) return [];
        if (!(await isPiiGatingEnabled())) return recipients.map(r => ({ ...r, masked: false }));
        const [visibility, publicFlag] = await Promise.all([
            resolveAdoptersVisibility(viewer ?? null, [{ id: giver.id, addedBy: giver.addedBy }]).then(m => m.get(giver.id)),
            isPublicProfilesEnabled(),
        ]);
        if (!visibility) return recipients.map(r => ({ ...r, phone: null, name: '', masked: true }));
        const asMembers: HouseholdMember[] = recipients.map(r => ({
            id: r.submissionId, name: r.name, relationship: r.relationship, giftRecipient: true, addedBy: FORM_SENTINEL,
            contactEntries: r.phone ? [{ id: `${r.submissionId}-phone`, type: 'phone', value: r.phone, addedBy: FORM_SENTINEL }] : [],
        }));
        const m = maskHouseholdMembers(serializeHouseholdMembers(asMembers), visibility, { ...maskOptionsFor(publicFlag, giver), viewerEmail: viewer ?? undefined });
        return recipients.map(r => {
            const mm = m.members.find(x => x.id === r.submissionId);
            const phone = mm?.contactEntries.find(e => e.type === 'phone')?.value ?? null;
            return { ...r, name: mm?.name ?? '', phone, masked: (mm?.name ?? '') !== r.name || phone !== r.phone };
        });
    } catch (e) {
        logger.warn('giftRecipientsForViewer: read failed, no gift block shown', { ...ctx, error: errMsg(e) });
        return [];
    }
}

export type CreateGiftRecipientResult =
    | { ok: true; profileId: string; householdId: string; membershipId: string; created: boolean }
    | { ok: false; error: 'not_found' | 'too_many_households' | 'conflict' };

/** A gift household someone claimed but never filled (crashed mid-way) is reclaimed after this long. */
const ABANDONED_GIFT_CLAIM_MS = 2 * 60 * 1000;

/**
 * «Crear perfil de {nombre}» (spec «Gift recipient»): the profile of the
 * recipient one gift form named, made from the form's answers — owner = the
 * giver's owner, the phone credited to the form — in a gift household of its
 * own with the giver (recipient first, `gift_recipient = 1`; the giver's row
 * has no adder), never «Convive con». The caller checks who may do it.
 *
 * Once per form: the household id `hh-gift-{submissionId}` is the claim
 * (insert-or-ignore), so a double click makes one profile; the membership's
 * `source_key = gift-{submissionId}` finds it again. Throws on a DB failure
 * (a claim that fails mid-way is taken back).
 */
export async function createGiftRecipientFromForm(
    db: Db,
    input: { giverAdopterId: string; submissionId: string; actor: string },
): Promise<CreateGiftRecipientResult> {
    const ctx = { giverAdopterId: input.giverAdopterId, submissionId: input.submissionId, actor: input.actor };
    const giver = await liveRow(db, input.giverAdopterId);
    if (!giver) return { ok: false, error: 'not_found' };
    const sub = await db.select({ id: formSubmissions.id, linkedAdopterId: formSubmissions.linkedAdopterId, intent: formSubmissions.intent, answersJson: formSubmissions.answersJson })
        .from(formSubmissions).where(eq(formSubmissions.id, input.submissionId)).get() as { id: string; linkedAdopterId: string | null; intent: string | null; answersJson: string | null } | undefined;
    if (!sub || sub.linkedAdopterId !== giver.id || sub.intent !== 'gift') {
        logger.info('createGiftRecipientFromForm: no gift form of this profile', ctx);
        return { ok: false, error: 'not_found' };
    }
    let answers: unknown = null;
    try { answers = sub.answersJson ? JSON.parse(sub.answersJson) : null; } catch (e) {
        logger.warn('createGiftRecipientFromForm: answers unreadable', { ...ctx, error: errMsg(e) });
    }
    const recipient = parseGiftRecipient((answers as { giftRecipient?: unknown } | null)?.giftRecipient);
    const name = recipient ? recipientFullName(recipient) : null;
    if (!recipient || !name) return { ok: false, error: 'not_found' };

    const sourceKey = giftSourceKey(sub.id);
    const already = async (): Promise<CreateGiftRecipientResult | null> => {
        const m = await membershipBySourceKey(db, sourceKey);
        const live = m ? await giftProfileOf(db, sub.id) : null;
        return m && live ? { ok: true, profileId: m.adopterId, householdId: m.householdId, membershipId: m.id, created: false } : null;
    };
    const done = await already();
    if (done) return done;
    if ((await householdIdsOf(db, giver.id)).length >= MAX_HOUSEHOLDS_PER_PROFILE) {
        logger.info('createGiftRecipientFromForm: refused, the giver is in too many households', ctx);
        return { ok: false, error: 'too_many_households' };
    }

    // The claim: one household per form.
    const householdId = `hh-gift-${sub.id}`;
    const claim = () => db.insert(households).values({ id: householdId, createdBy: input.actor, createdAt: new Date() })
        .onConflictDoNothing().returning({ id: households.id });
    let won = (await claim()).length > 0;
    if (!won) {
        const again = await already();
        if (again) return again;
        const row = await db.select({ createdAt: households.createdAt }).from(households).where(eq(households.id, householdId)).get() as { createdAt: Date | null } | undefined;
        const stale = !!row?.createdAt && Date.now() - new Date(row.createdAt).getTime() > ABANDONED_GIFT_CLAIM_MS;
        if (stale && (await membershipsOf(db, householdId, 1)).length === 0) {
            logger.warn('createGiftRecipientFromForm: abandoned claim reclaimed', ctx);
            await db.delete(households).where(eq(households.id, householdId));
            won = (await claim()).length > 0;
        }
        if (!won) {
            logger.info('createGiftRecipientFromForm: another request is making this profile', ctx);
            return { ok: false, error: 'conflict' };
        }
    }

    let profileId: string | null = null;
    try {
        const { createHouseholdProfile } = await import('@/app/actions/_adopterFactory');
        const entries: ContactEntry[] = recipient.phone ? [{ id: crypto.randomUUID(), type: 'phone', value: recipient.phone, addedBy: FORM_SENTINEL }] : [];
        const privileged = await isPrivilegedOnProfile(input.actor, giver.addedBy);
        profileId = await createHouseholdProfile(db, {
            ownerEmail: giver.addedBy ?? 'anonymous',
            actor: input.actor,
            name,
            contactEntries: entries,
            historyKind: historyKind(privileged),
            history: { created_in_household: { anchorId: giver.id, anchorName: giver.name, householdId, gift: true, submissionId: sub.id, ...(entries.length ? { contactTypes: ['phone'] } : {}) } },
        });
        // Recipient first: the household is a gift one from its first membership (Task 1).
        const placed = await addMembership(db, {
            householdId, adopterId: profileId, relationship: recipient.relationship, relativeToAdopterId: giver.id,
            giftRecipient: true, addedBy: input.actor, sourceKey,
        });
        await addMembership(db, { householdId, adopterId: giver.id, relationship: 'unknown', addedBy: null });
        if (await claimMembershipRecord(db, placed.membershipId)) {
            await db.insert(adopterHistory).values({
                id: crypto.randomUUID(), adopterId: giver.id, changedBy: input.actor, kind: historyKind(privileged), changedAt: new Date(),
                changes: JSON.stringify({ household_member_added: { id: placed.membershipId, householdId, profileId, relationship: recipient.relationship, gift: true, submissionId: sub.id } }),
            }).catch(async (e: unknown) => {
                logger.error('createGiftRecipientFromForm: profile made, giver history not written', e, { ...ctx, profileId });
                await releaseMembershipRecord(db, placed.membershipId).catch((re: unknown) => logger.error('createGiftRecipientFromForm: record claim not released', re, ctx));
            });
        }
        logAudit({ userEmail: input.actor, action: 'adopter_created', target: profileId, details: { name, via: 'gift', submissionId: sub.id, giverAdopterId: giver.id } });
        logger.info('createGiftRecipientFromForm: recipient profile made', { ...ctx, profileId, householdId });
        return { ok: true, profileId, householdId, membershipId: placed.membershipId, created: true };
    } catch (e) {
        // Take the claim back so a retry can make it: the memberships, the household, the half-made profile.
        try {
            await runBatch(db, [
                db.delete(householdMemberships).where(eq(householdMemberships.householdId, householdId)),
                db.delete(households).where(eq(households.id, householdId)),
            ]);
            if (profileId) await undoCreated(db, profileId, ctx);
        } catch (ce) {
            logger.error('createGiftRecipientFromForm: claim not taken back', ce, { ...ctx, profileId });
        }
        throw e;
    }
}

/** The giver-side check for «Crear perfil»: the giver's team (owner, org-mates) or an admin (spec). */
export async function mayCreateGiftRecipient(actor: string, giverOwner: string | null): Promise<boolean> {
    const [{ isOwnerOrOrgMate }, { isAdminAsync }] = await Promise.all([import('@/lib/orgMembership'), import('@/config/admins')]);
    return (await isOwnerOrOrgMate(actor, giverOwner)) || (await isAdminAsync(actor));
}
