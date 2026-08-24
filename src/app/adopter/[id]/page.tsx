export const runtime = 'edge';
import { redirect } from 'next/navigation';
import { getAdopter, getHistory, getAdoptions, getImages, getAllAdopterImages, getFlags, getUser, getAvailableAnimals, getAdopterStats, getAverageRating, getIsAdmin, getIsModeratorOrAdmin, getAdoptionConfig, getDuplicateCandidates, hasPendingDeletionRequest } from '@/app/actions';
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
    let isModeratorOrAdmin = false;
    try {
        [currentUser, isAdmin, isModeratorOrAdmin] = await Promise.all([
            getUser(),
            getIsAdmin(),
            getIsModeratorOrAdmin(),
        ]);
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

    // Batch 1b: Config — kicked off here but NOT awaited until the final wave, so
    // it overlaps the expensive Batch-2 data wave instead of adding its own
    // sequential round-trip (this used to be a standalone `await`, one full D1
    // trip on the critical path). getAdoptionConfig has an internal fallback
    // (returns hardcoded defaults, never throws); the `.catch` is a guard that
    // keeps the page rendering if that contract ever changes.
    const adoptionConfigPromise = getAdoptionConfig().catch((e) => {
        logger.warn('adopter page: config fetch failed, using defaults', {
            adopterId: id,
            userEmail: currentUser,
            error: e instanceof Error ? e.message : String(e),
        });
        return undefined;
    });

    // Batch 2: All data queries in parallel (including availableAnimals to avoid a 3rd sequential await)
    let adopter = null;
    let history: any[] = [];
    let adoptions: any[] = [];
    let images: any[] = [];
    // v2.26.1: all images (profile-level + activity-linked) for the avatar +
    // profile-photo chooser; `images` above stays profile-level for the gallery.
    let allImages: any[] = [];
    let flags: any[] = [];
    let availableAnimals: any[] = [];
    let stats = null;
    let avgRating = null;
    let dupCandidates: any[] = [];
    let piiContext: AdopterPiiContext | null = null;
    let deletionRequested = false;

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
        [adopter, history, adoptions, images, allImages, flags, stats, avgRating, availableAnimals, dupCandidates, piiContext, deletionRequested] = await Promise.all([
            getAdopter(id).catch(fallback('getAdopter', null)),
            getHistory(id).catch(fallback<any[]>('getHistory', [])),
            getAdoptions(id).catch(fallback<any[]>('getAdoptions', [])),
            getImages(id).catch(fallback<any[]>('getImages', [])),
            getAllAdopterImages(id).catch(fallback<any[]>('getAllAdopterImages', [])),
            getFlags(id).catch(fallback<any[]>('getFlags', [])),
            getAdopterStats(id).catch(fallback('getAdopterStats', null)),
            getAverageRating(id).catch(fallback<number | null>('getAverageRating', null)),
            getAvailableAnimals().catch(fallback<any[]>('getAvailableAnimals', [])),
            getDuplicateCandidates(id).catch(fallback<any[]>('getDuplicateCandidates', [])),
            getAdopterPiiContext(id).catch(fallback<AdopterPiiContext | null>('getAdopterPiiContext', null)),
            hasPendingDeletionRequest(id).catch(fallback<boolean>('hasPendingDeletionRequest', false)),
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
    // Final wave — run concurrently instead of serially. Name resolution
    // (depends on history/adoptions/images) and org-mate/attribution (depends on
    // adopter.addedBy) are mutually independent, and config was already resolving
    // in the background; collecting all three here collapses what used to be two
    // extra sequential D1 waves into one.
    //
    // v2.18.11: org-mate awareness — extends audit-log visibility from
    // admin/moderator (v2.18.8) to also include org-mates of the owner. And
    // computes the creator-attribution chip's payload (name + org) for any
    // privileged viewer.
    let isOrgMateOfOwner = false;
    let attribution: { creatorName: string; orgName: string | null; orgSlug: string | null } | null = null;
    const [userNameMap, adoptionConfig] = await Promise.all([
        resolveUserNames(editorEmails),
        adoptionConfigPromise,
        (async () => {
            if (!isNew && adopter?.addedBy) {
                try {
                    const { isOrgMate, pickAttributionOrg } = await import('@/lib/orgMembership');
                    const [mate, org, creatorName] = await Promise.all([
                        isOrgMate(currentUser, adopter.addedBy),
                        pickAttributionOrg(adopter.addedBy, currentUser),
                        (async () => {
                            const map = await resolveUserNames([adopter.addedBy as string]);
                            return map[adopter.addedBy as string] ?? (adopter.addedBy as string).split('@')[0];
                        })(),
                    ]);
                    isOrgMateOfOwner = mate;
                    attribution = {
                        creatorName,
                        orgName: org?.name ?? null,
                        orgSlug: org?.slug ?? null,
                    };
                } catch (e) {
                    logger.warn('adopter page: org-mate/attribution resolution failed', {
                        adopterId: id, viewer: currentUser,
                        error: e instanceof Error ? e.message : String(e),
                    });
                }
            }
        })(),
    ]);
    const canViewAudit = isModeratorOrAdmin || isOrgMateOfOwner;
    // "Removal requested" banner: only the record owner + admins/moderators (the
    // people who act on it) see it — not unrelated viewers.
    const showDeletionRequested = deletionRequested && (isModeratorOrAdmin || (!!currentUser && adopter?.addedBy === currentUser));

    return (
        <AdopterProfileV2
            id={id}
            isNew={isNew}
            adopter={adopter}
            history={history}
            adoptions={adoptions}
            images={images}
            allImages={allImages}
            flags={flags}
            currentUser={currentUser}
            availableAnimals={availableAnimals}
            stats={stats}
            avgRating={avgRating}
            isAdmin={isAdmin}
            canViewAudit={canViewAudit}
            isOrgMateOfOwner={isOrgMateOfOwner}
            attribution={attribution}
            adoptionConfig={adoptionConfig}
            duplicateCandidates={dupCandidates}
            formPrefill={formPrefill}
            userNameMap={userNameMap}
            piiContext={piiContext}
            showDeletionRequested={showDeletionRequested}
        />
    );
}

