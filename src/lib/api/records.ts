/**
 * Write side of the API: save a record from an exact search (decision 7) and
 * void one (decision 11). Server-only.
 *
 *   found     → the record goes on that profile (the exact-match rules are the
 *               confirmation of who the person is).
 *   not_found → a new profile + the record, through the same path the adoption
 *               form uses (tokenized, duplicate candidates written).
 *   ambiguous → a NEW profile + the record, with its duplicate candidates
 *               registered for an admin to merge. Never attached to a guess.
 */
import { and, count, eq, isNotNull, isNull, ne, notLike, or } from 'drizzle-orm';
import { adopterEvents, adopterHistory, adopterImages, adopters, adoptions, apiRequests, formSubmissions, placements } from '@/db/schema';
import { logger } from '@/lib/logger';
import { runAfterResponse } from '@/lib/background';
import { socialUrl, type SocialPlatform } from '@/lib/contactEntries';
import type { ExactOutcome } from '@/domain/apiExactMatch';
import { ApiError, type ApiCallContext } from './handler';
import { profileUrl, recordUrl } from './profiles';
import type { SavedRecord, SearchRequest } from './schemas';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

const CONTEXT_LABEL_ES: Record<string, string> = {
    adoption_request: 'solicitud de adopción',
    adoption: 'adopción',
    foster: 'tránsito',
    follow_up: 'seguimiento',
    returned_pet: 'devolución',
    observation: 'observación',
};

/** A YYYY-MM-DD date at local noon, so it never shifts a day across time zones. */
function dayAtNoon(day: string): Date {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
}

export async function saveApiRecord(ctx: ApiCallContext, req: SearchRequest, outcome: ExactOutcome): Promise<SavedRecord> {
    const save = req.record ?? {};
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
            throw new ApiError(409, 'external_id_reused', `externalId ${save.externalId} was already saved by this key (request ${taken.id})`);
        }
    }

    let profileId: string;
    let profileCreated = false;
    if (outcome.result === 'found') {
        profileId = outcome.profileId;
    } else {
        const p = req.person;
        const { createAdopterFromSubmission } = await import('@/app/actions/_adopterFactory');
        const created = await createAdopterFromSubmission({
            source: 'api',
            api: { keyName: key.name, requestId: ctx.requestId, context: req.context },
            name: p.fullName!,
            addedBy: key.ownerEmail,
            email: p.email ?? null,
            phone: p.phone ?? null,
            address: p.address ?? null,
            documentId: p.documentId?.value ?? null,
            socials: (p.socials ?? []).map(s => socialUrl(s.handle, s.platform as SocialPlatform) ?? s.handle),
            animalName: save.animalName ?? null,
            animalSpecies: save.species ?? null,
        });
        profileId = created.adopterId;
        profileCreated = true;
        // Logged the moment it exists: if anything below fails, the claim is
        // not released (no duplicate on retry) and the log shows what was made.
        ctx.log.profileCreated = true;
        ctx.log.profileIds = [profileId];
    }

    const { insertRecord } = await import('@/app/actions/_recordWrite');
    const recordId = await insertRecord(db, {
        adopterId: profileId,
        animalName: save.animalName || null,
        species: save.species || null,
        status: 'completed',
        // Optional and never inferred (Jon, 2026-10-09): missing stays NULL.
        rating: save.rating ?? null,
        recordType: req.context,
        date: save.date ? dayAtNoon(save.date) : new Date(),
        details: save.notes || null,
        sourceUrl: null,
    }, key.ownerEmail);
    ctx.log.recordId = recordId;

    if (!profileCreated) {
        // A new profile gets its own "created via API" history row from the
        // factory. Best-effort: the record is saved, the call must say so.
        try {
            await db.insert(adopterHistory).values({
                id: crypto.randomUUID(),
                adopterId: profileId,
                changedBy: `api:${key.name}`,
                changes: JSON.stringify({ record_added_via_api: { requestId: ctx.requestId, recordId, recordType: req.context } }),
                changedAt: new Date(),
            });
        } catch (e) {
            logger.warn('api: history row for a saved record failed', { requestId: ctx.requestId, profileId, recordId, error: e instanceof Error ? e.message : String(e) });
        }
    }
    logger.info('api: record saved', { requestId: ctx.requestId, keyId: key.id, owner: key.ownerEmail, profileId, recordId, profileCreated, outcome: outcome.result, context: req.context });

    // One notification per saved record (decision 10), like a form submission.
    const name = req.person.fullName!;
    const what = CONTEXT_LABEL_ES[req.context] ?? req.context;
    const body = outcome.result === 'found'
        ? 'Se agregó a un perfil existente.'
        : outcome.result === 'ambiguous'
            ? 'Coincide con más de un perfil: se creó uno nuevo para que revises si es la misma persona.'
            : 'No había registros previos: se creó un perfil nuevo.';
    const notification = {
        type: 'api_record',
        title: `${name}: ${what} (vía ${key.name})`,
        body,
        url: `/adopter/${profileId}?record=${encodeURIComponent(recordId)}`,
        icon: outcome.result === 'ambiguous' ? '⚠️' : '🔌',
        metadata: { requestId: ctx.requestId, keyName: key.name, profileId, recordId, outcome: outcome.result, context: req.context },
    };
    await runAfterResponse('api.notifyRecord', async () => {
        const { createNotification, notifyOrgMembers } = await import('@/app/actions/notifications');
        await createNotification({ userId: key.ownerEmail, ...notification });
        await notifyOrgMembers({ actorEmail: key.ownerEmail, ...notification });
    }, { requestId: ctx.requestId, profileId, recordId });

    return {
        recordId,
        recordUrl: recordUrl(ctx.origin, profileId, recordId),
        profileId,
        profileUrl: profileUrl(ctx.origin, profileId),
        profileCreated,
    };
}

export interface VoidResult { recordId: string; profileId: string | null; profileVoided: boolean; alreadyVoided?: boolean; changedSince?: boolean }

/** Did anyone or anything but the API put data on this profile? Then it stays. */
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
    const conds = [eq(apiRequests.recordId, recordId), eq(apiRequests.endpoint, 'search'), eq(apiRequests.httpStatus, 200)];
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
    const claimed = await db.update(apiRequests).set({ voidedAt: now, voidedBy: opts.actor })
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
        const { softDeleteAnimal } = await import('@/app/actions/_recordWrite');
        await softDeleteAnimal(db, recordId, opts.actor);
    }

    let profileVoided = false;
    if (currentProfileId) {
        // Decide BEFORE writing this void's own history row (an admin's would read as a human edit).
        const dropProfile = !!createdProfileId && currentProfileId === createdProfileId
            && !(await profileHasOtherData(db, createdProfileId, recordId));
        await db.insert(adopterHistory).values({
            id: crypto.randomUUID(),
            adopterId: currentProfileId,
            changedBy: opts.actor,
            changes: JSON.stringify({ api_record_voided: { recordId, originRequestId: origin.id, voidRequestId: opts.requestId, ...(event ? { removedEvent: event } : {}) } }),
            changedAt: now,
        });
        if (dropProfile) {
            const gone = await db.update(adopters).set({ deletedAt: now, updatedAt: now })
                .where(and(eq(adopters.id, currentProfileId), isNull(adopters.deletedAt)))
                .returning({ id: adopters.id });
            profileVoided = gone.length > 0;
        }
    }

    logger.info('api: record voided', { requestId: opts.requestId, originRequestId: origin.id, recordId, profileId: currentProfileId, profileVoided, actor: opts.actor });
    return { recordId, profileId: currentProfileId, profileVoided };
}
