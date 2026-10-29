/**
 * Write side of the API: save the activity of an exact call (decisions 7, 7b)
 * and void one (decision 11). Server-only.
 *
 *   found     → the activity goes on that profile (the exact-match rules are
 *               the confirmation of who the person is). Contact details it did
 *               not have yet are added, with a trail (./contacts.ts).
 *   not_found → a new profile + the activity, through the same path the
 *               adoption form uses (tokenized, duplicate candidates written).
 *   ambiguous → several names fit: on the BEST match (pickBestMatch, Jon
 *               2026-10-13). No name fits (the identifier is someone else's):
 *               a NEW profile, with its duplicate candidates for an admin.
 */
import { and, count, eq, gte, isNotNull, isNull, ne, notLike, or } from 'drizzle-orm';
import { activityForms, adopterEvents, adopterHistory, adopterImages, adopters, adoptions, apiRequests, formSubmissions, placements } from '@/db/schema';
import { logger } from '@/lib/logger';
import { runAfterResponse } from '@/lib/background';
import { closeRequestsForDeletedAdopter } from '@/lib/mergeRequestClose';
import { socialUrl, type SocialPlatform } from '@/lib/contactEntries';
import { pickBestMatch, type ExactOutcome } from '@/domain/apiExactMatch';
import { normalizeSpecies } from '@/domain/importRow';
import { parseAgeText } from '@/domain/animalAge';
import { computeBirthDate } from '@/lib/ageUtils';
import { addApiContacts, newContactFields, parseAddedContacts, removeApiContacts } from './contacts';
import { ApiError, recordProgress, type ApiCallContext } from './handler';
import { profileUrl, recordUrl } from './profiles';
import { importModeOn } from './keys';
import { notificationContent } from '@/domain/notificationTemplates';
import { historyKindFor } from '@/lib/profilePrivilege';
import type { ProfileSummary, SavedActivity, SearchRequest } from './schemas';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

/** A YYYY-MM-DD date at local noon, so it never shifts a day across time zones. */
function dayAtNoon(day: string): Date {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
}

/** An ambiguous answer goes on the profile that matches best (pickBestMatch); null = a new profile. Pure. */
export function bestMatchFor(outcome: ExactOutcome, matchedOn: Map<string, string[]>, summaries: Map<string, ProfileSummary>): string | null {
    return outcome.result === 'ambiguous'
        ? pickBestMatch(outcome.compatible, matchedOn, new Map([...summaries].map(([id, s]) => [id, s.lastRecordAt])))
        : null;
}

