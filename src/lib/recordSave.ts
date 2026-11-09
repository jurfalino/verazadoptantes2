/**
 * The record save (create or edit) behind saveAdoption, as a plain server
 * module, NOT 'use server': its `how` option (whether the owner's team is told)
 * is never the browser's to choose. The browser door is
 * src/app/actions/adoptions.ts `saveAdoption`, which always tells; the
 * duplicate-aware import (importUpsert) calls this with `quietForTeam: true` (silent only for the owner team).
 */
import { adoptions, adopterHistory, adopterFlags } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { getDb, getUser } from '@/app/actions/_db';
import { tokenizeAdopter } from '@/lib/adopterTokenize';
import { saveAdoptionSchema } from '@/app/actions/validation';
import { planFieldSave, canonField, holdTogether, SAVE_BUSY, ANIMAL_ALREADY_PLACED } from '@/domain/fieldCollab';
import { recordFieldAuthors } from '@/lib/collabAttribution';
import { insertRecord, updateRecord, isActivePlacementConflict, normalizeRecordType, isEventType, isPlacementType } from '@/app/actions/_recordWrite';
import { copyDeliveryAddressToContacts } from '@/lib/deliveryAddressCopy';
import { recordHandoverFields } from '@/domain/recordEditAccess';
import { closePendingSearchesForAdopter } from '@/lib/pendingSearchLog';
import { historyKindFor } from '@/lib/profilePrivilege';
import { DELIVERY_ADDRESS_COPY_PREFIX } from '@/domain/flags';
import { deliveryAddressGiven, type AddedRecord } from '@/domain/profileAdditions';
import { notifyProfileAddition } from '@/lib/profileAdditionNotices';

export type RecordFieldConflict = { field: string; by: string; value: unknown };
export type RecordSaveResult = { success: true; id: string; saved?: string[]; conflicts?: RecordFieldConflict[]; updatedByOthers?: RecordFieldConflict[] };

// The editable fields of a record, as the `adoptions` view names them.
// v2.55.17-1: sex/color/microchip/age/sourceUrl/comments were once missing
// from this list, which silently dropped edits to only those fields.
const RECORD_FIELDS = ['animalName', 'species', 'status', 'rating', 'details', 'adopterId', 'date', 'onBehalfOf', 'recordType', 'deliveredToHome', 'verifiedAddress', 'identityVerified', 'estimatedBirthDate', 'neutered', 'sex', 'color', 'microchip', 'age', 'sourceUrl', 'comments'] as const;
export type RecordField = typeof RECORD_FIELDS[number];
// Who holds the animal and how: one decision. If either conflicts, neither is
// written (else «move to Ana» + a teammate's «back to available» = nonsense).
const CUSTODY_FIELDS = ['adopterId', 'recordType'];
// Written with a changed field, never compared (follow-up links).
const PASS_THROUGH = ['animalId', 'followupKey', 'followupSubtype'] as const;

// What the editing form had loaded for each field it may send. Values are the
// same shapes the form sends (text, numbers, 0/1, dates as Date / ISO / epoch).
const loadedValue = z.union([z.string().max(20_000), z.number(), z.boolean(), z.date(), z.null()]);
const saveAdoptionOptsSchema = z.object({
    loaded: z.partialRecord(z.enum(RECORD_FIELDS), loadedValue).optional(),
}).strict().optional();

export interface SaveRecordHow {
    /**
     * Tell the profile owner's team that a record was added (profile_content_added).
     * False only for server-side callers that add in bulk (an import) — never the
     * browser's to choose; the browser door is saveAdoption, which always tells.
     */
    notifyOwnerTeam: boolean;
    /** An import: silent only when the importer is on the owner's team (review I1; see ProfileAdditionNotice.quietForTeam). */
    quietForTeam?: boolean;
}

