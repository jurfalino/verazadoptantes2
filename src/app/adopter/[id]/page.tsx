// export const runtime = 'edge';
import { getAdopter, getHistory, getAdoptions, getImages, getFlags, getUser, getAvailableAnimals, getAdopterStats, getAverageRating, getIsAdmin, getAdoptionConfig } from '@/app/actions';
import { AdopterProfile } from '@/components/AdopterProfile';

export default async function AdopterPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const isNew = id === 'create';

    let adopter = null;
    let history: any[] = [];
    let adoptions: any[] = [];
    let images: any[] = [];
    let flags: any[] = [];
    let availableAnimals: any[] = [];
    let stats = null;
    let avgRating = null;
    const [currentUser, isAdmin, adoptionConfig] = await Promise.all([getUser(), getIsAdmin(), getAdoptionConfig()]);

    if (!isNew) {
        [adopter, history, adoptions, images, flags, stats, avgRating] = await Promise.all([
            getAdopter(id),
            getHistory(id),
            getAdoptions(id),
            getImages(id),
            getFlags(id),
            getAdopterStats(id),
            getAverageRating(id)
        ]);
    }

    // Fetch available animals for authenticated users
    availableAnimals = await getAvailableAnimals();

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
        />
    );
}