export async function saveApiActivity(
    ctx: ApiCallContext, req: SearchRequest, outcome: ExactOutcome,
    matchedOn: Map<string, string[]>, summaries: Map<string, ProfileSummary>,
): Promise<SavedActivity> {
    const save = req.activity!;
    const activityType = save.activityType;
    const species = normalizeSpecies(save.species) ?? null;
    const { db, key } = ctx;

    if (save.externalId) {
        // Only a call that actually saved something (still live) holds an
        // externalId; a refused or replayed call with the same id doesn't.
        const taken = await db.select({ id: apiRequests.id }).from(apiRequests).where(and(
            eq(apiRequests.keyId, key.id), eq(apiRequests.externalId, save.externalId),
            eq(apiRequests.endpoint, 'search'), isNull(apiRequests.voidedAt),
            // Saved something: a record, or (a crashed call) at least the profile.
            or(isNotNull(apiRequests.recordId), eq(apiRequests.profileCreated, 1)),
        )).get();
        if (taken && taken.id !== ctx.requestId) {
            throw new ApiError(409, 'external_id_reused', `externalId ${save.externalId} was already saved by this key; use a new externalId, or void the earlier activity first`, {}, { originalRequestId: taken.id });
        }
    }

    let profileId: string;
    let profileCreated = false;
    const best = bestMatchFor(outcome, matchedOn, summaries);
    if (outcome.result === 'found') {
        profileId = outcome.profileId;
    } else if (best) {
        profileId = best;
    } else {
        const p = req.person;
        const { createAdopterFromSubmission } = await import('@/app/actions/_adopterFactory');
        const created = await createAdopterFromSubmission({
            source: 'api',
            api: { keyName: key.name, requestId: ctx.requestId, context: activityType },
            bulkImport: importModeOn(key),
            name: p.fullName!,
            addedBy: key.ownerEmail,
            email: p.email ?? null,
            phone: p.phone ?? null,
            address: p.address ?? null,
            documentId: p.documentId?.value ?? null,
            // A link when it is an account; a display name ("Ana Perez") is kept as text with its platform.
            socials: (p.socials ?? []).map(s => {
                const url = socialUrl(s.handle, s.platform as SocialPlatform);
                return url ?? { value: s.handle.trim(), platform: s.platform as SocialPlatform };
            }),
            animalName: save.animalName ?? null,
            animalSpecies: species,
        });
        profileId = created.adopterId;
        profileCreated = true;
        // Logged the moment it exists: if anything below fails, the claim is
        // not released (no duplicate on retry) and the log shows what was made.
        ctx.log.profileCreated = true;
        ctx.log.profileIds = [profileId];
        await recordProgress(ctx, { profileCreated: true, profileIds: [profileId] });
    }

    const activityDate = save.date ? dayAtNoon(save.date) : new Date();
    // Age as the app stores it: an estimated birth date, counted back from the activity date.
    const age = parseAgeText(save.age);
    const estimatedBirthDate = save.birthDate ? dayAtNoon(save.birthDate) : age ? computeBirthDate(age.value, age.unit, activityDate) : null;
    const { insertRecord } = await import('@/app/actions/_recordWrite');
    const recordId = await insertRecord(db, {
        adopterId: profileId,
        animalName: save.animalName || null,
        species,
        status: 'completed',
        // Optional and never inferred (Jon, 2026-10-09): missing stays NULL.
        rating: save.rating ?? null,
        recordType: activityType,
        date: activityDate,
        details: save.notes || null,
        // The animal, for an adoption / foster (checkSearchRules refuses them on other types).
        age: save.age ?? null,
        estimatedBirthDate: estimatedBirthDate,
        sex: save.sex === 'female' ? 'hembra' : save.sex === 'male' ? 'macho' : null,
        neutered: save.neutered === undefined ? null : save.neutered ? 1 : 0,
        color: save.color ?? null,
        microchip: save.microchip ?? null,
        sourceUrl: null,
    }, key.ownerEmail);
    ctx.log.recordId = recordId;
    await recordProgress(ctx, { recordId, profileIds: [profileId] });

    if (save.formContent) {
        // Stored exactly as sent; never logged (it is the applicant's answers).
        await db.insert(activityForms).values({ activityId: recordId, formContent: JSON.stringify(save.formContent), source: 'api', addedBy: key.ownerEmail });
    }

    // New contact details: only for a certain match on the profile's own name.
    // A field that matched ANOTHER profile is that person's (e.g. Juan's email
    // sent along with Ana's phone): never copied onto this one.
    const matchedElsewhere = [...matchedOn].filter(([id]) => id !== profileId).flatMap(([, fields]) => fields);
    const contactsAdded = outcome.result === 'found' && outcome.nameMatchedAs === 'profile'
        ? await addApiContacts(db, profileId, req.person, newContactFields(req.person, [...(matchedOn.get(profileId) ?? []), ...matchedElsewhere]),
            { ownerEmail: key.ownerEmail, keyName: key.name, requestId: ctx.requestId })
        : [];
    ctx.log.contactsAdded = contactsAdded;

    if (!profileCreated) {
        // A new profile gets its own "created via API" history row from the
        // factory. Best-effort: the record is saved, the call must say so.
        try {
            await db.insert(adopterHistory).values({
                id: crypto.randomUUID(),
                adopterId: profileId,
                changedBy: `api:${key.name}`,
                // An API caller is no editor of the profile (as api/contacts.ts).
                kind: 'contribution',
                changes: JSON.stringify({ record_added_via_api: { requestId: ctx.requestId, recordId, recordType: activityType, ...(best ? { attachedAsBestMatch: true } : {}) } }),
                changedAt: new Date(),
            });
        } catch (e) {
            logger.warn('api: history row for a saved record failed', { requestId: ctx.requestId, profileId, recordId, error: e instanceof Error ? e.message : String(e) });
        }
    }
    logger.info('api: activity saved', { requestId: ctx.requestId, keyId: key.id, owner: key.ownerEmail, profileId, recordId, profileCreated, outcome: outcome.result, activityType, attachedAsBestMatch: !!best, contactsAdded: contactsAdded.map(c => c.field), hasForm: !!save.formContent });

    // One notification per saved record (decision 10), like a form submission.
    await notifyApiRecord(key, {
        requestId: ctx.requestId, profileId, recordId, activityType,
        personName: req.person.fullName!,
        outcome: outcome.result === 'found' ? 'found' : best ? 'best_match' : outcome.result === 'ambiguous' ? 'ambiguous' : 'created',
        rawOutcome: outcome.result,
        contactsAdded: contactsAdded.map(c => c.field),
    });

    return {
        activityId: recordId,
        activityUrl: recordUrl(ctx.origin, profileId, recordId),
        profileId,
        profileUrl: profileUrl(ctx.origin, profileId),
        profileCreated,
        contactsAdded: contactsAdded.map(c => c.field),
    };
}