export async function saveRecordFor(data: typeof adoptions.$inferInsert, opts: { loaded?: Partial<Record<RecordField, unknown>> } | undefined, how: SaveRecordHow): Promise<RecordSaveResult> {
    // Validate input
    const parsed = saveAdoptionSchema.safeParse(data);
    if (!parsed.success) {
        throw new Error(`Invalid adoption data: ${parsed.error.issues.map(i => i.message).join(', ')}`);
    }
    const parsedOpts = saveAdoptionOptsSchema.safeParse(opts);
    if (!parsedOpts.success) {
        throw new Error(`Invalid adoption data: ${parsedOpts.error.issues.map(i => i.message).join(', ')}`);
    }

    try {
        const db = await getDb();
        if (!db) throw new Error("No database");
        const changedBy = await getUser();

        // Check if exists (for updates)
        const existing = data.id ? await db.select().from(adoptions).where(eq(adoptions.id, data.id)).get() : null;

        if (existing) {
            // Editing an existing record is a MUTATION: the record's creator,
            // a teammate of theirs, or an admin — exactly deleteAdoption's gate
            // and what the UI offers (AdoptionHistory canEdit, from the same
            // rule via getAdoptions; the animal page via assertCanEditAnimal).
            // Adding a new record stays open.
            const { canEditRecordAs } = await import('@/lib/recordEditAccess');
            if (!(await canEditRecordAs(changedBy, existing.addedBy))) {
                // Thrown like every other saveAdoption failure (callers treat a
                // throw as failure); the catch below logs it with the errorId
                // the user sees.
                throw new Error('Not authorized to edit this record');
            }

            // Per-field collision check (src/domain/fieldCollab.ts): only the
            // fields this editor changed are written, each only if nobody
            // changed it since the form loaded (`opts.loaded`). Callers that
            // send no baseline keep the old behaviour (write what differs).
            return await updateRecordFields(db, data, existing, opts?.loaded, changedBy, how);
        } else {
            // Create new — normalized write routes to animals/placements/events.
            // Returns the animal id (available/foster/adoption) or event id, which
            // is what callers use for image uploads + contract refs.
            const id = await insertRecord(db, { ...data, date: data.date || new Date() }, changedBy);

            // Log to adopter history ONLY if linked immediately
            if (data.adopterId) {
                // Logging a record on a profile is open to anyone signed in: on
                // someone else's profile it is a contribution (src/lib/profilePrivilege.ts).
                const kind = await historyKindFor(db, data.adopterId, changedBy);
                await db.insert(adopterHistory).values({
                    id: crypto.randomUUID(),
                    adopterId: data.adopterId,
                    changedBy,
                    kind,
                    changes: JSON.stringify({
                        adoption_added: {
                            animalName: data.animalName,
                            species: data.species,
                            status: data.status,
                            rating: data.rating
                        }
                    }),
                    changedAt: new Date()
                });

                // If delivered to home with verified address, set address verified flag.
                // Only records that store the delivery (adoption, «Tránsito»): a
                // stale toggle on another type is not a delivery (F3).
                if (data.deliveredToHome && data.verifiedAddress && recordHandoverFields(normalizeRecordType(data.recordType)).deliveredToHome) {
                    // Add the verified address to the adopter's contacts (F4: the
                    // same copy the edit path runs; owner/teammate/admin only,
                    // merged, never failing the save).
                    await copyDeliveryAddressToContacts(db, {
                        adopterId: data.adopterId, recordType: normalizeRecordType(data.recordType),
                        deliveredToHome: data.deliveredToHome, verifiedAddress: data.verifiedAddress,
                        changedBy, op: 'saveAdoption.create',
                    });

                    // Check if verified_address flag already exists
                    const existingFlag = await db.select().from(adopterFlags).where(
                        and(
                            eq(adopterFlags.adopterId, data.adopterId),
                            eq(adopterFlags.reason, 'verified_address')
                        )
                    ).get();

                    if (!existingFlag) {
                        await db.insert(adopterFlags).values({
                            id: crypto.randomUUID(),
                            adopterId: data.adopterId,
                            // `flaggedBy` (adopter_flags has no added_by): this was dropped and every
                            // delivery-verified address was filed as 'anonymous'.
                            flaggedBy: changedBy,
                            reason: 'verified_address',
                            // The street stays on the record, where it is masked per viewer (P1).
                            details: DELIVERY_ADDRESS_COPY_PREFIX,
                            createdAt: new Date()
                        });
                    }
                }

                revalidatePath(`/adopter/${data.adopterId}`);
            }
            // Revalidate /my-animals for INSERTs too (v2.18.7) — covers the
            // "user uploaded a new available animal" path and the
            // "user added an adoption that should claim that inventory"
            // path symmetrically. Cheap; no downside to over-revalidating.
            revalidatePath('/my-animals');

            logger.info('Adoption created', { adoptionId: id, adopterId: data.adopterId, species: data.species, changedBy });
            logAudit({ userEmail: changedBy, action: 'adoption_created', target: id, details: { adopterId: data.adopterId, species: data.species, animalName: data.animalName } });

            // Re-tokenize adopter if onBehalfOf is set (cross-field name tokens).
            // Awaited — see comment on the update branch above.
            if (data.adopterId && data.onBehalfOf) {
                await tokenizeAdopter(data.adopterId).catch(e => { logger.error('Tokenize adopter failed (adoption create)', e, { adopterId: data.adopterId }); });
            }

            // The work is done, so the homepage must stop asking about it
            // (ENABLE_PENDING_SEARCHES). Best-effort inside the helper.
            if (data.adopterId) await closePendingSearchesForAdopter(db, changedBy, data.adopterId);

            // The owner's team hears what was added (one notice with the photos
            // that follow; src/lib/profileAdditionNotices.ts). Only a record that
            // lands ON the profile — an «available» animal is not on it.
            const recordType = normalizeRecordType(data.recordType);
            if (how.notifyOwnerTeam && data.adopterId && (isEventType(recordType) || isPlacementType(recordType))) {
                await notifyProfileAddition(db, {
                    adopterId: data.adopterId, actor: changedBy, op: 'saveAdoption.create', quietForTeam: how.quietForTeam,
                    add: { records: [addedRecord(recordType, data.rating)], address: deliveryAddressGiven(recordType, data.deliveredToHome, data.verifiedAddress) },
                });
            }

            return { success: true, id };
        }
    } catch (error) {
        if (error instanceof Error && error.message.startsWith(SAVE_BUSY)) throw error; // already logged, keeps its id
        if (isActivePlacementConflict(error)) {
            // Someone adopted or fostered this animal between our read and our
            // write — one active placement per animal (drizzle/0078). The
            // client shows «<Animal> ya tiene una adopción o tránsito activo.».
            const errorId = logger.error('saveAdoption: animal already placed', error, { adoptionId: data.id, adopterId: data.adopterId });
            throw new Error(`${ANIMAL_ALREADY_PLACED} (Error ID: ${errorId})`);
        }
        const errorId = logger.error('Save adoption failed', error, { adoptionId: data.id, adopterId: data.adopterId });
        throw new Error(`Failed to save adoption (Error ID: ${errorId})`);
    }
}

