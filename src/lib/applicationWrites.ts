/**
 * Writes to `applications`. A plain server module, NOT `'use server'`.
 */

import { applications } from '@/db/schema';
import { submissionApplication } from '@/domain/applications';
import { APPLICATION_ORIGINS, APPLICATION_STATES } from '@/domain/constants';
import { normalizeTeamScope } from '@/lib/applicantScope';
import { logger } from '@/lib/logger';
import { sql } from 'drizzle-orm';
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
export async function healMissingApplications(db: Db, teamEmails: readonly string[]): Promise<number> {
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
            WHERE (${inTeam})
              AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.submission_id = fs.id)
            GROUP BY fs.id`) as { changes?: number; meta?: { changes?: number } };
        return res?.changes ?? res?.meta?.changes ?? 0;
    } catch (e) {
        logger.warn('healMissingApplications: D1 fallback hit', { teamSize: team.length, error: e instanceof Error ? e.message : String(e) });
        return 0;
    }
}
