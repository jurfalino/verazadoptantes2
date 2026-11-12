/**
 * The server side of the «¿Es la misma persona?» lock (src/domain/samePersonGate.ts):
 * how many possible duplicates the viewer still has to answer before giving an
 * animal through ONE application's form. Decided per form, exactly as the panel
 * decides (formResultsView canLinkMatches): only when THAT form created the
 * profile and still sits on it ('new_profile'). A form linked to an existing
 * profile (after «Sí», or by hand) never locks, even if another form created
 * that profile — its cards are read-only there, so nothing could unlock it.
 * Reads the SAME pairs the panel shows (loadOpenPairs, limit 20, no weak pairs).
 *
 * Not a 'use server' module. Throws on a D1 error: callers refuse and log.
 */
import { and, eq } from 'drizzle-orm';
import { applications, formSubmissions } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { loadOpenPairs } from '@/lib/openPairs';
import { blockingPairCount } from '@/domain/samePersonGate';
import { APPLICATION_STATES } from '@/domain/constants';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export async function blockingPairsOn(db: Db, adopterId: string, viewer: string): Promise<number> {
    const pairs = await loadOpenPairs(db, adopterId, viewer, { limit: 20 });
    return blockingPairCount(pairs.map(p => ({ viewerMayAnswer: p.onViewerList, unsureBy: p.unsureBy ?? null })), true);
}

/** «Proponer un animal» on this form's application. */
export async function unansweredForSubmission(db: Db, submission: { linkedAdopterId: string | null; autoAdopterId: string | null }, viewer: string): Promise<number> {
    const id = submission.linkedAdopterId;
    if (!id || id !== submission.autoAdopterId) return 0;
    return blockingPairsOn(db, id, viewer);
}

/**
 * «Enviar / Reenviar contrato» for `animalId` to `adopterId`: locked only while an OPEN application for this
 * animal comes from a form that created this profile and still sits on it — the panel the contract is sent
 * from. A contract to anyone else (a profile with no such application) is never locked.
 */
export async function unansweredForContract(db: Db, animalId: string, adopterId: string, viewer: string): Promise<number> {
    const app = await db.select({ id: applications.id }).from(applications)
        .innerJoin(formSubmissions, eq(formSubmissions.id, applications.submissionId))
        .where(and(
            eq(applications.animalId, animalId),
            eq(applications.state, APPLICATION_STATES.OPEN),
            eq(formSubmissions.linkedAdopterId, adopterId),
            eq(formSubmissions.autoAdopterId, adopterId),
        ))
        .limit(1).get();
    if (!app) return 0;
    return blockingPairsOn(db, adopterId, viewer);
}
