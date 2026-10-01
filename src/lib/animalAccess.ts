/**
 * Why /my-animals/[id] can't show an animal, once getAnimalProfile returned
 * null: it doesn't exist (→ 404) or it belongs to someone else (→ the "en
 * buenas manos" screen). Server-only, NOT a server action. Owner identity
 * comes only from buildPublicRescuer (never the email).
 */
import { eq } from 'drizzle-orm';
import { animals, adoptions } from '@/db/schema';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { isOwnerOrOrgMate } from '@/lib/orgMembership';
import { isAdminAsync } from '@/config/admins';
import { buildPublicRescuer, fetchAnimalImages } from '@/lib/showcase';
import { getContractBaseUrl } from '@/lib/contractUrl';
import { decideAnimalAccess, isPubliclyListed } from '@/domain/animalAccess';

export type OwnedElsewhere = {
    kind: 'not_yours';
    animal: { name: string | null; species: string | null };
    owner: { displayName: string; orgName?: string } | null;
    publicUrl: string | null;
};
export type AnimalAccess = { kind: 'missing' } | OwnedElsewhere;

export async function getAnimalAccess(animalId: string, viewerEmail: string): Promise<AnimalAccess> {
    const db = await getDb();
    if (!db) return { kind: 'missing' };

    const row = await db.select().from(animals).where(eq(animals.id, animalId)).get();
    const viewerCanSee = !!row && (
        (await isOwnerOrOrgMate(viewerEmail, row.addedBy)) || (await isAdminAsync(viewerEmail))
    );
    const kind = decideAnimalAccess({ exists: !!row, deleted: !!row?.deletedAt, viewerCanSee });

    if (kind === 'allowed') {
        // getAnimalProfile said no but the viewer may see it: a transient failure
        // there, not a policy. 404 rather than a wrong "belongs to someone else".
        logger.warn('getAnimalAccess: profile null but viewer allowed', { animalId, userEmail: viewerEmail });
        return { kind: 'missing' };
    }
    if (kind === 'missing' || !row) return { kind: 'missing' };

    const [owner, publicUrl] = await Promise.all([
        buildPublicRescuer(db, row.addedBy)
            .then(r => ({ displayName: r.displayName, orgName: r.orgName }))
            .catch((e: unknown) => {
                logger.warn('getAnimalAccess: owner lookup fallback', { animalId, userEmail: viewerEmail, error: e instanceof Error ? e.message : String(e) });
                return null;
            }),
        (async () => {
            const listing = await db.select({ recordType: adoptions.recordType, adopterId: adoptions.adopterId })
                .from(adoptions).where(eq(adoptions.id, animalId)).get();
            const photos = (await fetchAnimalImages(db, [animalId])).get(animalId) ?? [];
            if (!isPubliclyListed(listing, photos.length)) return null;
            return `${await getContractBaseUrl()}/animal/${encodeURIComponent(animalId)}`;
        })().catch((e: unknown) => {
            logger.warn('getAnimalAccess: listing lookup fallback', { animalId, userEmail: viewerEmail, error: e instanceof Error ? e.message : String(e) });
            return null;
        }),
    ]);

    return { kind: 'not_yours', animal: { name: row.name, species: row.species }, owner, publicUrl };
}
