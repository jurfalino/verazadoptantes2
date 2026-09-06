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
import { animals, placements, adopterEvents, animalEvents, adopters, adopterImages, users, userProfiles } from '@/db/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { revalidatePath } from 'next/cache';
import { ANIMAL_EVENT_TYPES, type AnimalEventType } from '@/domain/constants';
import {
    computeFollowups, mergeSchedule, mergeFosterRule, parseFollowupSettings,
    getMessageTemplate, DEFAULT_SCHEDULE,
    type FollowupSettings, type FollowupStatus, type FollowupSubtype, type RecordedFollowup,
} from '@/domain/followups';
import { getFeatureFlag } from '@/config/features';
import { interpolate } from '@/lib/interpolate';
import { buildWaMeUrl, buildTelegramUrl } from '@/lib/whatsapp';
import { deserializeContactEntries } from '@/lib/contactEntries';
import { resolveAdopterVisibility } from '@/lib/piiAccessServer';
import { z } from 'zod';

export type AnimalTimelineItem = {
    /** Stable per-item id (placement id, `${placement.id}-end`, event id, or `${animalId}-created`). */
    id: string;
    kind: 'placement_start' | 'placement_end' | 'adopter_event' | 'animal_event' | 'created';
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

/** A projected follow-up slot, serialized for the client (dates as epoch ms). */
export type ProjectedSlot = {
    key: string;
    subtype: FollowupSubtype;
    copyKey: string;
    offsetDays?: number;
    dueDate: number;
    windowEndsAt: number;
    status: FollowupStatus;
    /** One-click contact deep link — present only when the viewer has FULL PII
     *  access to the adopter and a usable phone exists. Telegram links carry
     *  the message separately (t.me can't prefill): the UI copies it. */
    contact: { channel: 'whatsapp' | 'telegram'; url: string; message: string } | null;
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
    /** ENABLE_FOLLOWUPS is on for this deployment/user. */
    followupsEnabled: boolean;
    /** Projected follow-up slots for the ACTIVE placement (empty when none/flag off). */
    projected: ProjectedSlot[];
    /** v2.55.18: attribution — resolved display name of the animal's owner, the
     *  shared org's name (null for solo rescuers), and a name map for every
     *  recordedBy email on the timeline. Always displayed (audit identity). */
    addedByName: string | null;
    orgName: string | null;
    userNameMap: Record<string, string>;
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
    if (!animal || animal.deletedAt) return null;
    // v2.55.18: animals are TEAM resources — visible to the owner and every
    // org-mate (full parity, user decision; attribution is the counterweight).
    const { isOwnerOrOrgMate, getOrgsForEmail } = await import('@/lib/orgMembership');
    if (!(await isOwnerOrOrgMate(userEmail, animal.addedBy))) return null;

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
    // The origin of the line of life: when (and by whom) the animal was
    // registered. Even a fresh available animal has a first event.
    if (animal.createdAt) {
        items.push({
            id: `${animal.id}-created`, kind: 'created', type: 'created', date: toMs(animal.createdAt),
            adopterId: null, adopterName: null, placementId: null, rating: null,
            details: null, comments: null, recordedBy: animal.addedBy ?? null, spanDays: null, images: [],
        });
    }
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

    // ── attribution (always displayed): owner + every recorder, resolved once ──
    let addedByName: string | null = null;
    let orgName: string | null = null;
    let userNameMap: Record<string, string> = {};
    try {
        const { resolveUserNames } = await import('@/app/actions/userNames');
        const recorderEmails = Array.from(new Set([
            animal.addedBy,
            ...(spans as any[]).map(p => p.recordedBy),
            ...(events as any[]).map(e => e.recordedBy),
            ...(careEvents as any[]).map(e => e.recordedBy),
        ].filter((v): v is string => !!v && v !== 'anonymous')));
        const [names, ownerOrgs] = await Promise.all([
            resolveUserNames(recorderEmails),
            getOrgsForEmail(animal.addedBy),
        ]);
        userNameMap = names;
        addedByName = (animal.addedBy && names[animal.addedBy]) || null;
        orgName = ownerOrgs[0]?.name ?? null;
    } catch (e) {
        logger.warn('getAnimalProfile: attribution fallback', {
            animalId, userEmail, error: e instanceof Error ? e.message : String(e),
        });
    }

    // ── projected follow-ups (flag-gated; computed, never materialized) ──
    let followupsEnabled = false;
    let projected: ProjectedSlot[] = [];
    if (active) {
        try {
            followupsEnabled = await getFeatureFlag('ENABLE_FOLLOWUPS');
        } catch (e) {
            logger.warn('getAnimalProfile: followups flag fallback', {
                animalId, userEmail, error: e instanceof Error ? e.message : String(e),
            });
        }
        if (followupsEnabled) {
            projected = await buildProjectedSlots(db, {
                animalId, userEmail,
                placement: active,
                animal: { name: animal.name ?? null, estimatedBirthDate: animal.estimatedBirthDate ?? null, neutered: animal.neutered ?? null },
                events: events as any[],
                careEvents: careEvents as any[],
            }).catch((e) => {
                logger.warn('getAnimalProfile: projected fallback', {
                    animalId, userEmail, error: e instanceof Error ? e.message : String(e),
                });
                return [];
            });
        }
    }

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
        followupsEnabled,
        projected,
        addedByName,
        orgName,
        userNameMap,
    };
}

