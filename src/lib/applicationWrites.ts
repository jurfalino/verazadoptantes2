/**
 * Writes to `applications`. A plain server module, NOT `'use server'`.
 */

import { applications } from '@/db/schema';
import { submissionApplication } from '@/domain/applications';
import { APPLICATION_STATES } from '@/domain/constants';
import type { getDb } from '@/lib/db';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/**
 * The application a submitted form makes: id `app-<submissionId>` (the same id
 * the 0106 backfill gives older forms). An adopted animal turns into a general
 * application remembering the ask. INSERT OR IGNORE: a second call is a no-op.
 */
export async function createApplicationForSubmission(
    db: Db,
    input: {
        submissionId: string;
        selectedAnimalId: string | null;
        /** null = no such animal; undefined = the lookup failed. */
        animal: { recordType: string | null; adopterId: string | null } | null | undefined;
        createdAt: Date;
    },
): Promise<string> {
    const id = `app-${input.submissionId}`;
    const { animalId, origin, askedAnimalId } = submissionApplication(input.selectedAnimalId, input.animal);
    await db.insert(applications).values({
        id,
        submissionId: input.submissionId,
        animalId,
        origin,
        askedAnimalId,
        state: APPLICATION_STATES.OPEN,
        createdAt: input.createdAt,
    }).onConflictDoNothing();
    return id;
}
