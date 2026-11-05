'use server';

import { getDb, getUser } from './_db';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { getFeatureFlag } from '@/config/features';
import type { HomeModulesData, HomeSection } from '@/types/homeModules';
import type { HomePrefs } from '@/domain/homePrefs';

/**
 * Everything the signed-in homepage modules show (Mis adoptantes, Mis
 * animales, Posts de redes) in one call, fetched after hydration. Each card
 * loads on its own: one failing read never blanks the others, and its
 * errorId reaches the card. null = no session.
 */
export async function getHomeModules(): Promise<HomeModulesData | null> {
    let userEmail: string | undefined;
    try {
        userEmail = await getUser();
    } catch {
        return null; // signed out — the homepage keeps its guest cards
    }
    const db = await getDb();
    const email = userEmail;
    const started = Date.now();
    const timings: Record<string, number> = {};
    const section = async <T>(op: string, load: () => Promise<T>): Promise<HomeSection<T>> => {
        const t0 = Date.now();
        try {
            return { ok: true, data: await load() };
        } catch (error) {
            return { ok: false, errorId: logger.error(`getHomeModules: ${op} failed`, error, { userEmail: email }) };
        } finally {
            timings[op] = Date.now() - t0;
        }
    };

    const [{ loadHomeAdopters, loadHomePosts, loadHomeAnimals }, { getOrgMemberEmails }, { getPendingDuplicatesForUser }, { getHomePrefsForEmail }, animalsOn, postsOn] = await Promise.all([
        import('@/lib/homeModulesData'),
        import('./organizations'),
        import('./duplicates'),
        import('@/lib/homePrefs'),
        getFeatureFlag('ENABLE_ANIMALS_FOR_ADOPTION'),
        getFeatureFlag('ENABLE_CONTENT_IMPORT'),
    ]);
    // /my-adopters' scope, shared by the adopters and posts cards. Started
    // now, with the «Pendientes de revisar» header's own number, so neither
    // waits for the other.
    const members = getOrgMemberEmails();
    const pendingReview = (async () => {
        const t0 = Date.now();
        try { return (await getPendingDuplicatesForUser(1, 1, false)).total; } finally { timings.pendingReview = Date.now() - t0; }
    })();

    const [adopters, animals, posts, prefs] = await Promise.all([
        section('adopters', async () => loadHomeAdopters(db, email, await members, pendingReview)),
        animalsOn ? section('animals', () => loadHomeAnimals(db, email)) : Promise.resolve(null),
        postsOn ? section('posts', async () => loadHomePosts(db, email, await members)) : Promise.resolve(null),
        getHomePrefsForEmail(db, email).catch((e: unknown) => {
            logger.warn('getHomeModules: home prefs fallback, nothing hidden', { userEmail: email, error: e instanceof Error ? e.message : String(e) });
            return {} as HomePrefs;
        }),
    ]);

    // Per-card time, to keep the homepage honest (each card waits for the slowest read).
    logger.info('getHomeModules timings', { userEmail: email, totalMs: Date.now() - started, ...timings });
    return { adopters, animals, posts, firstStepsHidden: prefs.firstStepsHidden === true };
}

/** «Ocultar» on «Para empezar» / «También podés» — for this account, on every device. */
export async function hideHomeFirstSteps(): Promise<{ success: boolean; errorId?: string }> {
    let userEmail: string | undefined;
    try {
        userEmail = await getUser();
        const { setHomePrefsForEmail } = await import('@/lib/homePrefs');
        await setHomePrefsForEmail(await getDb(), userEmail, { firstStepsHidden: true });
        logAudit({ userEmail, action: 'home_first_steps_hidden', details: {} });
        return { success: true };
    } catch (error) {
        const errorId = logger.error('hideHomeFirstSteps failed', error, { userEmail });
        return { success: false, errorId };
    }
}
