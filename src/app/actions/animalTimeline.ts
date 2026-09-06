'use server';

/**
 * Animal detail page data + animal-scoped care log (v2.55.15, animal-timeline PR2).
 *
 * Reads go DIRECT to the normalized tables (placements incl. ended spans,
 * adopter_events by animal_id, animal_events) — never the `adoptions` compat
 * view, which only ever joins the ACTIVE placement and would hide the custody
 * history this page exists to show.
 */

import { getDb } from '@/lib/db';
import { animals, placements, adopterEvents, animalEvents, adopters, adopterImages } from '@/db/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { revalidatePath } from 'next/cache';
import { ANIMAL_EVENT_TYPES, type AnimalEventType } from '@/domain/constants';
import { z } from 'zod';

export type AnimalTimelineItem = {
    /** Stable per-item id (placement id, `${placement.id}-end`, or event id). */
    id: string;
    kind: 'placement_start' | 'placement_end' | 'adopter_event' | 'animal_event';
    /** placement recordType ('foster'|'adoption'), adopter_events.eventType, or animal_events.eventType. */
    type: string;
    date: number | null; // epoch ms for the client
    adopterId: string | null;
    adopterName: string | null;
    placementId: string | null;
    rating: number | null;
    details: string | null;
    /** placement comments JSON (contract screenshot evidence). */
    comments: string | null;
    recordedBy: string | null;
    /** Ended spans: length in days (placement_end items). */
    spanDays: number | null;
    images: { id: string; url: string; mediaType: string | null; thumbnailUrl: string | null; caption: string | null }[];
};

export type AnimalProfileData = {
    animal: {
        id: string;
        name: string | null;
        species: string | null;
        details: string | null;
        age: string | null;
        estimatedBirthDate: number | null;
        neutered: number | null;
        sex: string | null;
        color: string | null;
        microchip: string | null;
        createdAt: number | null;
        addedBy: string | null;
    };
    /** Current custody, if any. */
    activePlacement: { id: string; recordType: string; adopterId: string; adopterName: string | null; startedAt: number | null } | null;
    items: AnimalTimelineItem[];
    images: { id: string; url: string; mediaType: string | null; thumbnailUrl: string | null; caption: string | null }[];
};

const toMs = (d: unknown): number | null => (d instanceof Date ? d.getTime() : typeof d === 'number' ? d * 1000 : null);

/**
 * Full profile for one OWNED animal: identity + custody trail + care log +
 * server-fetched images (no client-side N+1). Strict ownership — same policy
 * as /api/my-animals: addedBy === session email, no admin bypass.
 * Returns null when missing, deleted, or not owned (page renders notFound).
 */
