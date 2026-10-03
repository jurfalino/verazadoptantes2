export const runtime = 'edge';
import { NextResponse } from 'next/server';
import { withCors, corsPreflightResponse } from '@/lib/cors';
import { logger } from '@/lib/logger';
import { animals, animalEvents, adopterImages, placements } from '@/db/schema';
import { eq, and, or, isNull, desc, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { buildPublicRescuer, animalPrimaryFirst } from '@/lib/showcase';
import { VET_EVENT_TYPES } from '@/domain/constants';

/**
 * GET /api/showcase/health/[token] — one adoption's shareable health record.
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
 * The address is the PLACEMENT's `health_token`, not the animal's id: one
 * address per adoption. That is what makes the link expire. When the animal
 * comes home the placement ends and this 404s forever; adopting it out again
 * mints a fresh token for the new family, and the first family's link stays
 * dead (product decision, 2026-10-03). The token is random — the placement id
 * could not be used, since `_recordWrite` derives it from the animal id for
 * animals created with a home attached, and the animal id is public.
 *
 * Two gates, and both must hold or the link 404s:
 *
 *  1. The token names a placement that is still OPEN.
 *  2. The animal has at least one clinical entry. An empty record is worse
 *     than no link, and the UI hides the share button on exactly the same
 *     condition, so a rescuer can never send one.
 *
 * `placements` is read to resolve the token and for nothing else — no field of
 * it reaches the response, which tests/health-record.unauthed.spec.ts asserts
 * against the whole payload.
 */
export async function OPTIONS(req: Request) {
    return corsPreflightResponse(req.headers.get('origin'));
}

type ApiMedia = {
    id: string; url: string; caption: string | null;
    mediaType: string | null; thumbnailUrl: string | null;
};

type ApiEvent = {
    id: string;
    eventType: string;
    date: number | null;
    details: string | null;
    images: ApiMedia[];
};

const toMs = (d: unknown): number | null =>
    d instanceof Date ? d.getTime() : typeof d === 'number' ? d * 1000 : null;

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
    const origin = request.headers.get('origin');
    const { token } = await params;
    try {
        const db = await getDb();
        if (!db) return withCors(NextResponse.json({ error: 'Database unavailable' }, { status: 500 }), origin);

        // Gate 1: an OPEN placement with this token. A returned animal's span
        // is closed, so the link the family was given stops here.
        const placement = await db.select({ animalId: placements.animalId })
            .from(placements)
            .where(and(eq(placements.healthToken, token), isNull(placements.endedAt)))
            .get();
        if (!placement) {
            return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }), origin);
        }
        const id = placement.animalId;

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

        // Photos, in the two places they live.
        //
        // Event photos key on the EVENT id and are safe by construction: only
        // the care-event modal ever writes that id, so these are exactly the
        // photos of the vet entry they hang under.
        //
        // Animal photos key on the ANIMAL id, which is shared with photos
        // attached while recording an adoption from the adopter's side — the
        // handover, a document, the family. `scope` is what separates them,
        // written at save time because nothing afterwards can
        // (adopter_images.scope). Unstamped rows are treated as not-public.
        const pickEventImages = async (eventId: string) => pickImages(eq(adopterImages.adoptionId, eventId), eventId);
        const pickAnimalImages = async () => pickImages(
            and(eq(adopterImages.adoptionId, id), eq(adopterImages.scope, 'animal')), id);

        async function pickImages(where: ReturnType<typeof and>, key: string) {
            try {
                return await db.select({
                    id: adopterImages.id,
                    url: adopterImages.url,
                    caption: adopterImages.caption,
                    // A rescuer can attach video as well as stills; without
                    // these the page would drop a video URL into an <img> and
                    // show a broken frame.
                    mediaType: adopterImages.mediaType,
                    thumbnailUrl: adopterImages.thumbnailUrl,
                }).from(adopterImages)
                    .where(where)
                    .orderBy(animalPrimaryFirst(), sql`${adopterImages.uploadedAt} DESC`)
                    .limit(10)
                    .all();
            } catch (e) {
                logger.warn('GET /api/showcase/health/[token]: image fallback', {
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
        const errorId = logger.error('GET /api/showcase/health/[token] failed', e);
        return withCors(NextResponse.json({ error: 'Failed to load health record', errorId }, { status: 500 }), origin);
    }
}
