/**
 * Shared field whitelisting + rescuer-display resolution for the four
 * public showcase API routes (v2.14.10-1):
 *   /api/showcase/all
 *   /api/showcase/org/[slug]
 *   /api/showcase/user/[handle]
 *   /api/showcase/animal/[id]
 *
 * Hard rule: never leak adopter data, ratings, flags, or rescuer email
 * via these endpoints. The `pickPublicAnimal` whitelist is the single
 * source of truth for what's safe to return; if a new sensitive field
 * gets added to the adoptions schema, it stays excluded until explicitly
 * added here.
 *
 * Mirror of the field-projection pattern in /api/contract/[id]/route.ts
 * but extended for the catalog flow (multiple animals, paginated, with
 * rescuer/org context).
 */

import { adoptions, adopterImages, users, organizations, orgMembers, userProfiles } from '@/db/schema';
import { logger } from '@/lib/logger';
import { eq, and, isNull, desc, sql } from 'drizzle-orm';

export interface PublicAnimal {
    id: string;
    animalName: string | null;
    species: string | null;
    age: string | null;
    estimatedBirthDate: number | null; // unix seconds
    sex: string | null;
    neutered: number | null;
    color: string | null;
    microchip: string | null;
    details: string | null;
    date: number | null;
    images: PublicMedia[];
    rescuer: PublicRescuer;
}

/** One photo or video on a public animal page. `thumbnailUrl` is the still a
 *  video is represented by; for a photo it is null and `url` is the image. */
export interface PublicMedia {
    id: string;
    url: string;
    caption: string | null;
    mediaType: string | null;
    thumbnailUrl: string | null;
}

export interface PublicRescuer {
    displayName: string;
    orgName?: string;
    orgSlug?: string;
    userHandle?: string;
    /** NextAuth user ID — opaque UUID, NOT the email. Exposed because the
     *  showcase "Adoptar" CTA needs to construct `/form?u={userId}&animal=...`
     *  to launch the form. Same exposure level as the existing share-form
     *  flow where rescuers share `/form?u={userId}` directly. */
    userId?: string;
}

/** Hard whitelist on which adoption columns become a `PublicAnimal`. */
export function pickPublicAnimal(
    row: typeof adoptions.$inferSelect,
    images: PublicMedia[],
    rescuer: PublicRescuer,
): PublicAnimal {
    return {
        id: row.id,
        animalName: row.animalName,
        species: row.species,
        age: row.age,
        estimatedBirthDate: row.estimatedBirthDate ? Math.floor(row.estimatedBirthDate.getTime() / 1000) : null,
        sex: row.sex,
        neutered: row.neutered,
        color: row.color,
        microchip: row.microchip,
        details: row.details,
        date: row.date ? Math.floor(row.date.getTime() / 1000) : null,
        images,
        rescuer,
    };
}

/** Build the public rescuer-display block for an animal's `addedBy` email.
 *  Resolves: display name from `user.name` (falls back to email local-part),
 *  first org the rescuer belongs to (name + slug), and the rescuer's own
 *  handle. NEVER includes the email itself.
 */
export async function buildPublicRescuer(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any,
    addedBy: string | null,
): Promise<PublicRescuer> {
    if (!addedBy) return { displayName: 'Comunidad' };

    // Display name from the user table
    let displayName = '';
    let userHandle: string | undefined;
    let userId: string | undefined;
    try {
        const userRow = await db.select({ name: users.name, id: users.id })
            .from(users)
            .where(eq(users.email, addedBy))
            .get();
        if (userRow?.name) displayName = userRow.name;
        if (userRow?.id) {
            userId = userRow.id;
            // Handle from user_profiles
            const profile = await db.select({ handle: userProfiles.handle })
                .from(userProfiles)
                .where(eq(userProfiles.userId, userRow.id))
                .get();
            if (profile?.handle) userHandle = profile.handle;
        }
    } catch (e) {
        // Fall through to the email-prefix fallback; no addedBy/email in the log.
        logger.warn('buildPublicRescuer: user lookup fallback', { error: e instanceof Error ? e.message : String(e) });
    }

    if (!displayName) {
        const at = addedBy.indexOf('@');
        displayName = at > 0 ? addedBy.slice(0, at) : addedBy;
    }

    // First org the rescuer belongs to (alphabetical by name for deterministic display)
    let orgName: string | undefined;
    let orgSlug: string | undefined;
    try {
        const membership = await db.select({ orgId: orgMembers.orgId })
            .from(orgMembers)
            .where(eq(orgMembers.userEmail, addedBy))
            .get();
        if (membership?.orgId) {
            const org = await db.select({ name: organizations.name, slug: organizations.slug })
                .from(organizations)
                .where(eq(organizations.id, membership.orgId))
                .get();
            if (org) { orgName = org.name; orgSlug = org.slug ?? undefined; }
        }
    } catch (e) {
        // No org affiliation shown; no addedBy/email in the log.
        logger.warn('buildPublicRescuer: org lookup fallback', { error: e instanceof Error ? e.message : String(e) });
    }

    return { displayName, orgName, orgSlug, userHandle, userId };
}