export interface VoidResult { recordId: string; profileId: string | null; profileVoided: boolean; alreadyVoided?: boolean; changedSince?: boolean }

/** Did anyone or anything but the API put data on this profile? Then it stays. */
/**
 * The owner's (and their team's) notice for a saved API record. Everything —
 * building the text included — runs inside runAfterResponse, which logs a
 * failure and never throws: the record is already saved, so a template that
 * can't render (a missing name, say) must never turn the call into a 500.
 * A key in import mode notifies nobody: thousands of historical records are not news.
 */
export async function notifyApiRecord(
    key: { name: string; ownerEmail: string; importMode?: number | null },
    rec: {
        requestId: string; profileId: string; recordId: string; activityType: string;
        personName: string;
        outcome: 'found' | 'best_match' | 'ambiguous' | 'created';
        rawOutcome: string;
        contactsAdded: string[];
    },
): Promise<void> {
    if (importModeOn(key)) return;
    const { requestId, profileId, recordId } = rec;
    await runAfterResponse('api.notifyRecord', async () => {
        const notification = {
            type: 'api_record' as const,
            ...notificationContent({
                key: 'api_record',
                params: {
                    personName: rec.personName,
                    context: rec.activityType,
                    keyName: key.name,
                    outcome: rec.outcome,
                    ...(rec.contactsAdded.length ? { contactsAdded: rec.contactsAdded.join(',') } : {}),
                },
            }),
            url: `/adopter/${profileId}?record=${encodeURIComponent(recordId)}`,
            icon: rec.rawOutcome === 'ambiguous' ? '⚠️' : '🔌',
            metadata: { requestId, keyName: key.name, profileId, recordId, outcome: rec.rawOutcome, context: rec.activityType, contactsAdded: rec.contactsAdded },
        };
        const { createNotification, notifyOrgMembers } = await import('@/app/actions/notifications');
        await createNotification({ userId: key.ownerEmail, ...notification });
        await notifyOrgMembers({ actorEmail: key.ownerEmail, ...notification });
    }, { requestId, profileId, recordId, keyName: key.name });
}

