'use server';

import { getDb, getUser } from './_db';
import { logger } from '@/lib/logger';
import { getFeatureFlag } from '@/config/features';
import type { HomeModulesData, HomeSection } from '@/types/homeModules';

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

    const [{ loadHomeAdopters, loadHomePosts, loadHomeAnimals }, { getOrgMemberEmails }, { getPendingDuplicatesForUser }, animalsOn, postsOn] = await Promise.all([
        import('@/lib/homeModulesData'),
        import('./organizations'),
        import('./duplicates'),
        getFeatureFlag('ENABLE_ANIMALS_FOR_ADOPTION'),
        getFeatureFlag('ENABLE_CONTENT_IMPORT'),
    ]);
    // /my-adopters' scope, shared by the adopters and posts cards. Started
    // now, with the «Pendientes de revisar» header's own number, so neither
    // waits for the other.
    const members = getOrgMemberEmails();
    // Only the rows whose next move is the viewer's (needsViewer, Jon
    // 2026-11-09), and the first of them, which the amber row names.
    const pendingReview = (async () => {
        const t0 = Date.now();
        try {
            const { needsViewer, pairs } = await getPendingDuplicatesForUser(1, 1, false, undefined, 'needs_viewer');
            const p = pairs[0];
            const first = p && p.group !== 'sent' ? {
                group: p.group,
                names: [p.newAdopter.name, p.existingAdopter.name] as [string, string],
                by: p.request?.counterpartName ?? null,
            } : null;
            return { count: needsViewer, first };
        } finally { timings.pendingReview = Date.now() - t0; }
    })();

    const [adopters, animals, posts] = await Promise.all([
        section('adopters', async () => loadHomeAdopters(db, email, await members, pendingReview)),
        animalsOn ? section('animals', () => loadHomeAnimals(db, email)) : Promise.resolve(null),
        postsOn ? section('posts', async () => loadHomePosts(db, email, await members)) : Promise.resolve(null),
    ]);

    // Per-card time, to keep the homepage honest (each card waits for the slowest read).
    logger.info('getHomeModules timings', { userEmail: email, totalMs: Date.now() - started, ...timings });
    return { adopters, animals, posts };
}
