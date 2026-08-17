/**
 * Write adapter for the normalized model. The app still speaks the legacy
 * "adoptions row" shape (recordType + animal fields + adopter fields); these
 * helpers route that shape into `animals` / `placements` / `adopter_events`.
 * READS continue to go through the `adoptions` compatibility VIEW, so only writes
 * come through here. See .agents/plans/animals-placements-normalization.md.
 */

import { animals, placements, adopterEvents, adopterImages } from '@/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { deriveEndedPlacement } from '@/domain/placements';

const PLACEMENT_TYPES = ['foster', 'adoption'];
const EVENT_TYPES = ['observation', 'adoption_request', 'follow_up', 'returned_pet'];

export function isPlacementType(rt: string | null | undefined): boolean {
    return !!rt && PLACEMENT_TYPES.includes(rt);
}
export function isEventType(rt: string | null | undefined): boolean {
    return !!rt && EVENT_TYPES.includes(rt);
}
/** Normalize legacy/alias record types to canonical values. The add-record API
 *  accepts 'request' as an alias for 'adoption_request'. */
export function normalizeRecordType(rt: string | null | undefined): string {
    if (rt === 'request') return 'adoption_request';
    return rt || 'adoption';
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;
type RecordData = any;

function newId(): string {
    return crypto.randomUUID();
}

function placementValues(animalId: string, data: RecordData, recordType: string, adopterId: string, actor: string, startedAt: Date | number) {
    return {
        id: newId(),
        animalId,
        adopterId,
        recordType,
        startedAt: startedAt as any,
        endedAt: null,
        rating: data.rating ?? null,
        status: data.status ?? null,
        deliveredToHome: data.deliveredToHome ?? null,
        verifiedAddress: data.verifiedAddress ?? null,
        identityVerified: data.identityVerified ?? null,
        onBehalfOf: data.onBehalfOf ?? null,
        comments: data.comments ?? null,
        sourceUrl: data.sourceUrl ?? null,
        recordedBy: actor,
    };
}

/**
 * CREATE. Returns the id to expose as the record id: the ANIMAL id for
 * available/foster/adoption (so image + contract refs key on the animal), or the
 * EVENT id for the four event types. `data.id` may pre-seed the id (used by API
 * routes that generate their own uuid).
 */
export async function insertRecord(db: Db, data: RecordData, actor: string): Promise<string> {
    const recordType: string = normalizeRecordType(data.recordType);
    const date: Date | number = data.date || new Date();

    if (isEventType(recordType)) {
        const id = data.id || newId();
        await db.insert(adopterEvents).values({
            id,
            adopterId: data.adopterId ?? null,
            eventType: recordType,
            animalId: null,
            placementId: null,
            animalName: data.animalName ?? null,
            species: data.species ?? null,
            status: data.status ?? null,
            rating: data.rating ?? null,
            details: data.details ?? null,
            date: date as any,
            onBehalfOf: data.onBehalfOf ?? null,
            sourceUrl: data.sourceUrl ?? null,
            recordedBy: actor,
        }).onConflictDoNothing();
        return id;
    }

    // available / foster / adoption → an animal (+ an active placement if placed)
    const animalId = data.id || newId();
    await db.insert(animals).values({
        id: animalId,
        name: data.animalName ?? null,
        species: data.species ?? null,
        details: data.details ?? null,
        age: data.age ?? null,
        estimatedBirthDate: data.estimatedBirthDate ?? null,
        neutered: data.neutered ?? null,
        sex: data.sex ?? null,
        color: data.color ?? null,
        microchip: data.microchip ?? null,
        sourceUrl: data.sourceUrl ?? null,
        addedBy: actor,
        createdAt: date as any,
        updatedAt: date as any,
        deletedAt: null,
    }).onConflictDoNothing();
    if (isPlacementType(recordType) && data.adopterId) {
        await db.insert(placements).values(placementValues(animalId, data, recordType, data.adopterId, actor, date)).onConflictDoNothing();
    }
    return animalId;
}

/**
 * UPDATE an existing record. `existing` is the reconstructed adoptions-view row
 * (so `existing.recordType` / `existing.adopterId` reflect current state). Routes
 * identity edits to `animals`, and placement changes to `placements` — closing the
 * prior span and opening a new one on a real transition (via deriveEndedPlacement).
 */
export async function updateRecord(db: Db, data: RecordData, existing: RecordData, actor: string): Promise<void> {
    const id: string = data.id;
    const now = new Date();

    // Event rows: identified by the existing record's type.
    if (isEventType(existing.recordType)) {
        const patch: RecordData = {};
        if (data.animalName !== undefined) patch.animalName = data.animalName;
        if (data.species !== undefined) patch.species = data.species;
        if (data.status !== undefined) patch.status = data.status;
        if (data.rating !== undefined) patch.rating = data.rating;
        if (data.details !== undefined) patch.details = data.details;
        if (data.date !== undefined) patch.date = data.date;
        if (data.onBehalfOf !== undefined) patch.onBehalfOf = data.onBehalfOf;
        if (data.recordType !== undefined && isEventType(data.recordType)) patch.eventType = data.recordType;
        if (Object.keys(patch).length) await db.update(adopterEvents).set(patch).where(eq(adopterEvents.id, id));
        return;
    }

    // Animal-bearing rows: update identity on `animals`.
    const animalPatch: RecordData = { updatedAt: now };
    if (data.animalName !== undefined) animalPatch.name = data.animalName;
    if (data.species !== undefined) animalPatch.species = data.species;
    if (data.details !== undefined) animalPatch.details = data.details;
    if (data.age !== undefined) animalPatch.age = data.age;
    if (data.estimatedBirthDate !== undefined) animalPatch.estimatedBirthDate = data.estimatedBirthDate;
    if (data.neutered !== undefined) animalPatch.neutered = data.neutered;
    if (data.sex !== undefined) animalPatch.sex = data.sex;
    if (data.color !== undefined) animalPatch.color = data.color;
    if (data.microchip !== undefined) animalPatch.microchip = data.microchip;
    if (data.sourceUrl !== undefined) animalPatch.sourceUrl = data.sourceUrl;
    await db.update(animals).set(animalPatch).where(eq(animals.id, id));

    // Placement lifecycle.
    const active = await db.select().from(placements).where(and(eq(placements.animalId, id), isNull(placements.endedAt))).get();
    const desiredType: string = data.recordType ?? existing.recordType;
    const desiredAdopter = data.adopterId !== undefined ? data.adopterId : existing.adopterId;
    const wantsPlacement = isPlacementType(desiredType) && !!desiredAdopter;

    if (wantsPlacement) {
        if (active) {
            // Reuse the domain decision: does the prior placement END?
            const ended = deriveEndedPlacement(
                { id, adopterId: active.adopterId, recordType: active.recordType, animalName: existing.animalName ?? null, species: existing.species ?? null, date: active.startedAt },
                { adopterId: desiredAdopter, recordType: desiredType },
                now,
                actor,
            );
            if (ended) {
                await db.update(placements).set({ endedAt: now }).where(eq(placements.id, active.id));
                await db.insert(placements).values(placementValues(id, data, desiredType, desiredAdopter, actor, data.date ?? now));
            } else {
                // Same holder + type → patch mutable fields on the active placement.
                const pPatch: RecordData = {};
                if (data.rating !== undefined) pPatch.rating = data.rating;
                if (data.status !== undefined) pPatch.status = data.status;
                if (data.deliveredToHome !== undefined) pPatch.deliveredToHome = data.deliveredToHome;
                if (data.verifiedAddress !== undefined) pPatch.verifiedAddress = data.verifiedAddress;
                if (data.identityVerified !== undefined) pPatch.identityVerified = data.identityVerified;
                if (data.onBehalfOf !== undefined) pPatch.onBehalfOf = data.onBehalfOf;
                if (data.comments !== undefined) pPatch.comments = data.comments;
                if (data.date !== undefined) pPatch.startedAt = data.date;
                if (Object.keys(pPatch).length) await db.update(placements).set(pPatch).where(eq(placements.id, active.id));
            }
        } else {
            // available → placed: open the first placement.
            await db.insert(placements).values(placementValues(id, data, desiredType, desiredAdopter, actor, data.date ?? now));
        }
    } else if (active && (desiredType === 'available' || !desiredAdopter)) {
        // Placed → available: close the active placement.
        await db.update(placements).set({ endedAt: now }).where(eq(placements.id, active.id));
    }
}

/** Delete a record by its (view) id: an animal (+ its placements + adoption-linked
 *  images) or an adopter event. Mirrors the old hard-delete of an adoptions row. */
export async function deleteRecordById(db: Db, id: string): Promise<void> {
    await db.delete(placements).where(eq(placements.animalId, id));
    await db.delete(adopterImages).where(eq(adopterImages.adoptionId, id));
    await db.delete(animals).where(eq(animals.id, id));
    await db.delete(adopterEvents).where(eq(adopterEvents.id, id));
}

/** Remove an adopter's custody + events (used when deleting an adopter). Animals
 *  stay (they are the rescuer's inventory) — their placements are cut, so they
 *  revert to available. */
export async function deleteAdopterRecords(db: Db, adopterId: string): Promise<void> {
    await db.delete(placements).where(eq(placements.adopterId, adopterId));
    await db.delete(adopterEvents).where(eq(adopterEvents.adopterId, adopterId));
}

/** Reassign an adopter's records to another adopter (duplicate merge). */
export async function reassignAdopterRecords(db: Db, fromAdopterId: string, toAdopterId: string): Promise<number> {
    const moved = await db.update(placements).set({ adopterId: toAdopterId }).where(eq(placements.adopterId, fromAdopterId)).returning({ id: placements.id });
    await db.update(adopterEvents).set({ adopterId: toAdopterId }).where(eq(adopterEvents.adopterId, fromAdopterId));
    return Array.isArray(moved) ? moved.length : 0;
}
