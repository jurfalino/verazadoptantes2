export const runtime = 'edge';
import { NextResponse } from 'next/server';
import { withCors, corsPreflightResponse } from '@/lib/cors';
import { logger } from '@/lib/logger';
import { animals, animalEvents, adopterImages } from '@/db/schema';
import { eq, and, or, isNull, desc, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { buildPublicRescuer, animalPrimaryFirst } from '@/lib/showcase';
import { VET_EVENT_TYPES } from '@/domain/constants';

/**
 * GET /api/showcase/health/[id] — the animal's shareable health record.
 * Consumed by the contract-app's /salud/:id page, which a rescuer hands to
 * the family that adopted or is fostering the animal.
 *
 * What this route must NEVER return, by construction rather than by filtering
 * at the edges: it reads `animals`, `animal_events` and `adopter_images`, and
 * nothing else. It never touches `placements`, `adopters`, `adopter_events`
 * or `user_profiles`, so there is no path by which a foster home, an adopter,
 * a rating or a follow-up to the family can reach the response. The only
 * person named is the rescuer who recorded the animal (buildPublicRescuer),
 * stripped of the handle/userId the adoption showcase uses for its CTA —
 * this page is not a listing and offers no way to apply for the animal.
 *
 * Events are limited to VET_EVENT_TYPES; `note` is excluded (free text).
 *
 * Gating is deliberately NOT on custody. The sibling /api/showcase/animal/[id]
 * 404s once an animal is adopted, which is right for a listing; here it would
 * break a link already sitting in a family's WhatsApp the moment anyone
 * records a devolución. The record belongs to the animal, so it stays up as
 * long as there is something clinical to show. 404 when there is not: an empty
 * health record is worse than no link, and the UI hides the share button in
 * exactly the same case.
 */
export async function OPTIONS(req: Request) {
    return corsPreflightResponse(req.headers.get('origin'));
}

type ApiEvent = {
    id: string;
    eventType: string;
    date: number | null;
    details: string | null;
    images: { id: string; url: string; caption: string | null }[];
};

const toMs = (d: unknown): number | null =>
    d instanceof Date ? d.getTime() : typeof d === 'number' ? d * 1000 : null;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const origin = request.headers.get('origin');
    const { id } = await params;
    try {
        const db = await getDb();
        if (!db) return withCors(NextResponse.json({ error: 'Database unavailable' }, { status: 500 }), origin);

        const animal = await db.select()
            .from(animals)
            .where(and(eq(animals.id, id), isNull(animals.deletedAt)))
            .get() as typeof animals.$inferSelect | undefined;
        if (!animal) {
            return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }), origin);
        }

        // D1 does not expand array parameters in IN clauses, so the type filter
        // is an OR of equalities rather than inArray() (docs/D1_COMPATIBILITY.md).
        type Row = { id: string; eventType: string; date: unknown; details: string | null; createdAt: unknown };
        const rows = (await db.select({
            id: animalEvents.id,
            eventType: animalEvents.eventType,
            date: animalEvents.date,
            details: animalEvents.details,
            createdAt: animalEvents.createdAt,
        }).from(animalEvents)
            .where(and(
                eq(animalEvents.animalId, id),
                or(...VET_EVENT_TYPES.map(t => eq(animalEvents.eventType, t))),
            ))
            .orderBy(desc(animalEvents.date), desc(animalEvents.createdAt))
            .all()) as Row[];

        if (rows.length === 0) {
            return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }), origin);
        }

        // Photos. `adopter_images.adoption_id` is overloaded: an EVENT's photos
        // key on the event id, and an ANIMAL's photos key on the animal id.
        //
        // Event photos are safe by construction — an event id is only ever
        // written by the care-event modal. Animal-level ones are NOT: the
        // adopter-side record editor (AdoptionFormEditV2) also writes
        // `adoption_id = <animal id>` for a placement-backed record, so that
        // key mixes the animal's own gallery with photos someone attached to
        // an adoption — which may show the adopter, their home or a document.
        // There is no column that tells the two apart after the fact.
        //
        // So the animal-level fetch is narrowed to `adopter_id = '__available__'`:
        // the sentinel the create form and the listing flow write, i.e. photos
        // taken of the animal itself rather than of a placement. Conservative
        // on purpose — it can omit a legitimate photo (one added from the
        // animal page WHILE the animal is placed carries the holder's id, not
        // the sentinel), and it can never include one of the family. Fixing
        // that gap means marking animal photos at write time; until then a
        // missing photo is the acceptable failure and a leaked one is not.
        const pickEventImages = async (eventId: string) => pickImages(eq(adopterImages.adoptionId, eventId), eventId);
        const pickAnimalImages = async () => pickImages(
            and(eq(adopterImages.adoptionId, id), eq(adopterImages.adopterId, '__available__')), id);

        async function pickImages(where: ReturnType<typeof and>, key: string) {
            try {
                return await db.select({
                    id: adopterImages.id,
                    url: adopterImages.url,
                    caption: adopterImages.caption,
                }).from(adopterImages)
                    .where(where)
                    .orderBy(animalPrimaryFirst(), sql`${adopterImages.uploadedAt} DESC`)
                    .limit(10)
                    .all();
            } catch (e) {
                logger.warn('GET /api/showcase/health/[id]: image fallback', {
                    animalId: id, key, error: e instanceof Error ? e.message : String(e),
                });
                return [];
            }
        }

        const [animalImages, ...eventImages] = await Promise.all([
            pickAnimalImages(),
            ...rows.map(r => pickEventImages(r.id)),
        ]);

        const events: ApiEvent[] = rows.map((r, i) => ({
            id: r.id,
            eventType: r.eventType,
            date: toMs(r.date) ?? toMs(r.createdAt),
            details: r.details ?? null,
            images: eventImages[i] ?? [],
        }));

        const rescuer = await buildPublicRescuer(db, animal.addedBy);

        // The freshest clinical fact on the page — what "up to" means in the
        // footer. Never animals.updatedAt: editing the colour is not a visit.
        const recordedUpTo = events.reduce<number | null>(
            (acc, e) => (e.date && (acc === null || e.date > acc) ? e.date : acc), null);

        return withCors(NextResponse.json({
            animal: {
                id: animal.id,
                name: animal.name ?? null,
                species: animal.species ?? null,
                sex: animal.sex ?? null,
                color: animal.color ?? null,
                age: animal.age ?? null,
                estimatedBirthDate: toMs(animal.estimatedBirthDate),
                neutered: animal.neutered ?? null,
                // `details` is deliberately absent. It is free text, and in
                // production a third of the descriptions name a family, an
                // adoption or a foster home — the same reason `note` events
                // are excluded. The descriptor the page shows is built from
                // the structured fields above, which cannot name anyone.
                images: animalImages,
            },
            events,
            rescuer: { displayName: rescuer.displayName, orgName: rescuer.orgName },
            recordedUpTo,
        }, {
            headers: {
                'Cache-Control': 'public, max-age=60, stale-while-revalidate=600',
                // A health record is handed to one family, not published. It
                // stays reachable by link, but it has no business in a search
                // index — see the share modal's copy, which says exactly that.
                'X-Robots-Tag': 'noindex, nofollow',
            },
        }), origin);
    } catch (e) {
        const errorId = logger.error('GET /api/showcase/health/[id] failed', e, { animalId: id });
        return withCors(NextResponse.json({ error: 'Failed to load health record', errorId }, { status: 500 }), origin);
    }
}
