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
import { isVetEventType, ANIMAL_EVENT_TYPES, type AnimalEventType } from '@/domain/constants';
import {
    computeFollowups, mergeSchedule, mergeFosterRule, parseFollowupSettings,
    getMessageTemplate, DEFAULT_SCHEDULE, FOLLOWUPS_EPOCH,
    type FollowupSettings, type FollowupStatus, type FollowupSubtype, type RecordedFollowup,
} from '@/domain/followups';
import { compareTimelineItems } from '@/domain/animalTimelineOrder';
import { getFeatureFlag } from '@/config/features';
import { interpolate } from '@/lib/interpolate';
import { buildWaMeUrl, buildTelegramUrl } from '@/lib/whatsapp';
import { resolveAdopterVisibility, isPiiGatingEnabled, buildMaskOptions } from '@/lib/piiAccessServer';
import { reachablePhoneForViewer } from '@/lib/piiAccess';
import { z } from 'zod';
import { animalPrimaryFirst } from '@/lib/showcase';

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
    images: { id: string; url: string; mediaType: string | null; thumbnailUrl: string | null; caption: string | null; isPrimary?: boolean; scope?: string | null }[];
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
        /** v2.56.128: the rescuer's public-catalogue switch. NULL = listed. */
        listed: number | null;
    };
    /** Current custody, if any. */
    activePlacement: { id: string; recordType: string; adopterId: string; adopterName: string | null; startedAt: number | null } | null;
    items: AnimalTimelineItem[];
    images: { id: string; url: string; mediaType: string | null; thumbnailUrl: string | null; caption: string | null; isPrimary?: boolean; scope?: string | null }[];
    /** ENABLE_FOLLOWUPS is on for this deployment/user. */
    followupsEnabled: boolean;
    /** Projected follow-up slots for the ACTIVE placement (empty when none/flag off). */
    projected: ProjectedSlot[];
    /** v2.56.14: what actually happens when a slot comes due, so the page can
     *  say it instead of leaving the user to guess. Reflects the VIEWER's own
     *  notification settings. */
    reminder: { email: boolean; toYou: boolean };
    /** v2.55.18: attribution — resolved display name of the animal's owner, the
     *  shared org's name (null for solo rescuers), and a name map for every
     *  recordedBy email on the timeline. Always displayed (audit identity). */
    addedByName: string | null;
    orgName: string | null;
    userNameMap: Record<string, string>;
    /**
     * v2.56.123: what the «Historial médico» handover needs, or null when the
     * animal is in nobody's house — there is no family to hand it to.
     * `vetEventCount` is 0 when nothing clinical was ever recorded, and the UI
     * hides the button in exactly the case /api/showcase/health 404s, so the
     * rescuer can never send a link to an empty page.
     */
    healthRecord: {
        /** This adoption's own address for the shared record — not the animal's
         *  id, so the link dies with the placement (placements.healthToken). */
        token: string | null;
        vetEventCount: number;
        /** First name of the family, for the message. */
        familyName: string | null;
        /** One-tap handover. Null when the viewer cannot see the adopter's
         *  contact details, or no usable phone is on file. */
        contact: { channel: 'whatsapp' | 'telegram'; phone: string } | null;
    } | null;
};

const toMs = (d: unknown): number | null => (d instanceof Date ? d.getTime() : typeof d === 'number' ? d * 1000 : null);

/**
 * Full profile for one OWNED animal: identity + custody trail + care log +
 * server-fetched images (no client-side N+1). Access: the owner, their
 * org-mates (animals are team resources) or an admin.
 * Returns null when missing, deleted, or not permitted (page renders notFound).
 */

/**
 * The launch cutoff passed to `computeFollowups`.
 *
 * `FOLLOWUPS_EPOCH` is the real value. The env override exists for the e2e
 * suite only: its seeded placements are necessarily older than the epoch, so
 * with the cutoff in force nothing can ever reach 'missed' and the
 * expired-reminder UI cannot be exercised at all. Playwright pins it to 2020
 * (see playwright.config.ts). The cutoff behaviour itself is unit-tested in
 * src/domain/followups.test.ts, so nothing goes uncovered.
 *
 * An unparseable value falls back to the real epoch rather than disabling the
 * cutoff — a typo must not quietly restore the retroactive "missed" wall.
 */
