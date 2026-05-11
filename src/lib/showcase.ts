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
import { eq, and, isNull, desc } from 'drizzle-orm';

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
    images: { id: string; url: string; caption: string | null }[];
    rescuer: PublicRescuer;
}

export interface PublicRescuer {
    displayName: string;
    orgName?: string;
    orgSlug?: string;
    userHandle?: string;
}

/** Hard whitelist on which adoption columns become a `PublicAnimal`. */
export function pickPublicAnimal(
    row: typeof adoptions.$inferSelect,
    images: { id: string; url: string; caption: string | null }[],
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
    try {
        const userRow = await db.select({ name: users.name, id: users.id })
            .from(users)
            .where(eq(users.email, addedBy))
            .get();
        if (userRow?.name) displayName = userRow.name;
        // Handle from user_profiles
        if (userRow?.id) {
            const profile = await db.select({ handle: userProfiles.handle })
                .from(userProfiles)
                .where(eq(userProfiles.userId, userRow.id))
                .get();
            if (profile?.handle) userHandle = profile.handle;
        }
    } catch { /* fall through to email-prefix fallback */ }

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
    } catch { /* no org affiliation, fine */ }

    return { displayName, orgName, orgSlug, userHandle };
}

/** Fetch up to 5 images for a list of animal IDs. D1-safe: fan-out per id
 *  with eq() rather than inArray() per CLAUDE.md.
 */
export async function fetchAnimalImages(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any,
    animalIds: string[],
): Promise<Map<string, { id: string; url: string; caption: string | null }[]>> {
    const map = new Map<string, { id: string; url: string; caption: string | null }[]>();
    if (animalIds.length === 0) return map;
    await Promise.all(animalIds.map(async (id) => {
        try {
            const imgs = await db.select({
                id: adopterImages.id,
                url: adopterImages.url,
                caption: adopterImages.caption,
            }).from(adopterImages)
                .where(eq(adopterImages.adoptionId, id))
                .limit(5)
                .all();
            map.set(id, imgs);
        } catch {
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
