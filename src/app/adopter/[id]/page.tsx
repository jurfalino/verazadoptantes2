export const runtime = 'edge';
import { redirect } from 'next/navigation';
import { getAdopter, getHistory, getAdoptions, getImages, getFlags, getUser, getAvailableAnimals, getAdopterStats, getAverageRating, getIsAdmin, getAdoptionConfig, getDuplicateCandidates } from '@/app/actions';
import { resolveUserNames } from '@/app/actions/userNames';
import { getFormSubmissionPrefill } from '@/app/actions/formSubmission';
import { getAdopterPiiContext } from '@/app/actions/piiAccess';
import { replaySearchMatchGrants } from '@/lib/piiAccessServer';
import { logger } from '@/lib/logger';
import { AdopterProfileV2 } from '@/components/AdopterProfileV2';
import type { AdopterPiiContext } from '@/lib/piiAccess';

export default async function AdopterPage({
    params,
    searchParams,
}: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ fromForm?: string; q?: string }>;
}) {
    const { id } = await params;
    const { fromForm, q } = await searchParams;
    const isNew = id === 'create';

    // Batch 1a: Auth (mandatory — failure means redirect to login)
    let currentUser = '';
    let isAdmin = false;
    try {
        [currentUser, isAdmin] = await Promise.all([getUser(), getIsAdmin()]);
    } catch (e: any) {
        if (e?.digest?.startsWith('NEXT_REDIRECT')) throw e;
        redirect(`/?authRequired=1&callbackUrl=${encodeURIComponent(`/adopter/${id}`)}`);
    }

    // Batch 1a.5: Post-signin search-match replay. When a user arrives from
    // an unauth search (clicked a result, signed in, was redirected back here
    // with `?q=` preserved), the unauthenticated search couldn't persist
    // grants — re-run the matchers now with their email so the unmasked
    // reveal they saw in the result card survives the auth boundary.
    // Idempotent + quiet-failure (see piiAccessServer.replaySearchMatchGrants).
    if (!isNew && q && currentUser) {
        await replaySearchMatchGrants({ adopterId: id, query: q, viewerEmail: currentUser });
    }

    // Batch 1b: Config (degrade-on-failure — page renders with defaults if these throw,
    // since a config-fetch error is not an auth error and should not bounce the user).
    let adoptionConfig: any = null;
    try {
        adoptionConfig = await getAdoptionConfig();
    } catch (e) {
        if ((e as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw e;
        logger.warn('adopter page: config fetch failed, using defaults', {
            adopterId: id,
            userEmail: currentUser,
            error: e instanceof Error ? e.message : String(e),
        });
    }

    // Batch 2: All data queries in parallel (including availableAnimals to avoid a 3rd sequential await)
    let adopter = null;
    let history: any[] = [];
    let adoptions: any[] = [];
    let images: any[] = [];
    let flags: any[] = [];
    let availableAnimals: any[] = [];
    let stats = null;
    let avgRating = null;
    let dupCandidates: any[] = [];
    let piiContext: AdopterPiiContext | null = null;

    if (!isNew) {
        // Per-fetch fallback: if any single query throws (e.g. transient D1 outage), the page
        // degrades that section instead of crashing the whole SSR. The Server Components render
        // error we used to surface (digest 3138068963 etc.) was the result of an unwrapped
        // Promise.all — one D1 hiccup → blank page → no log of the underlying cause. We log at
        // warn (degraded, not broken) and let the surrounding components handle the empty state.
        const fallback = <T,>(op: string, def: T) => (e: unknown): T => {
            logger.warn('adopter page: fetch fallback', {
                op, adopterId: id, userEmail: currentUser,
                error: e instanceof Error ? e.message : String(e),
            });
            return def;
        };
        [adopter, history, adoptions, images, flags, stats, avgRating, availableAnimals, dupCandidates, piiContext] = await Promise.all([
            getAdopter(id).catch(fallback('getAdopter', null)),
            getHistory(id).catch(fallback<any[]>('getHistory', [])),
            getAdoptions(id).catch(fallback<any[]>('getAdoptions', [])),
            getImages(id).catch(fallback<any[]>('getImages', [])),
            getFlags(id).catch(fallback<any[]>('getFlags', [])),
            getAdopterStats(id).catch(fallback('getAdopterStats', null)),
            getAverageRating(id).catch(fallback<number | null>('getAverageRating', null)),
            getAvailableAnimals().catch(fallback<any[]>('getAvailableAnimals', [])),
            getDuplicateCandidates(id).catch(fallback<any[]>('getDuplicateCandidates', [])),
            getAdopterPiiContext(id).catch(fallback<AdopterPiiContext | null>('getAdopterPiiContext', null)),
        ]);
    } else {
        availableAnimals = await getAvailableAnimals().catch(e => {
            logger.warn('adopter page: getAvailableAnimals fallback (new flow)', {
                userEmail: currentUser,
                error: e instanceof Error ? e.message : String(e),
            });
            return [];
        });
    }

    let formPrefill = null;
    if (isNew && fromForm?.trim()) {
        formPrefill = await getFormSubmissionPrefill(fromForm.trim());
    }

    // Build userNameMap: collect all editor emails then resolve to display names in one batch
    const editorEmails: string[] = [];
    for (const h of history) { if (h.changedBy) editorEmails.push(h.changedBy); }
    for (const a of adoptions) { if (a.addedBy) editorEmails.push(a.addedBy); }
    for (const img of images) { if (img.addedBy) editorEmails.push(img.addedBy); }
    const userNameMap = await resolveUserNames(editorEmails);

    return (
        <AdopterProfileV2
            id={id}
            isNew={isNew}
            adopter={adopter}
            history={history}
            adoptions={adoptions}
            images={images}
            flags={flags}
            currentUser={currentUser}
            availableAnimals={availableAnimals}
            stats={stats}
            avgRating={avgRating}
            isAdmin={isAdmin}
            adoptionConfig={adoptionConfig}
            duplicateCandidates={dupCandidates}
            formPrefill={formPrefill}
            userNameMap={userNameMap}
            piiContext={piiContext}
        />
    );
}