function resolveFollowupsEpoch(): Date {
    const override = process.env.FOLLOWUPS_EPOCH;
    if (!override) return FOLLOWUPS_EPOCH;
    const parsed = new Date(override);
    return isNaN(parsed.getTime()) ? FOLLOWUPS_EPOCH : parsed;
}

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
    const { checkIsAdminAsync } = await import('@/app/actions/_db');
    // Admins included: they can already delete the animal and add/remove its
    // events (and moderate everywhere else), so 404-ing the page they may
    // modify was an inconsistency, not a policy.
    if (!(await isOwnerOrOrgMate(userEmail, animal.addedBy)) && !(await checkIsAdminAsync(userEmail))) return null;

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
        db.select().from(adopterImages).where(eq(adopterImages.adoptionId, animalId)).orderBy(animalPrimaryFirst(), sql`${adopterImages.uploadedAt} DESC`).all().catch(fallback('images')),
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
    // v2.56.9: care events carry photos too — the add-event modal links them by
    // the created row's id, so both id spaces are fetched here.
    const eventIds: string[] = [
        ...events.map((e: { id: string }) => e.id),
        ...careEvents.map((e: { id: string }) => e.id),
    ];
    const eventImageRows = await Promise.all(eventIds.map(eid =>
        db.select().from(adopterImages).where(eq(adopterImages.adoptionId, eid)).all()
            .catch(fallback(`eventImages:${eid}`))
    ));
    const eventImages = new Map<string, typeof animalImages>();
    eventIds.forEach((eid, i) => eventImages.set(eid, eventImageRows[i]));

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const mapImages = (rows: any[]) => rows.map((im: any) => ({
        id: im.id, url: im.url, mediaType: im.mediaType ?? null, thumbnailUrl: im.thumbnailUrl ?? null, caption: im.caption ?? null,
        isPrimary: im.isPrimary === 1,
        // v2.56.128: only 'animal' photos reach the catalogue, so the listing
        // toggle needs it to say whether a photo is actually missing.
        scope: im.scope ?? null,
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
            recordedBy: e.recordedBy ?? null, spanDays: null,
            images: mapImages(eventImages.get(e.id) ?? []),
        });
    }
    items.sort(compareTimelineItems);

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
    let reminder = { email: false, toYou: true };
    let healthRecord: AnimalProfileData['healthRecord'] = null;

    if (active) {
        try {
            followupsEnabled = await getFeatureFlag('ENABLE_FOLLOWUPS');
        } catch (e) {
            logger.warn('getAnimalProfile: followups flag fallback', {
                animalId, userEmail, error: e instanceof Error ? e.message : String(e),
            });
        }

        // The handover (v2.56.123) and a due follow-up both offer to message
        // the same family, so the adopter's contact is resolved ONCE here and
        // handed to both — resolving it twice on a page load would mean two
        // extra round trips for one phone number. `careEvents` is already in
        // hand, and the count applies exactly the filter
        // /api/showcase/health applies, so the button and the page can never
        // disagree about whether there is anything worth sending.
        const vetEventCount = (careEvents as { eventType: string }[])
            .filter(e => isVetEventType(e.eventType)).length;
        const contact = (followupsEnabled || vetEventCount > 0)
            ? await resolveAdopterContact(db, userEmail, active.adopterId, animalId, 'animalProfile')
            : { phone: null, channel: 'whatsapp' as const, firstName: '' };

        healthRecord = {
            token: active.healthToken ?? null,
            vetEventCount,
            familyName: contact.firstName || null,
            contact: contact.phone ? { channel: contact.channel, phone: contact.phone } : null,
        };

        if (followupsEnabled) {
            const built = await buildProjectedSlots(db, {
                animalId, userEmail,
                placement: active,
                animal: {
                    name: animal.name ?? null, estimatedBirthDate: animal.estimatedBirthDate ?? null,
                    neutered: animal.neutered ?? null, addedBy: animal.addedBy ?? null,
                },
                events: events as any[],
                careEvents: careEvents as any[],
                contact,
            }).catch((e) => {
                logger.warn('getAnimalProfile: projected fallback', {
                    animalId, userEmail, error: e instanceof Error ? e.message : String(e),
                });
                return { slots: [] as ProjectedSlot[], reminder: { email: false, toYou: true } };
            });
            projected = built.slots;
            reminder = built.reminder;
        }
    }

    return {
        animal: {
            id: animal.id, name: animal.name ?? null, species: animal.species ?? null,
            details: animal.details ?? null, age: animal.age ?? null,
            estimatedBirthDate: toMs(animal.estimatedBirthDate), neutered: animal.neutered ?? null,
            sex: animal.sex ?? null, color: animal.color ?? null, microchip: animal.microchip ?? null,
            createdAt: toMs(animal.createdAt), addedBy: animal.addedBy ?? null,
            listed: animal.listed ?? null,
        },
        activePlacement: active ? {
            id: active.id, recordType: active.recordType, adopterId: active.adopterId,
            adopterName: nameMap.get(active.adopterId) ?? null, startedAt: toMs(active.startedAt),
        } : null,
        items,
        images: mapImages(animalImages as any[]),
        followupsEnabled,
        projected,
        reminder,
        addedByName,
        orgName,
        userNameMap,
        healthRecord,
    };
}