export async function getAnimalProfile(animalId: string): Promise<AnimalProfileData | null> {
    const { getUser } = await import('@/app/actions/_db');
    const userEmail = await getUser();
    if (!userEmail) return null;

    const db = await getDb();
    if (!db) return null;

    const animal = await db.select().from(animals).where(eq(animals.id, animalId)).get();
    if (!animal || animal.deletedAt || animal.addedBy !== userEmail) return null;

    // Parallel fail-open wave: one D1 hiccup degrades a section, never the page.
    const fallback = <T,>(op: string) => (e: unknown): T[] => {
        logger.warn('getAnimalProfile: fetch fallback', {
            op, animalId, userEmail,
            error: e instanceof Error ? e.message : String(e),
        });
        return [];
    };
    const [spans, events, careEvents, animalImages] = await Promise.all([
        db.select().from(placements).where(eq(placements.animalId, animalId))
            .orderBy(desc(placements.startedAt)).all().catch(fallback('placements')),
        db.select().from(adopterEvents).where(eq(adopterEvents.animalId, animalId))
            .orderBy(desc(adopterEvents.date)).all().catch(fallback('adopterEvents')),
        db.select().from(animalEvents).where(eq(animalEvents.animalId, animalId))
            .orderBy(desc(animalEvents.date)).all().catch(fallback('animalEvents')),
        db.select().from(adopterImages).where(eq(adopterImages.adoptionId, animalId))
            .orderBy(sql`${adopterImages.uploadedAt} DESC`).all().catch(fallback('images')),
    ]);

    // Adopter names: dedup ids, fan out one query per id (D1 can't expand IN()).
    const adopterIds: string[] = Array.from(new Set(
        [...spans.map((p: { adopterId: string }) => p.adopterId), ...events.map((e: { adopterId: string | null }) => e.adopterId)]
            .filter((v): v is string => !!v)
    ));
    const nameRows = await Promise.all(adopterIds.map(aid =>
        db.select({ id: adopters.id, name: adopters.name }).from(adopters).where(eq(adopters.id, aid)).get()
            .catch((e: unknown) => {
                logger.warn('getAnimalProfile: adopter name fallback', {
                    animalId, adopterId: aid, userEmail,
                    error: e instanceof Error ? e.message : String(e),
                });
                return null;
            })
    ));
    const nameMap = new Map<string, string | null>();
    for (const row of nameRows) if (row) nameMap.set(row.id, row.name ?? null);

    // Event images: one query per event id (few per animal, fail-open).
    const eventIds: string[] = events.map((e: { id: string }) => e.id);
    const eventImageRows = await Promise.all(eventIds.map(eid =>
        db.select().from(adopterImages).where(eq(adopterImages.adoptionId, eid)).all()
            .catch(fallback(`eventImages:${eid}`))
    ));
    const eventImages = new Map<string, typeof animalImages>();
    eventIds.forEach((eid, i) => eventImages.set(eid, eventImageRows[i]));

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const mapImages = (rows: any[]) => rows.map((im: any) => ({
        id: im.id, url: im.url, mediaType: im.mediaType ?? null, thumbnailUrl: im.thumbnailUrl ?? null, caption: im.caption ?? null,
    }));

    const items: AnimalTimelineItem[] = [];
    for (const p of spans as any[]) {
        items.push({
            id: p.id, kind: 'placement_start', type: p.recordType, date: toMs(p.startedAt),
            adopterId: p.adopterId, adopterName: nameMap.get(p.adopterId) ?? null, placementId: p.id,
            rating: p.rating ?? null, details: null, comments: p.comments ?? null,
            recordedBy: p.recordedBy ?? null, spanDays: null, images: [],
        });
        // Synthetic "span ended" item — suppressed when a returned_pet event
        // already narrates the ending (avoid a duplicate story beat).
        const endedByReturn = (events as any[]).some(e => e.placementId === p.id && e.eventType === 'returned_pet');
        if (p.endedAt && !endedByReturn) {
            const spanDays = p.startedAt ? Math.round((toMs(p.endedAt)! - toMs(p.startedAt)!) / 86400000) : null;
            items.push({
                id: `${p.id}-end`, kind: 'placement_end', type: p.recordType, date: toMs(p.endedAt),
                adopterId: p.adopterId, adopterName: nameMap.get(p.adopterId) ?? null, placementId: p.id,
                rating: null, details: null, comments: null, recordedBy: null, spanDays, images: [],
            });
        }
    }
    for (const e of events as any[]) {
        items.push({
            id: e.id, kind: 'adopter_event', type: e.eventType, date: toMs(e.date),
            adopterId: e.adopterId, adopterName: e.adopterId ? (nameMap.get(e.adopterId) ?? null) : null,
            placementId: e.placementId ?? null, rating: e.rating ?? null, details: e.details ?? null,
            comments: null, recordedBy: e.recordedBy ?? null, spanDays: null,
            images: mapImages(eventImages.get(e.id) ?? []),
        });
    }
    for (const e of careEvents as any[]) {
        items.push({
            id: e.id, kind: 'animal_event', type: e.eventType, date: toMs(e.date),
            adopterId: null, adopterName: null, placementId: e.placementId ?? null,
            rating: null, details: e.details ?? null, comments: null,
            recordedBy: e.recordedBy ?? null, spanDays: null, images: [],
        });
    }
    items.sort((a, b) => (b.date ?? 0) - (a.date ?? 0));

    const active = (spans as any[]).find(p => !p.endedAt) ?? null;

    return {
        animal: {
            id: animal.id, name: animal.name ?? null, species: animal.species ?? null,
            details: animal.details ?? null, age: animal.age ?? null,
            estimatedBirthDate: toMs(animal.estimatedBirthDate), neutered: animal.neutered ?? null,
            sex: animal.sex ?? null, color: animal.color ?? null, microchip: animal.microchip ?? null,
            createdAt: toMs(animal.createdAt), addedBy: animal.addedBy ?? null,
        },
        activePlacement: active ? {
            id: active.id, recordType: active.recordType, adopterId: active.adopterId,
            adopterName: nameMap.get(active.adopterId) ?? null, startedAt: toMs(active.startedAt),
        } : null,
        items,
        images: mapImages(animalImages as any[]),
    };
}

