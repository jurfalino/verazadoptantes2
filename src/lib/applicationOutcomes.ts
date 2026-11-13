/**
 * How a form's application ended, for the «Solicitud» record on the adopter's
 * profile (spec 2026-11-10 «Outcome line»). Names reveal nothing new: the
 * record's own animal comes from the record row the viewer already sees; any
 * other animal (a proposal's, an «also applied» one, or the application's own
 * when the record shows none) is named only inside the viewer's team
 * (`teammateVisibleAnimal`). Server-only.
 */
import { and, eq, ne } from 'drizzle-orm';
import { adoptions, applications } from '@/db/schema';
import { logger } from '@/lib/logger';
import { applicationStatus, type ApplicationStatus } from '@/domain/applications';
import { APPLICATION_ORIGINS, APPLICATION_STATES, RECORD_TYPES, type ApplicationState, type ApplicationCloseReason } from '@/domain/constants';
import { teammateVisibleAnimal } from '@/lib/applicantScope';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

export type OutcomeAnimal = { name: string; sex: string | null };
export type ApplicationOutcome = { status: ApplicationStatus; animal: OutcomeAnimal | null; outcomeAnimal: OutcomeAnimal | null };

export async function attachApplicationOutcomes<T extends { id: string; recordType?: string | null; sourceUrl?: string | null; animalName?: string | null; sex?: string | null }>(
    db: Db, records: T[], ctx: { teamEmails: () => Promise<readonly string[]>; adopterId: string },
): Promise<Array<T & { applicationOutcome?: ApplicationOutcome }>> {
    const requests = records.filter(r => r.recordType === RECORD_TYPES.REQUEST && r.sourceUrl?.startsWith('form:'));
    if (requests.length === 0) return records;

    // Resolved once, and only if a gated animal is needed.
    let team: Promise<readonly string[]> | null = null;
    const animals = new Map<string, Promise<OutcomeAnimal | null>>();
    const teamAnimal = (animalId: string | null): Promise<OutcomeAnimal | null> => {
        if (!animalId) return Promise.resolve(null);
        let hit = animals.get(animalId);
        if (!hit) {
            hit = (async () => {
                const a = await db.select({ id: adoptions.id, name: adoptions.animalName, sex: adoptions.sex, owner: adoptions.addedBy })
                    .from(adoptions).where(eq(adoptions.id, animalId)).get() as { id: string; name: string | null; sex: string | null; owner: string | null } | undefined;
                if (!a) return null;
                team ??= ctx.teamEmails();
                const visible = teammateVisibleAnimal({ id: a.id, name: a.name, owner: a.owner }, await team);
                return visible ? { name: visible.name, sex: a.sex } : null;
            })();
            animals.set(animalId, hit);
        }
        return hit;
    };

    const found = await Promise.all(requests.map(async (r): Promise<[string, ApplicationOutcome] | null> => {
        try {
            const submissionId = r.sourceUrl!.slice('form:'.length);
            // The form's own application (a proposal shares the submission but is another row).
            const row = await db.select().from(applications)
                .where(and(eq(applications.submissionId, submissionId), ne(applications.origin, APPLICATION_ORIGINS.PROPOSED)))
                .get() as { animalId: string | null; state: string; closeReason: string | null; closedAt: number | null; proposedApplicationId: string | null; replacedByApplicationId: string | null } | undefined;
            if (!row) return null;
            const status = applicationStatus(
                { state: row.state as ApplicationState, closeReason: row.closeReason as ApplicationCloseReason | null, closedAt: row.closedAt },
                [], 0,
            );
            // Open means still being evaluated: nothing to say about an ending.
            if (status.kind === 'to_evaluate' || status.kind === 'contract_sent') return null;
            const ledTo = row.state === APPLICATION_STATES.PROPOSED ? row.proposedApplicationId
                : row.state === APPLICATION_STATES.ALSO_APPLIED ? row.replacedByApplicationId : null;
            const target = ledTo ? await db.select({ animalId: applications.animalId }).from(applications).where(eq(applications.id, ledTo)).get() as { animalId: string | null } | undefined : undefined;
            // The record's own animal is on the record the viewer already sees; only when it shows none is the application's animal gated.
            const ownName = r.animalName?.trim();
            const needsAnimal = status.kind === 'closed' || status.kind === 'adopted';
            const animal = ownName ? { name: ownName, sex: r.sex ?? null } : needsAnimal ? await teamAnimal(row.animalId) : null;
            const outcomeAnimal = await teamAnimal(target?.animalId ?? null);
            return [r.id, { status, animal, outcomeAnimal }];
        } catch (e) {
            logger.warn('applicationOutcomes: D1 fallback hit', { adopterId: ctx.adopterId, recordId: r.id, error: e instanceof Error ? e.message : String(e) });
            return null;
        }
    }));
    const byRecord = new Map(found.filter((x): x is [string, ApplicationOutcome] => !!x));
    return records.map(r => byRecord.has(r.id) ? { ...r, applicationOutcome: byRecord.get(r.id) } : r);
}
