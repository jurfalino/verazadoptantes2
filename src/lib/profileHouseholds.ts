/**
 * The profile page's household data (households as profiles, Task 8): every
 * household the profile is in (`getHouseholdsFor` — converts today's old
 * household data lazily first), the gift recipients its gift forms named
 * that have no profile yet (P4), and whether this viewer may press «Crear
 * perfil de …» there. Plain server module (not 'use server'). Never throws:
 * each part degrades to empty, logged with the page's context.
 *
 * The header's housemate alerts (review fix 1, 2026-11-01) come from these
 * same households, AFTER they are read (and converted): each member's rating
 * is already there; their period alerts are read here, only for a member with
 * enough records to have one. The same answers are what the section shows
 * (each member's alerts, review fix 4), so header and section never disagree.
 */
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getHouseholdsFor, periodAlertReader, type HouseholdView } from '@/lib/households';
import { EMPTY_PROFILE_HOUSEHOLDS, NO_HOUSEMATE_ALERT, type HousemateAlertSummary, type ProfileHouseholds } from '@/domain/profileHouseholds';
import { housemateAlertSummary, type HousemateAlertLine } from '@/domain/households';
import { mayHavePeriodAlerts, NO_PERIOD_ALERTS, type PeriodAlerts } from '@/domain/periodAlerts';
import { RECORD_TYPES } from '@/domain/constants';

export { EMPTY_PROFILE_HOUSEHOLDS, type ProfileHouseholds };

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Every member in the views as the housemate rules read them: a gift household's members are gift lines. */
const alertLines = (views: HouseholdView[]): HousemateAlertLine[] =>
    views.flatMap(v => v.members.map(m => ({ rating: m.rating, alerts: m.alerts ?? NO_PERIOD_ALERTS, isGift: v.isGift })));

/**
 * The members' own period alerts, read only where they can exist (their
 * activity counts are already in the view: mayHavePeriodAlerts), once per
 * person however many homes they share. Throws only if the config read does
 * (each person's read logs its own fallback).
 */
async function withMemberAlerts(db: Db, views: HouseholdView[], ctx: Record<string, unknown>): Promise<HouseholdView[]> {
    const reader = periodAlertReader(db, 'readProfileHouseholds');
    const members = views.flatMap(v => v.members);
    const counts = (m: HouseholdView['members'][number]) => ({
        adoptions: m.activity[RECORD_TYPES.ADOPTION] ?? 0,
        requests: m.activity[RECORD_TYPES.REQUEST] ?? 0,
    });
    const maybe = members.filter(m => { const c = counts(m); return c.adoptions > 0 || c.requests > 0; });
    if (maybe.length === 0) return views;
    const config = await reader.config();
    const ids = [...new Set(maybe.filter(m => mayHavePeriodAlerts(counts(m), config)).map(m => m.profileId))];
    if (ids.length === 0) return views;
    const read = new Map<string, PeriodAlerts>(await Promise.all(ids.map(async id => [id, await reader.alertsOf(id, ctx)] as const)));
    return views.map(v => ({ ...v, members: v.members.map(m => (read.has(m.profileId) ? { ...m, alerts: read.get(m.profileId) } : m)) }));
}

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
        const [read, gifts, adopter] = await Promise.all([
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
        // The housemate alerts, for a signed-in viewer only (as search: the list they open names people).
        // From the households just read — after their conversion, so a first view of an old-format profile
        // already raises them. A failed alerts read costs the alerts (the ratings still answer), never the
        // households.
        let views = read;
        let housemateAlert: HousemateAlertSummary = NO_HOUSEMATE_ALERT;
        if (viewer && read.length > 0) {
            views = await withMemberAlerts(db, read, ctx).catch((e: unknown) => {
                logger.warn('profileHouseholds: housemate alerts read failed, the header and section show none', { ...ctx, error: errMsg(e) });
                return read;
            });
            housemateAlert = housemateAlertSummary(alertLines(views));
        }
        return { views, giftForms, canCreateGift, housemateAlert };
    } catch (e) {
        logger.warn('profileHouseholds: read failed, the profile shows no households', { ...ctx, error: errMsg(e) });
        return EMPTY_PROFILE_HOUSEHOLDS;
    }
}