/** The update half of saveAdoption: per-field check, compare-and-swap per table, one retry. */
async function updateRecordFields(
    db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
    data: typeof adoptions.$inferInsert,
    existing: typeof adoptions.$inferSelect,
    loadedIn: Partial<Record<RecordField, unknown>> | undefined,
    changedBy: string,
    how: SaveRecordHow,
): Promise<RecordSaveResult> {
    const recordId = existing.id;
    const sent = data as Record<string, unknown>;
    const payload: Record<string, unknown> = {};
    for (const f of RECORD_FIELDS) if (sent[f] !== undefined) payload[f] = sent[f];
    const loaded: Record<string, unknown> = {};
    if (loadedIn) for (const f of RECORD_FIELDS) if (f in loadedIn) loaded[f] = loadedIn[f];

    /** History + activity rows (and their side effects) for fields that landed. */
    const recordLanded = async (fields: string[], before: Record<string, unknown>, writeData: Record<string, unknown>, after: typeof existing) => {
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        for (const f of fields) changes[f] = { from: before[f] ?? null, to: payload[f] ?? null };
        const targetAdopterId = (writeData.adopterId as string | null | undefined) || after.adopterId;
        if (targetAdopterId) {
            await db.insert(adopterHistory).values({
                id: crypto.randomUUID(),
                adopterId: targetAdopterId,
                changedBy,
                // Against the profile the row lands on (a re-link moves it).
                kind: await historyKindFor(db, targetAdopterId, changedBy),
                changes: JSON.stringify({ adoption_updated: changes }),
                changedAt: new Date(),
            });
            revalidatePath(`/adopter/${targetAdopterId}`);
        }
        // /my-animals filters on adopterId + recordType; a link/unlink must
        // drop the row off the "available" tab (v2.18.7).
        revalidatePath('/my-animals');
        logger.info('Adoption updated', { adoptionId: recordId, adopterId: targetAdopterId, changedBy, fields });
        // `fields` (names only) is what lets a later collision name who
        // changed a field (src/lib/collabAttribution.ts).
        logAudit({ userEmail: changedBy, action: 'adoption_updated', target: recordId, details: { adopterId: targetAdopterId, fields } });
        // onBehalfOf feeds the adopter's cross-field name tokens. Awaited so
        // duplicate detection sees them before the response (Workers kill
        // fire-and-forget).
        if (targetAdopterId && fields.includes('onBehalfOf')) {
            await tokenizeAdopter(targetAdopterId).catch(e => { logger.error('Tokenize adopter failed (adoption update)', e, { adopterId: targetAdopterId }); });
        }
    };

    let current = existing;
    for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) {
            const fresh = await db.select().from(adoptions).where(eq(adoptions.id, recordId)).get();
            if (!fresh) throw new Error('Record disappeared during save');
            current = fresh;
        }
        const currentVals: Record<string, unknown> = {};
        for (const f of RECORD_FIELDS) currentVals[f] = (current as Record<string, unknown>)[f];
        const plan = holdTogether(planFieldSave(payload, loaded, currentVals), CUSTODY_FIELDS);
        // Without a baseline, a field equal to what is stored is not a write.
        const apply = plan.apply.filter(f => canonField(f, payload[f]) !== canonField(f, currentVals[f]));
        const saved = [...plan.alreadySaved, ...plan.apply.filter(f => !apply.includes(f))];

        if (apply.length) {
            const writeData: Record<string, unknown> = { id: recordId };
            for (const f of apply) writeData[f] = payload[f];
            for (const f of PASS_THROUGH) if (sent[f] !== undefined) writeData[f] = sent[f];
            // Normalized write: identity → animals, custody → placements
            // (closing/opening spans on a transition), events → adopter_events.
            // Each table's write is conditional on the values it replaces.
            const { lost, landed } = await updateRecord(db, writeData, current, changedBy, { cas: true });
            if (lost) {
                // Part of it may have landed (the animal's own fields) before the
                // placement part lost: those get their history now; the retry
                // sees them as already saved.
                if (landed?.length) await recordLanded(landed, currentVals, {}, current);
                continue; // someone saved in between — re-read and re-check
            }
            await recordLanded(apply, currentVals, writeData, current);
            // F4: marking «Entregado en casa» (or changing its address) while
            // editing copies the address into the contacts, as creating does.
            // Only when this save landed one of the two; a save of another
            // field never puts back an address someone removed from contacts.
            if (apply.includes('deliveredToHome') || apply.includes('verifiedAddress')) {
                const after = (f: RecordField) => (apply.includes(f) ? payload[f] : currentVals[f]);
                await copyDeliveryAddressToContacts(db, {
                    adopterId: (writeData.adopterId as string | null | undefined) || current.adopterId,
                    recordType: after('recordType') as string | null,
                    deliveredToHome: after('deliveredToHome'),
                    verifiedAddress: after('verifiedAddress') as string | null,
                    changedBy, op: 'saveAdoption.edit',
                });
            }
            if (how.notifyOwnerTeam) await notifyEditAddition(db, apply, payload, currentVals, changedBy, how.quietForTeam);
        }

        const named = await recordFieldAuthors(db, recordId, [...new Set([...plan.conflicts, ...plan.updatedByOthers])]);
        const view = (f: string): RecordFieldConflict => ({ field: f, by: named[f] ?? '', value: currentVals[f] ?? null });
        if (plan.conflicts.length) logger.info('saveAdoption: field conflicts', { adoptionId: recordId, changedBy, conflicts: plan.conflicts });
        return {
            success: true, id: recordId,
            saved: [...apply, ...saved],
            conflicts: plan.conflicts.map(view),
            updatedByOthers: plan.updatedByOthers.map(view),
        };
    }
    // Thrown, not returned: every caller treats a throw as "not saved" (some
    // only check that a result came back). The client shows the localized
    // «otra persona estaba guardando…» for this marker (isSaveBusyError).
    const errorId = logger.error('saveAdoption: lost the race twice', new Error('busy'), { adoptionId: recordId, changedBy });
    throw new Error(`${SAVE_BUSY} (Error ID: ${errorId})`);
}