async function profileHasOtherData(db: Db, profileId: string, recordId: string): Promise<boolean> {
    const [records, anyPlacement, forms, humanEdits] = await Promise.all([
        db.select({ n: count() }).from(adoptions).where(eq(adoptions.adopterId, profileId)).get(),
        // Ended placements too: the view only shows active ones.
        db.select({ n: count() }).from(placements).where(and(eq(placements.adopterId, profileId), ne(placements.animalId, recordId))).get(),
        db.select({ n: count() }).from(formSubmissions).where(eq(formSubmissions.linkedAdopterId, profileId)).get(),
        // A person's edit keeps the profile; earlier voids' own rows don't count.
        db.select({ n: count() }).from(adopterHistory).where(and(
            eq(adopterHistory.adopterId, profileId),
            notLike(adopterHistory.changedBy, 'api:%'),
            notLike(adopterHistory.changes, '%"api_record_voided"%'),
        )).get(),
    ]);
    // Other live API records on it show up in `records` (the adoptions view).
    return (records?.n ?? 0) > 0 || (anyPlacement?.n ?? 0) > 0 || (forms?.n ?? 0) > 0 || (humanEdits?.n ?? 0) > 0;
}

/**
 * Void a record the API created. `keyId` limits it to records that key saved
 * (the endpoint and the rescuer's Settings page); null is the admin, who can
 * void any API-created record. Returns null when this key saved no such record.
 * Voiding twice is not an error: the second call reports `alreadyVoided`.
 *
 * Events have no soft-delete column, so an event is deleted and its content is
 * kept in the profile's history; an animal (adoption / foster) is soft-deleted.
 * The profile goes too only if THIS call created it, the record still sits on
 * it (not merged elsewhere since), and nothing else has been put on it.
 */
