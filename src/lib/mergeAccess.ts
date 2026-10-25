/**
 * Access after a fold (spec 2026-10-25-pendientes-d D40). When a rescuer's
 * profile folds into another rescuer's — an immediate merge, an accepted
 * request or the owner's flip — the absorbed profile's owner and their team
 * keep seeing the surviving profile's contact details: an `all_contact` grant
 * with origin 'merge', the same fact an approved access request writes
 * (src/app/actions/piiAccess.ts). A plain server module, NOT 'use server'.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { adopters, piiAccessGrants } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getTeamEmails, normEmail } from '@/lib/orgMembership';
import { realOwner } from '@/domain/dedupPair';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/**
 * Grant the absorbed profile's owner and each teammate access to the survivor.
 * Nobody already on the survivor owner's team (they see it anyway), and no
 * second live `all_contact` grant for the same person. Best-effort: the merge
 * already happened, so a failure is logged and never thrown. Returns how many
 * grants were written (also after a failure part-way).
 */
export async function grantAccessAfterFold(db: Db, input: {
    survivorId: string;
    absorbedOwnerEmail: string | null;
    actor: string;
}): Promise<number> {
    const { survivorId, actor } = input;
    const absorbedOwner = realOwner(input.absorbedOwnerEmail) ? normEmail(input.absorbedOwnerEmail) : null;
    if (!absorbedOwner) return 0;
    let written = 0;
    try {
        const survivor = await db.select({ addedBy: adopters.addedBy }).from(adopters).where(eq(adopters.id, survivorId)).get();
        const survivorOwner = realOwner(survivor?.addedBy) ? normEmail(survivor!.addedBy) : null;
        if (survivorOwner === absorbedOwner) return 0;

        const [absorbedTeam, survivorTeam] = await Promise.all([
            getTeamEmails(absorbedOwner),
            survivorOwner ? getTeamEmails(survivorOwner) : Promise.resolve([] as string[]),
        ]);
        const alreadySees = new Set(survivorTeam.map(normEmail));
        const grantees = [...new Set([absorbedOwner, ...absorbedTeam.map(normEmail)])].filter(e => e && !alreadySees.has(e));

        for (const granteeEmail of grantees) {
            const live = await db.select({ id: piiAccessGrants.id }).from(piiAccessGrants).where(and(
                eq(piiAccessGrants.adopterId, survivorId),
                eq(piiAccessGrants.granteeEmail, granteeEmail),
                eq(piiAccessGrants.scope, 'all_contact'),
                isNull(piiAccessGrants.revokedAt),
            )).get();
            if (live) continue;
            await db.insert(piiAccessGrants).values({
                id: crypto.randomUUID(),
                adopterId: survivorId,
                granteeEmail,
                scope: 'all_contact',
                entryRef: null,
                origin: 'merge',
                requestId: null,
                grantedByEmail: actor,
                createdAt: new Date(),
            });
            written++;
        }
        if (written) logger.info('grantAccessAfterFold: granted', { survivorId, actor, grants: written });
        return written;
    } catch (e) {
        logger.warn('grantAccessAfterFold: access not granted', {
            survivorId, absorbedOwnerEmail: absorbedOwner, actor, grantsWritten: written, error: e instanceof Error ? e.message : String(e),
        });
        return written;
    }
}