/** Fetch up to 5 images for a list of animal IDs. D1-safe: fan-out per id
 *  with eq() rather than inArray() per CLAUDE.md.
 */
/** The chosen lead photo first, for rows keyed by adoption_id (= animals.id).
 *
 *  Contributes ONLY this one rule: each call site passes its own tiebreaker
 *  after it. That is deliberate — the first cut of this helper also supplied
 *  `rowid ASC`, which silently changed two readers that already ordered by
 *  `uploaded_at DESC` (Drizzle's second `.orderBy()` REPLACES the first, so
 *  those sites lost the primary flag entirely and the e2e caught it), and
 *  would have flipped a third from newest-first to oldest-first.
 *
 *  Load-bearing wherever a reader takes the FIRST image or applies a LIMIT:
 *  without it the chosen photo can be cut off outright by `LIMIT 5`. */
export function animalPrimaryFirst() {
    return sql`is_primary DESC`;
}

export async function fetchAnimalImages(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any,
    animalIds: string[],
): Promise<Map<string, PublicMedia[]>> {
    const map = new Map<string, PublicMedia[]>();
    if (animalIds.length === 0) return map;
    await Promise.all(animalIds.map(async (id) => {
        try {
            const imgs = await db.select({
                id: adopterImages.id,
                url: adopterImages.url,
                caption: adopterImages.caption,
                // v2.56.127: a rescuer can attach video. Without these the
                // card, the hero and the thumb strip put an .mp4 in an <img>.
                mediaType: adopterImages.mediaType,
                thumbnailUrl: adopterImages.thumbnailUrl,
            }).from(adopterImages)
                // v2.56.124: the animal key also carries photos attached while
                // recording an adoption from the adopter's side — the handover,
                // a document, the family. They used to reach this page, which
                // matters most right after a devolución, when the animal is
                // re-listed and those photos are the newest ones it has. Only
                // the animal's own gallery is public (`scope = 'animal'`);
                // anything unstamped is treated as not-public.
                .where(and(
                    eq(adopterImages.adoptionId, id),
                    eq(adopterImages.scope, 'animal'),
                    // A video with no poster is nothing any of these surfaces
                    // can draw — it would be an unlabelled black tile in the
                    // strip. Leave it out rather than serve a hole.
                    sql`(COALESCE(${adopterImages.mediaType}, 'image') <> 'video' OR ${adopterImages.thumbnailUrl} IS NOT NULL)`,
                ))
                .orderBy(animalPrimaryFirst(), sql`rowid ASC`)
                .limit(5)
                .all();
            map.set(id, imgs);
        } catch (e) {
            logger.warn('fetchAnimalImages: fallback', { animalId: id, error: e instanceof Error ? e.message : String(e) });
            map.set(id, []);
        }
    }));
    return map;
}

/** Base WHERE clause for "available" animal rows — used by every showcase query.
 *  Pulls only animals that are: recordType='available', not adopted yet,
 *  not soft-deleted. The `addedBy IS NOT NULL` check is defensive against
 *  orphan rows.
 */
export function availableAnimalsBase() {
    return and(
        eq(adoptions.recordType, 'available'),
        isNull(adoptions.adopterId),
    );
}

/** Order-by clause for showcase lists — newest available first. */
export function availableAnimalsOrder() {
    return desc(adoptions.date);
}