export async function voidApiRecord(db: Db, recordId: string, opts: { keyId: string | null; actor: string; requestId: string }): Promise<VoidResult | null> {
    // A call that saved and then crashed (5xx, or a claim left at 0) holds a real
    // activity too: it must be voidable, or its externalId stays stuck (review 2026-10-17).
    const conds = [eq(apiRequests.recordId, recordId), eq(apiRequests.endpoint, 'search'),
        or(eq(apiRequests.httpStatus, 200), eq(apiRequests.httpStatus, 0), gte(apiRequests.httpStatus, 500))];
    if (opts.keyId) conds.push(eq(apiRequests.keyId, opts.keyId));
    const origin = await db.select().from(apiRequests).where(and(...conds)).get() as typeof apiRequests.$inferSelect | undefined;
    if (!origin) return null;
    if (origin.voidedAt) return { recordId, profileId: null, profileVoided: false, alreadyVoided: true };

    // An animal the API placed may have moved on since (re-homed, or placed by
    // someone else). Then it's no longer the API's record to take back: refuse.
    const event = await db.select().from(adopterEvents).where(eq(adopterEvents.id, recordId)).get();
    const ownPlacementId = `${recordId}-plc`;
    if (!event) {
        const later = await db.select({ id: placements.id }).from(placements)
            .where(and(eq(placements.animalId, recordId), ne(placements.id, ownPlacementId))).get();
        if (later) return { recordId, profileId: null, profileVoided: false, changedSince: true };
    }

    // Claim the void, so two concurrent voids can't both run it.
    const now = new Date();
    // Voiding frees the externalId: the same id can be sent again (as a new activity).
    const claimed = await db.update(apiRequests).set({ voidedAt: now, voidedBy: opts.actor, idempotencyKey: null })
        .where(and(eq(apiRequests.id, origin.id), isNull(apiRequests.voidedAt)))
        .returning({ id: apiRequests.id });
    if (!claimed.length) return { recordId, profileId: null, profileVoided: false, alreadyVoided: true };

    let createdProfileId: string | null = null;
    if (origin.profileCreated) {
        try { createdProfileId = (JSON.parse(origin.profileIds ?? '[]') as string[])[0] ?? null; } catch (e) {
            logger.warn('api void: unreadable profileIds on log row', { requestId: opts.requestId, originRequestId: origin.id, error: e instanceof Error ? e.message : String(e) });
        }
    }

    // Where the record sits NOW (an admin may have merged its profile since).
    let currentProfileId: string | null = null;
    if (event) {
        currentProfileId = event.adopterId ?? null;
        await db.delete(adopterImages).where(eq(adopterImages.adoptionId, recordId));
        await db.delete(adopterEvents).where(eq(adopterEvents.id, recordId));
    } else {
        // Its own placement, active or already ended: whoever it was with.
        const placement = await db.select({ adopterId: placements.adopterId }).from(placements)
            .where(eq(placements.id, ownPlacementId)).get();
        currentProfileId = placement?.adopterId ?? null;
        // A voided adoption's signed contract goes too: it was registered by mistake.
        const own = await db.select({ contractKey: placements.contractKey }).from(placements).where(eq(placements.id, ownPlacementId)).get() as { contractKey: string | null } | undefined;
        if (own?.contractKey) {
            const { deleteContract } = await import('@/lib/contractStorage');
            await deleteContract(own.contractKey).catch(e => logger.error('api void: contract file not deleted', e, { requestId: opts.requestId, recordId }));
            await db.update(placements).set({ contractKey: null, contractSha256: null }).where(eq(placements.id, ownPlacementId));
        }
        const { softDeleteAnimal } = await import('@/app/actions/_recordWrite');
        await softDeleteAnimal(db, recordId, opts.actor);
    }

    // The form answers go with the activity; contacts the call added come back off.
    await db.delete(activityForms).where(eq(activityForms.activityId, recordId));
    const addedContacts = parseAddedContacts(origin.contactsAdded, opts.requestId);
    const contactsRemoved = currentProfileId && addedContacts.length
        ? await removeApiContacts(db, currentProfileId, addedContacts, { actor: opts.actor, requestId: opts.requestId })
        : 0;

    let profileVoided = false;
    if (currentProfileId) {
        // Decide BEFORE writing this void's own history row (an admin's would read as a human edit).
        const dropProfile = !!createdProfileId && currentProfileId === createdProfileId
            && !(await profileHasOtherData(db, createdProfileId, recordId));
        // The rescuer voiding (Settings) may be a stranger to the profile the
        // record sits on now: a contribution unless privileged there.
        const voidKind = await historyKindFor(db, currentProfileId, opts.actor);
        await db.insert(adopterHistory).values({
            id: crypto.randomUUID(),
            adopterId: currentProfileId,
            changedBy: opts.actor,
            kind: voidKind,
            changes: JSON.stringify({ api_record_voided: { recordId, originRequestId: origin.id, voidRequestId: opts.requestId, ...(contactsRemoved ? { contactsRemoved } : {}), ...(event ? { removedEvent: event } : {}) } }),
            changedAt: now,
        });
        if (dropProfile) {
            const gone = await db.update(adopters).set({ deletedAt: now, updatedAt: now })
                .where(and(eq(adopters.id, currentProfileId), isNull(adopters.deletedAt)))
                .returning({ id: adopters.id });
            profileVoided = gone.length > 0;
            if (profileVoided) await closeRequestsForDeletedAdopter(db, currentProfileId, opts.actor);
        }
    }

    logger.info('api: record voided', { requestId: opts.requestId, originRequestId: origin.id, recordId, profileId: currentProfileId, profileVoided, actor: opts.actor });
    return { recordId, profileId: currentProfileId, profileVoided };
}

/**
 * POST /api/v1/activities/{id}/contract: the signed adoption / foster contract
 * for an activity THIS key saved. Stored in private storage (one file per
 * contract, src/lib/contractStorage.ts), shown on the profile as "Ver contrato
 * firmado" to the rescue and admins. Never replaced: a wrong contract means
 * voiding the activity and registering it again.
 */
