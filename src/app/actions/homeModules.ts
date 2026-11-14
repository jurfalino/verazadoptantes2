'use server';

import { getDb, getUser } from './_db';
import { logger } from '@/lib/logger';
import { HOME_CARD_SLOTS } from '@/domain/homeModules';
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
    // 2026-11-09), and the first of them — one card row each, like the due
    // animals (option b).
    // General forms to evaluate (Jon 2026-11-13): «Mis adoptantes» rows, before the «¿Es la misma persona?» ones.
    // A failure leaves the card without them (logged), never without the card.
    const generalRequests = (async () => {
        try {
            const [{ getTeamEmails }, { countGeneralToEvaluate, listGeneralToEvaluate }] = await Promise.all([
                import('@/lib/orgMembership'), import('@/lib/applicationCounts'),
            ]);
            const team = await getTeamEmails(email);
            const [count, items] = await Promise.all([
                countGeneralToEvaluate(db, team, { heal: false }),
                listGeneralToEvaluate(db, team, HOME_CARD_SLOTS, { heal: false }),
            ]);
            // Only what the row shows (and the person, so their recent row isn't listed twice).
            return { count, items: items.map(r => ({ applicationId: r.applicationId, adopterId: r.adopterId, name: r.name, askedAnimal: r.askedAnimal })) };
        } catch (e) {
            logger.warn('getHomeModules: general requests fallback', { email, error: e instanceof Error ? e.message : String(e) });
            return { count: 0, items: [] };
        }
    })();
    const pendingReview = (async () => {
        const t0 = Date.now();
        try {
            const { needsViewer, pairs, phaseMs } = await getPendingDuplicatesForUser(1, HOME_CARD_SLOTS, false, undefined, 'needs_viewer');
            if (phaseMs) { timings.pendingCount = phaseMs.count; timings.pendingRows = phaseMs.rows; }
            const items = pairs.flatMap(p => p.group === 'sent' ? [] : [{
                group: p.group,
                names: [p.newAdopter.name, p.existingAdopter.name] as [string, string],
                ids: [p.newAdopter.id, p.existingAdopter.id] as [string, string],
                by: p.request?.counterpartName ?? null,
                summary: { same: [...p.summary.same], diff: [...p.summary.diff], flagged: p.summary.flagged },
            }]);
            return { count: needsViewer, items };
        } finally { timings.pendingReview = Date.now() - t0; }
    })();

    const [adopters, animals, posts] = await Promise.all([
        section('adopters', async () => loadHomeAdopters(db, email, await members, pendingReview, generalRequests)),
        animalsOn ? section('animals', () => loadHomeAnimals(db, email)) : Promise.resolve(null),
        postsOn ? section('posts', async () => loadHomePosts(db, email, await members)) : Promise.resolve(null),
    ]);

    // Per-card time, to keep the homepage honest (each card waits for the slowest read). The split
    // and the Cloudflare location that ran it ride in `note` as JSON: the Axiom dataset is at its
    // field cap and silently drops NEW keys (EM review 2026-11-10 — animals/posts/pendingReview
    // never arrived). `colo` shows where the code ran: next to D1 (placement) or next to the user.
    let colo: string | null = null;
    try {
        const { getRequestContext } = await import('@/lib/requestContext');
        colo = (getRequestContext().cf as { colo?: string } | undefined)?.colo ?? null;
    } catch { colo = null; /* no request context (local dev without the Cloudflare shim): no colo */ }
    logger.info('getHomeModules timings', {
        userEmail: email, totalMs: Date.now() - started, ...timings,
        note: JSON.stringify({ ...timings, colo }),
    });
    return { adopters, animals, posts };
}