const addAnimalEventSchema = z.object({
    animalId: z.string().min(1).max(64),
    eventType: z.enum(ANIMAL_EVENT_TYPES),
    date: z.coerce.date().optional().nullable(),
    details: z.string().max(10_000).optional().nullable(),
    followupKey: z.string().max(100).optional().nullable(),
    placementId: z.string().max(64).optional().nullable(),
});

/** Record a care event for an OWNED animal. `neuter` also flips animals.neutered. */
export async function addAnimalEvent(input: {
    animalId: string; eventType: AnimalEventType; date?: Date | null;
    details?: string | null; followupKey?: string | null; placementId?: string | null;
}): Promise<{ success: true; id: string } | { error: string }> {
    const { getUser } = await import('@/app/actions/_db');
    const userEmail = await getUser();
    const animalId = input?.animalId;
    try {
        if (!userEmail) return { error: 'Unauthorized' };
        const parsed = addAnimalEventSchema.safeParse(input);
        if (!parsed.success) return { error: 'Invalid event data' };

        const db = await getDb();
        if (!db) return { error: 'Database not available' };

        const animal = await db.select({ id: animals.id, addedBy: animals.addedBy })
            .from(animals).where(eq(animals.id, parsed.data.animalId)).get();
        if (!animal || animal.addedBy !== userEmail) return { error: 'Not found' };

        const id = crypto.randomUUID();
        await db.insert(animalEvents).values({
            id,
            animalId: parsed.data.animalId,
            eventType: parsed.data.eventType,
            date: parsed.data.date ?? new Date(),
            details: parsed.data.details ?? null,
            followupKey: parsed.data.followupKey ?? null,
            placementId: parsed.data.placementId ?? null,
            recordedBy: userEmail,
        });
        if (parsed.data.eventType === 'neuter') {
            await db.update(animals).set({ neutered: 1, updatedAt: new Date() }).where(eq(animals.id, parsed.data.animalId));
        }
        logAudit({ userEmail, action: 'animal_event_added', target: parsed.data.animalId, details: { eventType: parsed.data.eventType } });
        revalidatePath(`/my-animals/${parsed.data.animalId}`);
        return { success: true, id };
    } catch (error) {
        const errorId = logger.error('addAnimalEvent failed', error, { animalId, userEmail });
        return { error: `Failed to save event (${errorId})` };
    }
}

/** Delete one care event — ownership via the parent animal's addedBy. */
export async function deleteAnimalEvent(eventId: string): Promise<{ success: true } | { error: string }> {
    const { getUser } = await import('@/app/actions/_db');
    const userEmail = await getUser();
    try {
        if (!userEmail) return { error: 'Unauthorized' };
        const db = await getDb();
        if (!db) return { error: 'Database not available' };

        const row = await db.select({ id: animalEvents.id, animalId: animalEvents.animalId })
            .from(animalEvents).where(eq(animalEvents.id, eventId)).get();
        if (!row) return { error: 'Not found' };
        const animal = await db.select({ addedBy: animals.addedBy })
            .from(animals).where(eq(animals.id, row.animalId)).get();
        if (!animal || animal.addedBy !== userEmail) return { error: 'Not found' };

        await db.delete(animalEvents).where(eq(animalEvents.id, eventId));
        logAudit({ userEmail, action: 'animal_event_deleted', target: row.animalId, details: { eventId } });
        revalidatePath(`/my-animals/${row.animalId}`);
        return { success: true };
    } catch (error) {
        const errorId = logger.error('deleteAnimalEvent failed', error, { eventId, userEmail });
        return { error: `Failed to delete event (${errorId})` };
    }
}
