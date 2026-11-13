export const runtime = 'edge';

/**
 * v2.55.15 (animal-timeline PR2): the animal's page. Visible to the owner,
 * their org-mates and admins (via getAnimalProfile), behind the same
 * ENABLE_ANIMALS_FOR_ADOPTION flag as the rest of the surface. Anyone else
 * signed in sees the owned-elsewhere screen (owner name + group, never an
 * email); a missing or deleted animal 404s.
 */

import { redirect, notFound } from 'next/navigation';
import { getAnimalProfile } from '@/app/actions/animalTimeline';
import { getApplicantsForAnimal } from '@/app/actions/applicants';
import { getFeatureFlag } from '@/config/features';
import { logger } from '@/lib/logger';
import AnimalProfile from '@/components/AnimalProfile';
import AnimalOwnedElsewhere from '@/components/AnimalOwnedElsewhere';
import { getAnimalAccess } from '@/lib/animalAccess';

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
    if (!profile) {
        const userEmail = session.user.email;
        const access = await getAnimalAccess(id, userEmail).catch((e) => {
            logger.warn('animal page: getAnimalAccess fallback', {
                animalId: id, userEmail,
                error: e instanceof Error ? e.message : String(e),
            });
            return { kind: 'missing' as const };
        });
        if (access.kind === 'missing') notFound();
        logger.info('animal page: not owner', { animalId: id, userEmail });
        return (
            <AnimalOwnedElsewhere animal={access.animal} owner={access.owner} publicUrl={access.publicUrl} />
        );
    }

    // Applicants only matter while the animal still needs a home. The action
    // gates like getAnimalProfile (owner / org-mate / admin) and lists every
    // applicant from a form link of the OWNER's team — the same scope as the
    // /my-animals «N interesadas» chip. A refusal is an empty list; a failure
    // carries the errorId the action logged, shown where the list would be.
    const applicantsLoad = profile.activePlacement?.recordType === 'adoption'
        ? { ok: true as const, applicants: [] }
        : await getApplicantsForAnimal(id).catch((e) => {
            const errorId = logger.error('animal page: getApplicantsForAnimal threw', e, { animalId: id, userEmail: session.user?.email });
            return { ok: false as const, errorId };
        });
    const applicants = applicantsLoad.ok ? applicantsLoad.applicants : [];
    const applicantsErrorId = applicantsLoad.ok ? null : applicantsLoad.errorId;

    return (
        <div className="min-h-screen bg-stone-50 py-8 px-4">
            <AnimalProfile
                profile={profile}
                applicants={applicants}
                applicantsErrorId={applicantsErrorId}
                userId={session.user.id || ''}
            />
        </div>
    );
}
