export const runtime = 'edge';

/**
 * v2.55.15 (animal-timeline PR2): the animal's page. Owner-gated exactly like
 * /api/my-animals (addedBy === session email, no admin bypass) and behind the
 * same ENABLE_ANIMALS_FOR_ADOPTION flag as the rest of the surface.
 */

import { redirect, notFound } from 'next/navigation';
import { getAnimalProfile } from '@/app/actions/animalTimeline';
import { getApplicantsForAnimal } from '@/app/actions/applicants';
import { getFeatureFlag } from '@/config/features';
import { logger } from '@/lib/logger';
import AnimalProfile from '@/components/AnimalProfile';

export default async function AnimalPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    const enabled = await getFeatureFlag('ENABLE_ANIMALS_FOR_ADOPTION').catch(() => false);
    if (!enabled) notFound();

    const { auth } = await import('@/auth');
    const session = await auth();
    if (!session?.user?.email) {
        redirect(`/?authRequired=1&callbackUrl=${encodeURIComponent(`/my-animals/${id}`)}`);
    }

    const profile = await getAnimalProfile(id).catch((e) => {
        logger.warn('animal page: getAnimalProfile fallback', {
            animalId: id, userEmail: session.user?.email,
            error: e instanceof Error ? e.message : String(e),
        });
        return null;
    });
    if (!profile) notFound();

    // Applicants only matter while the animal still needs a home; the action is
    // already strictly owner-scoped and fail-closed (returns []).
    const applicants = profile.activePlacement?.recordType === 'adoption'
        ? []
        : await getApplicantsForAnimal(id).catch((e) => {
            logger.warn('animal page: getApplicantsForAnimal fallback', {
                animalId: id, userEmail: session.user?.email,
                error: e instanceof Error ? e.message : String(e),
            });
            return [];
        });

    return (
        <div className="min-h-screen bg-stone-50 py-8 px-4">
            <AnimalProfile
                profile={profile}
                applicants={applicants}
                userId={session.user.id || ''}
                currentUser={session.user.email}
            />
        </div>
    );
}
