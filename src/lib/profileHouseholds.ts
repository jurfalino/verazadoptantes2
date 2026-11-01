/**
 * The profile page's household data (households as profiles, Task 8): every
 * household the profile is in (`getHouseholdsFor` — converts today's old
 * household data lazily first), the gift recipients its gift forms named
 * that have no profile yet (P4), and whether this viewer may press «Crear
 * perfil de …» there. Plain server module (not 'use server'). Never throws:
 * each part degrades to empty, logged with the page's context.
 */
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getHouseholdsFor, householdLinesFor } from '@/lib/households';
import { EMPTY_PROFILE_HOUSEHOLDS, NO_HOUSEMATE_ALERT, type ProfileHouseholds } from '@/domain/profileHouseholds';
import { housemateHasAlerts, housemateLowRating, type HouseholdLine } from '@/domain/households';

export { EMPTY_PROFILE_HOUSEHOLDS, type ProfileHouseholds };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function readProfileHouseholds(
    viewer: string,
    adopterId: string,
    loaded: Promise<{ addedBy: string | null } | null>,
): Promise<ProfileHouseholds> {
    const ctx = { adopterId, viewer };
    try {
        const db = await getDb();
        if (!db) return EMPTY_PROFILE_HOUSEHOLDS;
        const { giftRecipientsForViewer, mayCreateGiftRecipient } = await import('@/lib/householdPeople');
        const [views, gifts, adopter, lines] = await Promise.all([
            getHouseholdsFor(db, viewer || null, adopterId),
            giftRecipientsForViewer(db, viewer || null, adopterId),
            loaded,
            // The header's housemate alerts read exactly what a search card reads (bounded per card; never
            // throws) — for a signed-in viewer only, as search does (the line names people).
            viewer ? householdLinesFor(db, viewer, [adopterId]) : Promise.resolve({} as Record<string, HouseholdLine[]>),
        ]);
        // A form whose recipient already has a profile is shown by its gift household (P5), not twice.
        const giftForms = gifts.filter(g => !g.profileId);
        let canCreateGift = false;
        if (giftForms.length > 0 && viewer && adopter) {
            canCreateGift = await mayCreateGiftRecipient(viewer, adopter.addedBy).catch((e: unknown) => {
                logger.warn('profileHouseholds: gift permission check failed, «Crear perfil» hidden', { ...ctx, error: errMsg(e) });
                return false;
            });
        }
        const mine = lines[adopterId] ?? [];
        const housemateAlert = mine.length ? { lowRating: housemateLowRating(mine), hasAlerts: housemateHasAlerts(mine) } : NO_HOUSEMATE_ALERT;
        return { views, giftForms, canCreateGift, housemateAlert };
    } catch (e) {
        logger.warn('profileHouseholds: read failed, the profile shows no households', { ...ctx, error: errMsg(e) });
        return EMPTY_PROFILE_HOUSEHOLDS;
    }
}