/** The owner's FollowupSettings (user_profiles is keyed by NextAuth user id,
 *  so the lookup joins through `user` by email). Null = defaults. */
async function getSettingsForEmail(db: any, email: string): Promise<FollowupSettings | null> {
    const row = await db.select({ settings: userProfiles.followupSettings })
        .from(userProfiles)
        .innerJoin(users, eq(users.id, userProfiles.userId))
        .where(eq(users.email, email)).get()
        .catch((e: unknown) => {
            logger.warn('followups: settings lookup fallback', {
                userEmail: email, error: e instanceof Error ? e.message : String(e),
            });
            return null;
        });
    return parseFollowupSettings(row?.settings);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function buildProjectedSlots(db: any, input: {
    animalId: string;
    userEmail: string;
    placement: any;
    animal: { name: string | null; estimatedBirthDate: Date | number | null; neutered: number | null };
    events: any[];
    careEvents: any[];
}): Promise<ProjectedSlot[]> {
    const { placement, animal } = input;
    const settings = await getSettingsForEmail(db, input.userEmail);

    const asDate = (v: unknown): Date | null =>
        v instanceof Date ? v : typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : null;

    const recorded: RecordedFollowup[] = [
        // Only THIS placement's events (or legacy unlinked ones) — a keyed
        // follow-up from a previous adoption must not satisfy the new one.
        ...input.events
            .filter(e => e.placementId === placement.id || !e.placementId)
            .map(e => ({
                id: e.id, date: asDate(e.date), followupKey: e.followupKey ?? null,
                subtype: e.followupSubtype ?? null, eventType: e.eventType,
            })),
        ...input.careEvents.map(e => ({
            id: e.id, date: asDate(e.date), followupKey: e.followupKey ?? null,
            subtype: null, eventType: e.eventType,
        })),
    ];

    const startedAt = asDate(placement.startedAt);
    if (!startedAt) return [];

    const slots = computeFollowups({
        placementStartedAt: startedAt,
        placementType: placement.recordType,
        animal: { estimatedBirthDate: asDate(animal.estimatedBirthDate), neutered: animal.neutered },
        schedule: mergeSchedule(DEFAULT_SCHEDULE, settings),
        fosterRule: mergeFosterRule(settings),
        recorded,
        now: new Date(),
    });

    // One-click contact: ONLY when the viewer has full PII access to the
    // adopter (owner/org/admin/moderator or an approved all-contact grant) —
    // resolveAdopterVisibility is the single authority; fail-closed.
    let contactPhone: string | null = null;
    let contactChannel: 'whatsapp' | 'telegram' = 'whatsapp';
    let familia = '';
    try {
        const adopter = await db.select({
            id: adopters.id, name: adopters.name, addedBy: adopters.addedBy,
            contactEntries: adopters.contactEntries, contactInfo: adopters.contactInfo,
        }).from(adopters).where(eq(adopters.id, placement.adopterId)).get();
        if (adopter) {
            familia = (adopter.name || '').trim().split(/\s+/)[0] || '';
            const visibility = await resolveAdopterVisibility(input.userEmail, { id: adopter.id, addedBy: adopter.addedBy });
            if (visibility.nothingMasked) {
                const entries = deserializeContactEntries(adopter.contactEntries);
                const phones = entries.filter(en => en.type === 'phone' && en.value);
                const tg = phones.find(en => en.apps?.includes('telegram') && !en.apps?.includes('whatsapp'));
                const wa = phones.find(en => en.apps?.includes('whatsapp')) || phones[0];
                if (wa) { contactPhone = wa.value; contactChannel = 'whatsapp'; }
                else if (tg) { contactPhone = tg.value; contactChannel = 'telegram'; }
                if (!contactPhone && adopter.contactInfo) {
                    const m = String(adopter.contactInfo).match(/\+?[\d][\d\s\-().]{7,}/);
                    if (m) contactPhone = m[0];
                }
            }
        }
    } catch (e) {
        logger.warn('followups: contact resolution fallback', {
            animalId: input.animalId, adopterId: placement.adopterId, userEmail: input.userEmail,
            error: e instanceof Error ? e.message : String(e),
        });
    }

    const now = Date.now();
    return slots.map(s => {
        let contact: ProjectedSlot['contact'] = null;
        if (contactPhone && (s.status === 'due' || s.status === 'upcoming')) {
            const dias = Math.max(0, Math.round((now - startedAt.getTime()) / 86400000));
            const message = interpolate(getMessageTemplate(s.subtype, settings), {
                animal: animal.name || '', familia, dias,
            });
            const url = contactChannel === 'telegram' ? buildTelegramUrl(contactPhone) : buildWaMeUrl(contactPhone, message);
            if (url) contact = { channel: contactChannel, url, message };
        }
        return {
            key: s.key, subtype: s.subtype, copyKey: s.copyKey, offsetDays: s.offsetDays,
            dueDate: s.dueDate.getTime(), windowEndsAt: s.windowEndsAt.getTime(),
            status: s.status, contact,
        };
    });
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
        if (!animal) return { error: 'Not found' };
        // v2.55.18: org-mates get full parity on team animals (admin too).
        const { isOwnerOrOrgMate } = await import('@/lib/orgMembership');
        const { checkIsAdminAsync } = await import('@/app/actions/_db');
        if (!(await isOwnerOrOrgMate(userEmail, animal.addedBy)) && !(await checkIsAdminAsync(userEmail))) return { error: 'Not found' };

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
        if (!animal) return { error: 'Not found' };
        // v2.55.18: org-mates get full parity on team animals (admin too).
        const { isOwnerOrOrgMate } = await import('@/lib/orgMembership');
        const { checkIsAdminAsync } = await import('@/app/actions/_db');
        if (!(await isOwnerOrOrgMate(userEmail, animal.addedBy)) && !(await checkIsAdminAsync(userEmail))) return { error: 'Not found' };

        await db.delete(animalEvents).where(eq(animalEvents.id, eventId));
        logAudit({ userEmail, action: 'animal_event_deleted', target: row.animalId, details: { eventId } });
        revalidatePath(`/my-animals/${row.animalId}`);
        return { success: true };
    } catch (error) {
        const errorId = logger.error('deleteAnimalEvent failed', error, { eventId, userEmail });
        return { error: `Failed to delete event (${errorId})` };
    }
}