function addedRecord(type: string, rating: unknown): AddedRecord {
    const r = Number(rating);
    return Number.isInteger(r) && r >= 1 && r <= 5 ? { type, rating: r } : { type };
}

/**
 * An edit that adds to a profile tells its owner's team (one notice, merged
 * with any photos): the record placed on a profile it was not on (an
 * available animal adopted, a record moved), and a delivery address the
 * record did not carry before (marked delivered, or a different address).
 * Judged on the record's own fields as this save landed them — not on the
 * contacts copy, which can be a no-op (already there, full, busy).
 */
async function notifyEditAddition(
    db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
    apply: string[],
    payload: Record<string, unknown>,
    before: Record<string, unknown>,
    changedBy: string,
    quietForTeam?: boolean,
): Promise<void> {
    const after = (f: RecordField) => (apply.includes(f) ? payload[f] : before[f]);
    const adopterId = after('adopterId') as string | null | undefined;
    if (!adopterId) return;
    const type = normalizeRecordType(after('recordType') as string | null);
    if (!isEventType(type) && !isPlacementType(type)) return;
    const placedOnto = apply.includes('adopterId') && canonField('adopterId', payload.adopterId) !== canonField('adopterId', before.adopterId);
    const addressNow = deliveryAddressGiven(type, after('deliveredToHome'), after('verifiedAddress'));
    const addressBefore = deliveryAddressGiven(normalizeRecordType(before.recordType as string | null), before.deliveredToHome, before.verifiedAddress)
        && canonField('verifiedAddress', before.verifiedAddress) === canonField('verifiedAddress', after('verifiedAddress'));
    const addressAdded = addressNow && (placedOnto || !addressBefore);
    if (!placedOnto && !addressAdded) return;
    await notifyProfileAddition(db, {
        adopterId, actor: changedBy, op: 'saveAdoption.edit', quietForTeam,
        add: { ...(placedOnto ? { records: [addedRecord(type, after('rating'))] } : {}), address: addressAdded },
    });
}