/**
 * The adopter's reachable phone, for the one-tap contact affordances (a due
 * follow-up, and the health-record handover).
 *
 * It offers exactly a phone this viewer already sees in full on the adopter's
 * profile: the same inputs getAdopter masks with (the gating flag,
 * resolveAdopterVisibility, the public-profile option), decided by the pure
 * reachablePhoneForViewer. It used to check only `nothingMasked` and ignore
 * the gating flag, so it could hide a phone the profile was showing.
 * A visibility or DB error fails CLOSED: the caller gets `phone: null`, which
 * every caller renders as "no contact shortcut" rather than as an error.
 * Exception, shared with the profile: getFeatureFlag swallows a failed flag
 * read and returns the code default (gating OFF), so then nothing is masked
 * here either — the two surfaces still agree. The first
 * name comes back regardless — it is already on screen next to the animal.
 */
async function resolveAdopterContact(
    db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
    userEmail: string,
    adopterId: string,
    animalId: string,
    op: string,
): Promise<{ phone: string | null; channel: 'whatsapp' | 'telegram'; firstName: string }> {
    let phone: string | null = null;
    let channel: 'whatsapp' | 'telegram' = 'whatsapp';
    let firstName = '';
    try {
        const adopter = await db.select({
            id: adopters.id, name: adopters.name, addedBy: adopters.addedBy, isPublic: adopters.isPublic,
            contactEntries: adopters.contactEntries, contactInfo: adopters.contactInfo,
        }).from(adopters).where(eq(adopters.id, adopterId)).get();
        if (adopter) {
            firstName = (adopter.name || '').trim().split(/\s+/)[0] || '';
            const [gatingOn, visibility, maskOptions] = await Promise.all([
                isPiiGatingEnabled(),
                resolveAdopterVisibility(userEmail, { id: adopter.id, addedBy: adopter.addedBy }),
                buildMaskOptions(adopter),
            ]);
            const reachable = reachablePhoneForViewer(adopter, { gatingOn, visibility, maskOptions });
            if (reachable) { phone = reachable.phone; channel = reachable.channel; }
        }
    } catch (e) {
        logger.warn(op + ': contact resolution fallback', {
            animalId, adopterId, userEmail,
            error: e instanceof Error ? e.message : String(e),
        });
    }
    return { phone, channel, firstName };
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
    animal: { name: string | null; estimatedBirthDate: Date | number | null; neutered: number | null; addedBy: string | null };
    events: any[];
    careEvents: any[];
    /** Resolved once by the caller and shared with the health-record handover. */
    contact: { phone: string | null; channel: 'whatsapp' | 'telegram'; firstName: string };
}): Promise<{ slots: ProjectedSlot[]; reminder: { email: boolean; toYou: boolean } }> {
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

    // The cron sends to the whole team, EXCEPT to members who asked for only
    // their own animals — so on a teammate's animal the honest answer is "the
    // person who registered it gets this one", not "we'll tell you".
    const reminder = {
        email: settings?.emailReminders === true,
        toYou: settings?.onlyMyAnimals !== true || animal.addedBy === input.userEmail,
    };

    const startedAt = asDate(placement.startedAt);
    if (!startedAt) return { slots: [], reminder };

    const slots = computeFollowups({
        placementStartedAt: startedAt,
        placementType: placement.recordType,
        animal: { estimatedBirthDate: asDate(animal.estimatedBirthDate), neutered: animal.neutered },
        schedule: mergeSchedule(DEFAULT_SCHEDULE, settings),
        fosterRule: mergeFosterRule(settings),
        recorded,
        now: new Date(),
        notBefore: resolveFollowupsEpoch(),
    });

    // One-click contact, resolved by the caller (getAnimalProfile) so the page
    // pays for it once: resolveAdopterContact is the single authority on
    // whether this viewer may see the number, and it fails closed.
    const { phone: contactPhone, channel: contactChannel, firstName: familia } = input.contact;

    const now = Date.now();
    const mapped = slots.map(s => {
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
    return { slots: mapped, reminder };
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

/* ────────────────────────────────────────────────────────────────────────
 * Photos (v2.56.86)
 *
 * Until now an animal's photos could only be set while creating it: the page
 * rendered them read-only and the in-place edit carried the text fields only,
 * so a wrong or missing photo meant deleting and re-creating the animal — and
 * losing its whole line of life with it. A photoless animal is also invisible
 * to the public catalogue, so this was the difference between listable and not.
 *
 * Three rules these actions exist to enforce, none of which the generic
 * image actions apply:
 *  - the photo must BELONG to this animal (`adoption_id === animalId`), so a
 *    caller with parity on one animal can't reach another's rows — or an
 *    adopter's avatar — by passing a foreign image id;
 *  - the gate is the ANIMAL's (owner ∨ org-mate ∨ admin), not `deleteImage`'s
 *    uploader-or-admin rule, which would stop a teammate from removing a photo
 *    on an animal they can otherwise fully edit, delete included;
 *  - "primary" is demoted per ADOPTION_ID. Scoping it by adopter_id — what
 *    `saveImage` does for avatars — would clear the lead photo of every
 *    available animal in the system, since they all share '__available__'.
 * ──────────────────────────────────────────────────────────────────────── */

/** Ids arrive from the browser, so they are shaped before they reach a query —
 *  same convention as addAnimalEventSchema above. */
const animalPhotoIdSchema = z.string().min(1).max(64);
/** A compressed 1200px JPEG lands well under 1 MB; the cap only exists so a
 *  browser-callable endpoint can't be used to push arbitrary bulk into D1. */
const MAX_PHOTO_DATA_URL = 8_000_000;

/** Owner ∨ org-mate ∨ admin on the animal, plus the animal's current holder. */
async function assertCanEditAnimal(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, animalId: string, userEmail: string) {
    const animal = await db.select({ id: animals.id, addedBy: animals.addedBy, deletedAt: animals.deletedAt })
        .from(animals).where(eq(animals.id, animalId)).get();
    if (!animal || animal.deletedAt) return null;
    const { isOwnerOrOrgMate } = await import('@/lib/orgMembership');
    const { checkIsAdminAsync } = await import('@/app/actions/_db');
    if (!(await isOwnerOrOrgMate(userEmail, animal.addedBy)) && !(await checkIsAdminAsync(userEmail))) return null;
    return animal;
}

/** The photo exists AND hangs off this animal. Guards against a caller with
 *  parity on animal A passing an image id belonging to anything else. */
async function loadOwnPhoto(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, animalId: string, imageId: string) {
    const img = await db.select({ id: adopterImages.id, adoptionId: adopterImages.adoptionId, caption: adopterImages.caption })
        .from(adopterImages).where(eq(adopterImages.id, imageId)).get();
    if (!img || img.adoptionId !== animalId) return null;
    return img;
}

export async function addAnimalPhoto(animalId: string, dataUrl: string): Promise<{ success: true; id: string } | { error: string }> {
    const { getUser } = await import('@/app/actions/_db');
    const userEmail = await getUser();
    try {
        if (!userEmail) return { error: 'Unauthorized' };
        if (!animalPhotoIdSchema.safeParse(animalId).success) return { error: 'Not found' };
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return { error: 'Invalid image' };
        if (dataUrl.length > MAX_PHOTO_DATA_URL) return { error: 'Image too large' };
        const db = await getDb();
        if (!db) return { error: 'Database not available' };
        const animal = await assertCanEditAnimal(db, animalId, userEmail);
        if (!animal) return { error: 'Not found' };

        // `adopter_images.adopter_id` is NOT NULL, so an animal with no current
        // holder uses the same '__available__' sentinel the create form writes.
        const active = await db.select({ adopterId: placements.adopterId })
            .from(placements).where(sql`${placements.animalId} = ${animalId} AND ${placements.endedAt} IS NULL`).get();
        const owner = active?.adopterId || '__available__';

        const { saveImage } = await import('@/app/actions/images');
        // 'animal': this is the animal's own gallery («Editar» on its page), so it
        // reaches the public showcase and the shared health record — and it stays
        // the animal's through a devolución, unlike the holder in `owner`.
        const res = await saveImage(owner, dataUrl, undefined, animalId, 'image', false, 'animal');
        const id = (res as { id?: string })?.id;
        if (!id) return { error: 'Upload failed' };

        await db.update(animals).set({ updatedAt: new Date(), updatedBy: userEmail }).where(eq(animals.id, animalId));
        logAudit({ userEmail, action: 'animal_photo_added', target: animalId, details: { imageId: id } });
        revalidatePath(`/my-animals/${animalId}`);
        return { success: true, id };
    } catch (error) {
        const errorId = logger.error('addAnimalPhoto failed', error, { animalId, userEmail });
        return { error: `Failed to add photo (${errorId})` };
    }
}

export async function deleteAnimalPhoto(animalId: string, imageId: string): Promise<{ success: true } | { error: string }> {
    const { getUser } = await import('@/app/actions/_db');
    const userEmail = await getUser();
    try {
        if (!userEmail) return { error: 'Unauthorized' };
        if (!animalPhotoIdSchema.safeParse(animalId).success) return { error: 'Not found' };
        if (!animalPhotoIdSchema.safeParse(imageId).success) return { error: 'Not found' };
        const db = await getDb();
        if (!db) return { error: 'Database not available' };
        if (!(await assertCanEditAnimal(db, animalId, userEmail))) return { error: 'Not found' };
        const img = await loadOwnPhoto(db, animalId, imageId);
        if (!img) return { error: 'Not found' };

        await db.delete(adopterImages).where(eq(adopterImages.id, imageId));
        await db.update(animals).set({ updatedAt: new Date(), updatedBy: userEmail }).where(eq(animals.id, animalId));
        logAudit({ userEmail, action: 'animal_photo_deleted', target: animalId, details: { imageId } });
        revalidatePath(`/my-animals/${animalId}`);
        return { success: true };
    } catch (error) {
        const errorId = logger.error('deleteAnimalPhoto failed', error, { animalId, imageId, userEmail });
        return { error: `Failed to remove photo (${errorId})` };
    }
}

/**
 * v2.56.128: the rescuer's switch for the public catalogue.
 *
 * Taking an animal out is not a state of the animal — it is still available,
 * still fostered, still has its photos. It covers the cases the app has no
 * other word for: under treatment, already promised, not ready to be seen.
 * Adopting it away is what ENDS a listing; this only pauses one.
 *
 * Stored as NULL/1 = listed, 0 = hidden, so an animal that predates the
 * switch keeps appearing without a backfill.
 */
export async function setAnimalListed(animalId: string, listed: boolean): Promise<{ success: true } | { error: string }> {
    const { getUser } = await import('@/app/actions/_db');
    const userEmail = await getUser();
    try {
        if (!userEmail) return { error: 'Unauthorized' };
        if (!animalPhotoIdSchema.safeParse(animalId).success) return { error: 'Not found' };
        const db = await getDb();
        if (!db) return { error: 'Database not available' };
        if (!(await assertCanEditAnimal(db, animalId, userEmail))) return { error: 'Not found' };

        await db.update(animals)
            .set({ listed: listed ? 1 : 0, updatedAt: new Date(), updatedBy: userEmail })
            .where(eq(animals.id, animalId));

        logAudit({ userEmail, action: 'animal_listing_set', target: animalId, details: { listed } });
        revalidatePath(`/my-animals/${animalId}`);
        revalidatePath('/my-animals');
        return { success: true };
    } catch (error) {
        const errorId = logger.error('setAnimalListed failed', error, { animalId, listed, userEmail });
        return { error: `Failed to change the catalogue setting (${errorId})` };
    }
}

export async function setAnimalPrimaryPhoto(animalId: string, imageId: string): Promise<{ success: true } | { error: string }> {
    const { getUser } = await import('@/app/actions/_db');
    const userEmail = await getUser();
    try {
        if (!userEmail) return { error: 'Unauthorized' };
        if (!animalPhotoIdSchema.safeParse(animalId).success) return { error: 'Not found' };
        if (!animalPhotoIdSchema.safeParse(imageId).success) return { error: 'Not found' };
        const db = await getDb();
        if (!db) return { error: 'Database not available' };
        if (!(await assertCanEditAnimal(db, animalId, userEmail))) return { error: 'Not found' };
        const img = await loadOwnPhoto(db, animalId, imageId);
        if (!img) return { error: 'Not found' };

        // Scoped to THIS animal — never to adopter_id (see the note above).
        await db.update(adopterImages).set({ isPrimary: 0 }).where(eq(adopterImages.adoptionId, animalId));
        await db.update(adopterImages).set({ isPrimary: 1 }).where(eq(adopterImages.id, imageId));

        await db.update(animals).set({ updatedAt: new Date(), updatedBy: userEmail }).where(eq(animals.id, animalId));
        logAudit({ userEmail, action: 'animal_photo_primary_set', target: animalId, details: { imageId } });
        revalidatePath(`/my-animals/${animalId}`);
        return { success: true };
    } catch (error) {
        const errorId = logger.error('setAnimalPrimaryPhoto failed', error, { animalId, imageId, userEmail });
        return { error: `Failed to set the main photo (${errorId})` };
    }
}
