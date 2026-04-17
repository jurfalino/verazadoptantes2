export const runtime = 'edge';
import { redirect } from 'next/navigation';
import { getAdopter, getHistory, getAdoptions, getImages, getFlags, getUser, getAvailableAnimals, getAdopterStats, getAverageRating, getIsAdmin, getAdoptionConfig, getDuplicateCandidates } from '@/app/actions';
import { getFormSubmissionPrefill } from '@/app/actions/formSubmission';
import { AdopterProfile } from '@/components/AdopterProfile';

export default async function AdopterPage({
    params,
    searchParams,
}: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ fromForm?: string }>;
}) {
    const { id } = await params;
    const { fromForm } = await searchParams;
    const isNew = id === 'create';

    // Batch 1: Auth + config (lightweight, no DB-heavy queries)
    let currentUser = '';
    let isAdmin = false;
    let adoptionConfig: any = null;
    try {
        [currentUser, isAdmin, adoptionConfig] = await Promise.all([getUser(), getIsAdmin(), getAdoptionConfig()]);
    } catch (e: any) {
        if (e?.digest?.startsWith('NEXT_REDIRECT')) throw e;
        redirect(`/?authRequired=1&callbackUrl=${encodeURIComponent(`/adopter/${id}`)}`);
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

    if (!isNew) {
        [adopter, history, adoptions, images, flags, stats, avgRating, availableAnimals, dupCandidates] = await Promise.all([
            getAdopter(id),
            getHistory(id),
            getAdoptions(id),
            getImages(id),
            getFlags(id),
            getAdopterStats(id),
            getAverageRating(id),
            getAvailableAnimals(),
            getDuplicateCandidates(id)
        ]);
    } else {
        availableAnimals = await getAvailableAnimals();
    }

    let formPrefill = null;
    if (isNew && fromForm?.trim()) {
        formPrefill = await getFormSubmissionPrefill(fromForm.trim());
    }

    return (
        <AdopterProfile
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
        />
    );
}

