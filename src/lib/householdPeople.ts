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
import { and, eq, sql } from 'drizzle-orm';
import { adopterHistory, adopters, formSubmissions, householdMemberships, households } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { runAfterResponse } from '@/lib/background';
import { runBatch } from '@/lib/dbBatch';
import { isRealActorEmail, maskHouseholdMembers } from '@/lib/piiAccess';
import { isPiiGatingEnabled, isPublicProfilesEnabled, maskOptionsFor, resolveAdoptersVisibility } from '@/lib/piiAccessServer';
import { historyKind, isPrivilegedOnProfile } from '@/lib/profilePrivilege';
import { serializeHouseholdMembers, type HouseholdMember } from '@/lib/householdMembers';
import type { ContactEntry } from '@/lib/contactEntries';
import { findIdentifierHits, ownerCountry as apiOwnerCountry } from '@/lib/api/profiles';
import {
    addMembership, claimMembershipRecord, ensureHousehold, hasCorrection, householdExists, ordinaryHouseholdCount,
    isMemberOf, membershipBySourceKey, membershipsOf, newMembershipId, releaseMembershipRecord,
} from '@/lib/households';
import { notifyHouseholdPersonAdded, notifyHouseholdReaddDisputed } from '@/lib/householdNotices';
import { FORM_SENTINEL, giftRecipientsOf, giftSourceKey, type FormGiftRecipient } from '@/lib/giftRecipients';
import { decideExactOutcome, isFullName, isUsableDocumentId } from '@/domain/apiExactMatch';
import { hasMinimumIdentifier } from '@/domain/adopterIdentity';
import { MAX_HOUSEHOLD_MEMBERS, MAX_HOUSEHOLDS_PER_PROFILE, householdNameKey } from '@/domain/households';
import { parseGiftRecipient, recipientFullName } from '@/domain/giftRecipient';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
/** Candidates kept per new profile (findAdopters' default duplicate limit). */
const DUPLICATE_SLOTS = 5;
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
 * Only the person's OWN names count (profile name, aliases), as in the API's
 * exact mode: a profile the identifier hit whose HOUSEMATE carries the name is
 * somebody else (it would put the host in their own household). Phones are read with `ownerCountry` (the form's / importer's
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
    const outcome = decideExactOutcome(name, hits.candidates);
    if (outcome.result !== 'found') return null;
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
    /**
     * New profiles are «público» like their host when they arrive with a public host (POST
     * /api/adopters: a public social post — the relatives were readable on it before, as JSON
     * of a public record). Default: protected.
     */
    isPublic?: boolean;
    /**
     * The public form: each new profile's tokenize and duplicate scan run after the response
     * (runAfterResponse), and a name-only person's scan skips the LIKE fallback — one
     * anonymous POST may name up to 15 people. The memberships are placed before the response.
     */
    background?: boolean;
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

/** «form», «import», «interview»… — the history's `via`. */
const viaOf = (sourceKey: string) => sourceKey.split(/[-:]/)[0] || 'unknown';

/** Soft-delete a profile made here that never got its membership (a retry must not leave two live ones). */
async function undoCreated(db: Db, profileId: string, ctx: Record<string, unknown>, why: 'failed' | 'lost_race' = 'failed'): Promise<void> {
    try {
        const { duplicateTokens } = await import('@/db/schema');
        await runBatch(db, [
            db.update(adopters).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(adopters.id, profileId)),
            db.delete(duplicateTokens).where(eq(duplicateTokens.adopterId, profileId)),
        ]);
        if (why === 'lost_race') logger.info('attachHouseholdPeople: a racing run placed this person first, own new profile dropped', { ...ctx, profileId });
        else logger.warn('attachHouseholdPeople: membership not placed, new profile undone', { ...ctx, profileId });
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
    // Today's inline household first (Task 7): the anchor's home and the same-name rule must see it.
    try {
        const { ensureProfileConverted } = await import('@/lib/householdConversion');
        const { failed } = await ensureProfileConverted(db, anchor.id);
        if (failed) logger.warn('attachHouseholdPeople: some of the anchor\'s old household was not converted yet', { ...ctx, failed });
    } catch (e) {
        logger.warn('attachHouseholdPeople: old household conversion failed, attaching anyway', { ...ctx, error: errMsg(e) });
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
        for (const r of rows) if (r?.name?.trim()) byName.set(householdNameKey(r.name), r.id);
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
            const nameKey = householdNameKey(name);
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
            if (personId && !alreadyIn && (await ordinaryHouseholdCount(db, personId)) >= MAX_HOUSEHOLDS_PER_PROFILE) {
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
                    isPublic: input.isPublic === true,
                    skipTokenize: input.background === true,
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
                    // S3: a signed-in typist clears only the pairs they're privileged on both sides of.
                    ...(realActor ? { clearPairs: { actor: input.actor } } : {}),
                });
            } catch (e) {
                // The source key is unique (0098): a run of the same source placed its person
                // between our lookup and our insert. Theirs stands; ours is dropped quietly.
                const winner = await membershipBySourceKey(db, key);
                if (winner) {
                    if (createdId) await undoCreated(db, createdId, pctx, 'lost_race');
                    result.householdId = result.householdId ?? winner.householdId;
                    result.reused.push(winner.adopterId);
                    continue;
                }
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

            // A new profile's likely duplicates → «Pendientes de revisar», never its housemates (spec
            // anti-goal). Enough candidates are fetched that the housemates can't fill every slot.
            if (createdId) {
                const newId = createdId;
                const nameOnly = !phone && !email && !documentId && !entries.some(e => e.type === 'social');
                const index = async () => {
                    if (input.background) {
                        const { tokenizeAdopter } = await import('@/lib/adopterTokenize');
                        await tokenizeAdopter(newId);
                    }
                    const { findAndPersistDuplicateCandidates } = await import('@/app/actions/_adopterFactory');
                    const { sameHousehold } = await import('@/lib/households');
                    await findAndPersistDuplicateCandidates(db, newId, {
                        name, phone, email, documentId,
                        socials: entries.filter(e => e.type === 'social').map(e => e.value),
                    }, {
                        skipPair: async other => other === anchor.id || await sameHousehold(db, newId, other),
                        limit: DUPLICATE_SLOTS + memberCount + 1,
                        keep: DUPLICATE_SLOTS,
                        skipLikeFallback: input.background === true && nameOnly,
                        ctx: out,
                    });
                };
                if (input.background) await runAfterResponse('attachHouseholdPeople.index', index, out);
                else await index();
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
 * `source_key = gift-{submissionId}` (unique) finds it again. A recipient
 * profile since deleted is replaced in place (its row swapped for the new one
 * in one batch), never by deleting the household. Throws on a DB failure (a
 * claim that fails mid-way is taken back).
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
    const householdId = `hh-gift-${sub.id}`;
    // The recipient profile made for this form, while it is live (the source key is unique, 0098).
    const already = async (): Promise<CreateGiftRecipientResult | null> => {
        const m = await membershipBySourceKey(db, sourceKey);
        return m && await liveRow(db, m.adopterId)
            ? { ok: true, profileId: m.adopterId, householdId: m.householdId, membershipId: m.id, created: false }
            : null;
    };
    const keyed = await membershipBySourceKey(db, sourceKey);
    if (keyed && await liveRow(db, keyed.adopterId)) {
        return { ok: true, profileId: keyed.adopterId, householdId: keyed.householdId, membershipId: keyed.id, created: false };
    }
    const privileged = await isPrivilegedOnProfile(input.actor, giver.addedBy);
    const entries: ContactEntry[] = recipient.phone ? [{ id: crypto.randomUUID(), type: 'phone', value: recipient.phone, addedBy: FORM_SENTINEL }] : [];
    const makeProfile = async () => {
        const { createHouseholdProfile } = await import('@/app/actions/_adopterFactory');
        return await createHouseholdProfile(db, {
            ownerEmail: giver.addedBy ?? 'anonymous',
            actor: input.actor,
            name,
            contactEntries: entries,
            historyKind: historyKind(privileged),
            history: { created_in_household: { anchorId: giver.id, anchorName: giver.name, householdId, gift: true, submissionId: sub.id, ...(entries.length ? { contactTypes: ['phone'] } : {}) } },
        });
    };
    /** The add's own record on the giver (once), audit, log. */
    const record = async (membershipId: string, profileId: string) => {
        if (await claimMembershipRecord(db, membershipId)) {
            await db.insert(adopterHistory).values({
                id: crypto.randomUUID(), adopterId: giver.id, changedBy: input.actor, kind: historyKind(privileged), changedAt: new Date(),
                changes: JSON.stringify({ household_member_added: { id: membershipId, householdId, profileId, relationship: recipient.relationship, gift: true, submissionId: sub.id } }),
            }).catch(async (e: unknown) => {
                logger.error('createGiftRecipientFromForm: profile made, giver history not written', e, { ...ctx, profileId });
                await releaseMembershipRecord(db, membershipId).catch((re: unknown) => logger.error('createGiftRecipientFromForm: record claim not released', re, ctx));
            });
        }
        logAudit({ userEmail: input.actor, action: 'adopter_created', target: profileId, details: { name, via: 'gift', submissionId: sub.id, giverAdopterId: giver.id } });
        logger.info('createGiftRecipientFromForm: recipient profile made', { ...ctx, profileId, householdId });
    };

    // A recipient profile made earlier and since deleted is absent, so «Crear perfil» works again —
    // soft-deleted or deleted for good (no row at all) alike: «not live» is what the guards check.
    // The gift household is never deleted or re-claimed for it: the deleted recipient's row is
    // REPLACED by the new one in one batch (delete by id while it still points at the deleted
    // profile + insert under the same unique source key). Two clicks at once: one insert lands,
    // the other finds the winner's row under the key, drops its own profile and answers that one.
    if (keyed && keyed.householdId === householdId) {
        const profileId = await makeProfile();
        const newId = newMembershipId();
        try {
            await runBatch(db, [
                db.delete(householdMemberships).where(and(
                    eq(householdMemberships.id, keyed.id),
                    eq(householdMemberships.adopterId, keyed.adopterId),
                    sql`NOT EXISTS (SELECT 1 FROM adopters a WHERE a.id = ${householdMemberships.adopterId} AND a.deleted_at IS NULL)`,
                )),
                db.insert(householdMemberships).values({
                    id: newId, householdId, adopterId: profileId, relationship: recipient.relationship, relativeToAdopterId: giver.id,
                    giftRecipient: 1, addedBy: input.actor, addedAt: new Date(), sourceKey,
                }).onConflictDoNothing(),
            ]);
        } catch (e) {
            await undoCreated(db, profileId, ctx);
            throw e;
        }
        const now = await membershipBySourceKey(db, sourceKey);
        if (now?.id !== newId) {
            await undoCreated(db, profileId, ctx, 'lost_race');
            const winner = await already();
            if (winner) return winner;
            logger.info('createGiftRecipientFromForm: another request is replacing the deleted recipient', ctx);
            return { ok: false, error: 'conflict' };
        }
        // The giver's own row (no adder), kept from before or put back.
        await addMembership(db, { householdId, adopterId: giver.id, relationship: 'unknown', addedBy: null });
        logger.info('createGiftRecipientFromForm: the deleted recipient was replaced', { ...ctx, profileId, previousProfileId: keyed.adopterId });
        await record(newId, profileId);
        return { ok: true, profileId, householdId, membershipId: newId, created: true };
    }
    if (keyed) {
        // A row under this form's key outside its gift household (never written that way): it goes, by id.
        await db.delete(householdMemberships).where(and(
            eq(householdMemberships.id, keyed.id),
            sql`NOT EXISTS (SELECT 1 FROM adopters a WHERE a.id = ${householdMemberships.adopterId} AND a.deleted_at IS NULL)`,
        ));
        logger.warn('createGiftRecipientFromForm: a deleted recipient\'s row outside the gift household removed', { ...ctx, householdId: keyed.householdId });
    }
    // A gift household never counts toward MAX_HOUSEHOLDS_PER_PROFILE (final fix S4): one per form, no cap check.

    // The claim: one household per form. `claimedAt` is our claim's mark — the cleanup below
    // removes the household only while it still carries it (a takeover replaces it).
    const claimedAt = new Date();
    const claim = () => db.insert(households).values({ id: householdId, createdBy: input.actor, createdAt: claimedAt })
        .onConflictDoNothing().returning({ id: households.id });
    let won = (await claim()).length > 0;
    if (!won) {
        const again = await already();
        if (again) return again;
        const row = await db.select({ createdAt: households.createdAt }).from(households).where(eq(households.id, householdId)).get() as { createdAt: Date | null } | undefined;
        const mark = row?.createdAt ? new Date(row.createdAt).getTime() : null;
        const abandoned = mark !== null && Date.now() - mark > ABANDONED_GIFT_CLAIM_MS;
        if (abandoned && row?.createdAt) {
            // Take it over with a compare-and-set on the mark we read, while it holds no recipient:
            // of two requests taking over at once, exactly one wins, and nothing is deleted.
            const took = await db.update(households).set({ createdBy: input.actor, createdAt: claimedAt })
                .where(and(
                    eq(households.id, householdId),
                    eq(households.createdAt, row.createdAt),
                    sql`NOT EXISTS (SELECT 1 FROM household_memberships m WHERE m.household_id = ${households.id} AND m.gift_recipient = 1)`,
                ))
                .returning({ id: households.id });
            won = took.length > 0;
            if (won) logger.warn('createGiftRecipientFromForm: abandoned claim taken over', ctx);
        }
        if (!won) {
            logger.info('createGiftRecipientFromForm: another request is making this profile', ctx);
            return { ok: false, error: 'conflict' };
        }
    }

    let profileId: string | null = null;
    const mine: string[] = []; // memberships this request created — the only ones its cleanup may remove
    try {
        profileId = await makeProfile();
        // Recipient first: the household is a gift one from its first membership (Task 1).
        const placed = await addMembership(db, {
            householdId, adopterId: profileId, relationship: recipient.relationship, relativeToAdopterId: giver.id,
            giftRecipient: true, addedBy: input.actor, sourceKey,
        });
        if (placed.created) mine.push(placed.membershipId);
        const giverRow = await addMembership(db, { householdId, adopterId: giver.id, relationship: 'unknown', addedBy: null });
        if (giverRow.created) mine.push(giverRow.membershipId);
        await record(placed.membershipId, profileId);
        return { ok: true, profileId, householdId, membershipId: placed.membershipId, created: true };
    } catch (e) {
        // Take OUR claim back so a retry can make it: only the memberships we created, the
        // household only while it still carries our mark and holds nobody (never a winner's
        // rows after a takeover), and the half-made profile.
        try {
            for (const id of mine) await db.delete(householdMemberships).where(eq(householdMemberships.id, id));
            await db.delete(households).where(and(
                eq(households.id, householdId),
                eq(households.createdAt, claimedAt),
                eq(households.createdBy, input.actor),
                sql`NOT EXISTS (SELECT 1 FROM household_memberships m WHERE m.household_id = ${households.id})`,
            ));
            if (profileId) await undoCreated(db, profileId, ctx, 'lost_race');
        } catch (ce) {
            logger.error('createGiftRecipientFromForm: claim not taken back', ce, { ...ctx, profileId });
        }
        // Our claim was taken over while we stalled and the other request made the profile: that one stands.
        const winner = await already();
        if (winner) {
            logger.info('createGiftRecipientFromForm: another request made this profile first, ours dropped', { ...ctx, profileId: winner.ok ? winner.profileId : null });
            return winner;
        }
        throw e;
    }
}

/** The giver-side check for «Crear perfil»: the giver's team (owner, org-mates) or an admin (spec). */
export async function mayCreateGiftRecipient(actor: string, giverOwner: string | null): Promise<boolean> {
    const [{ isOwnerOrOrgMate }, { isAdminAsync }] = await Promise.all([import('@/lib/orgMembership'), import('@/config/admins')]);
    return (await isOwnerOrOrgMate(actor, giverOwner)) || (await isAdminAsync(actor));
}
