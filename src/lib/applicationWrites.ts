/**
 * Writes to `applications`. A plain server module, NOT `'use server'`.
 */

import { adopterHistory, applications, formSubmissions } from '@/db/schema';
import { planAdoptionClose, submissionApplication, type AdoptionVia } from '@/domain/applications';
import { APPLICATION_AUTO_ACTOR, APPLICATION_ORIGINS, APPLICATION_STATES } from '@/domain/constants';
import { applicantScopeWhere, normalizeTeamScope } from '@/lib/applicantScope';
import { logger } from '@/lib/logger';
import { getTeamEmails } from '@/lib/orgMembership';
import { and, eq, sql } from 'drizzle-orm';
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

/**
 * Repairs forms of `teamEmails`' links that have no application row — a failed
 * insert at submit, or a form submitted to the old build between the CI
 * migration and the deploy. ONE idempotent INSERT … SELECT, same semantics as
 * `submissionApplication`: an animal with an active adoption → a general
 * «adopted_animal» application remembering the ask; otherwise the animal is kept.
 * Never throws; returns the rows inserted (0 on an empty team or a failure).
 */
export async function healMissingApplications(
    db: Db,
    teamEmails: readonly string[],
    /** An animal whose adoption is being written right now: its placement is already open, but a form filed BEFORE it was a candidate, not a «general» one. */
    justAdoptedAnimalId: string | null = null,
): Promise<number> {
    const team = normalizeTeamScope(teamEmails);
    if (team.length === 0) return 0;
    try {
        const inTeam = sql.join(team.map(e => sql`lower(fs.user_id) = ${e}`), sql` or `);
        const res = await db.run(sql`
            INSERT OR IGNORE INTO applications (id, submission_id, animal_id, origin, asked_animal_id, state, created_at)
            SELECT 'app-' || fs.id, fs.id,
                CASE WHEN p.id IS NULL THEN fs.selected_animal_id ELSE NULL END,
                CASE WHEN p.id IS NULL THEN ${APPLICATION_ORIGINS.FORM} ELSE ${APPLICATION_ORIGINS.ADOPTED_ANIMAL} END,
                CASE WHEN p.id IS NULL THEN NULL ELSE fs.selected_animal_id END,
                ${APPLICATION_STATES.OPEN}, fs.created_at
            FROM form_submissions fs
            LEFT JOIN placements p ON p.animal_id = fs.selected_animal_id AND p.ended_at IS NULL AND p.record_type = 'adoption'
                AND p.animal_id IS NOT ${justAdoptedAnimalId}
            WHERE (${inTeam})
              AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.submission_id = fs.id)
            GROUP BY fs.id`) as { changes?: number; meta?: { changes?: number } };
        return res?.changes ?? res?.meta?.changes ?? 0;
    } catch (e) {
        logger.warn('healMissingApplications: D1 fallback hit', { teamSize: team.length, error: e instanceof Error ? e.message : String(e) });
        return 0;
    }
}

/**
 * An adoption landed: close every OTHER open application of the animal within
 * the owner's team, and mark the adopter's own as adopted. A history row lands
 * on each closed candidate's profile (by the automatic actor, as a
 * contribution — it is neither a record nor a rating). Forms with no
 * application row are healed first so they close too.
 *
 * Never throws: the adoption has already landed, so a failure here is logged
 * and answered with 0. Returns how many OTHER candidates were closed.
 */
export async function closeApplicationsOnAdoption(db: Db, input: {
    animalId: string;
    ownerEmail: string | null;
    animalName: string | null;
    animalSex: string | null;
    adopterId: string;
    via: AdoptionVia;
    nowSec: number;
}): Promise<number> {
    const { animalId, adopterId, via, nowSec } = input;
    try {
        const team = await getTeamEmails(input.ownerEmail);
        const where = applicantScopeWhere(animalId, team);
        if (!where) return 0;
        await healMissingApplications(db, team, animalId);
        const open = await db
            .select({ id: applications.id, adopterId: formSubmissions.linkedAdopterId })
            .from(applications)
            .innerJoin(formSubmissions, eq(formSubmissions.id, applications.submissionId))
            .where(and(where, eq(applications.state, APPLICATION_STATES.OPEN)));
        const byId = new Map(open.map((r: { id: string; adopterId: string | null }) => [r.id, r.adopterId] as const));
        let closed = 0;
        for (const step of planAdoptionClose(open, adopterId, via)) {
            const won = await db.update(applications)
                .set({
                    state: step.state,
                    closeReason: step.closeReason,
                    closedAt: nowSec,
                    closedBy: APPLICATION_AUTO_ACTOR,
                    ...(via === 'open_link' ? { offerDoneAt: nowSec } : {}),
                })
                .where(and(eq(applications.id, step.id), eq(applications.state, APPLICATION_STATES.OPEN)))
                .returning({ id: applications.id });
            if (!won.length || step.state !== APPLICATION_STATES.CLOSED) continue;
            closed++;
            const candidate = byId.get(step.id);
            if (!candidate) continue;
            await db.insert(adopterHistory).values({
                id: crypto.randomUUID(),
                adopterId: candidate,
                changedBy: APPLICATION_AUTO_ACTOR,
                kind: 'contribution',
                changes: JSON.stringify({ application_closed: {
                    animalId, animalName: input.animalName, animalSex: input.animalSex, reason: step.closeReason,
                } }),
                changedAt: new Date(nowSec * 1000),
            });
        }
        return closed;
    } catch (e) {
        logger.error('closeApplicationsOnAdoption failed', e, { animalId, adopterId, via });
        return 0;
    }
}
