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
import { getHouseholdsFor } from '@/lib/households';
import { EMPTY_PROFILE_HOUSEHOLDS, type ProfileHouseholds } from '@/domain/profileHouseholds';

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
        const [views, gifts, adopter] = await Promise.all([
            getHouseholdsFor(db, viewer || null, adopterId),
            giftRecipientsForViewer(db, viewer || null, adopterId),
            loaded,
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
        return { views, giftForms, canCreateGift };
    } catch (e) {
        logger.warn('profileHouseholds: read failed, the profile shows no households', { ...ctx, error: errMsg(e) });
        return EMPTY_PROFILE_HOUSEHOLDS;
    }
}
