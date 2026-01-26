export const runtime = "edge";
import { getAdopter, getHistory, getAdoptions, getImages, getFlags, getUser } from '@/app/actions';
import { AdopterProfile } from '@/components/AdopterProfile';

export default async function AdopterPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const isNew = id === 'create';

    let adopter = null;
    let history: any[] = [];
    let adoptions: any[] = [];
    let images: any[] = [];
    let flags: any[] = [];
    const currentUser = await getUser();

    if (!isNew) {
        adopter = await getAdopter(id);
        history = await getHistory(id);
        adoptions = await getAdoptions(id);
        images = await getImages(id);
        flags = await getFlags(id);
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
        />
    );
}