export async function attachApiContract(ctx: ApiCallContext, activityId: string, contentType: string): Promise<{ contentType: string; size: number; sha256: string; profileId: string | null }> {
    const { db, key } = ctx;
    const { CONTRACT_CONTENT_TYPES, storeContract, deleteContract } = await import('@/lib/contractStorage');
    // A dry run must never store a file or link it (same as a void).
    if (ctx.dryRun) throw new ApiError(422, 'dry_run_not_allowed', 'a contract upload cannot be a dry run');
    if (!CONTRACT_CONTENT_TYPES[contentType]) throw new ApiError(415, 'unsupported_media_type', 'send the contract as application/pdf, image/png or image/jpeg');
    if (!ctx.bodyBytes || ctx.bodyBytes.byteLength === 0) throw new ApiError(422, 'invalid_request', 'the request body must be the contract file');

    const origin = await db.select().from(apiRequests).where(and(
        eq(apiRequests.recordId, activityId), eq(apiRequests.keyId, key.id), eq(apiRequests.endpoint, 'search'),
        eq(apiRequests.httpStatus, 200), isNull(apiRequests.voidedAt),
    )).get() as typeof apiRequests.$inferSelect | undefined;
    if (!origin) throw new ApiError(404, 'not_found', 'no activity saved by this key with that id');
    ctx.log.context = origin.context;
    if (origin.context !== 'adoption' && origin.context !== 'foster') {
        throw new ApiError(422, 'contract_not_allowed', 'a contract can only be attached to an adoption or foster activity');
    }
    const placementId = `${activityId}-plc`;
    const placement = await db.select({ contractKey: placements.contractKey, contractSha256: placements.contractSha256, adopterId: placements.adopterId })
        .from(placements).where(eq(placements.id, placementId)).get() as { contractKey: string | null; contractSha256: string | null; adopterId: string } | undefined;
    if (!placement) throw new ApiError(404, 'not_found', 'no activity saved by this key with that id');
    const exists = (sha: string | null) => new ApiError(409, 'contract_exists', `this activity already has a contract (sha256 ${sha ?? 'unknown'}); void the activity and register it again to replace it`);
    if (placement.contractKey) throw exists(placement.contractSha256);

    const stored = await storeContract(ctx.bodyBytes, contentType, { animalId: activityId, requestId: ctx.requestId });
    // Claim the slot only if it is still empty: two concurrent uploads can't both win.
    const won = await db.update(placements).set({ contractKey: stored.key, contractSha256: stored.sha256 })
        .where(and(eq(placements.id, placementId), isNull(placements.contractKey)))
        .returning({ id: placements.id });
    if (!won.length) {
        await deleteContract(stored.key).catch(e => logger.error('api: losing contract upload not deleted', e, { requestId: ctx.requestId, activityId }));
        const now = await db.select({ contractSha256: placements.contractSha256 }).from(placements).where(eq(placements.id, placementId)).get() as { contractSha256: string | null } | undefined;
        throw exists(now?.contractSha256 ?? null);
    }
    try {
        await db.insert(adopterHistory).values({
            id: crypto.randomUUID(), adopterId: placement.adopterId, changedBy: `api:${key.name}`, kind: 'contribution',
            changes: JSON.stringify({ contract_attached_via_api: { activityId, requestId: ctx.requestId, sha256: stored.sha256 } }),
            changedAt: new Date(),
        });
    } catch (e) {
        logger.error('api: history row for an attached contract failed', e, { requestId: ctx.requestId, activityId });
    }
    ctx.log.recordId = activityId;
    ctx.log.profileIds = [placement.adopterId];
    ctx.log.outcome = 'contract_attached';
    logger.info('api: contract attached', { requestId: ctx.requestId, keyId: key.id, activityId, size: stored.size, contentType });
    return { contentType, size: stored.size, sha256: stored.sha256, profileId: placement.adopterId };
}
