/**
 * Counts of applications — «N por evaluar» / «N candidatos» on the home rows and
 * the Mis animales tab. Each is ONE grouped query (the live-contract check is a
 * LEFT JOIN, never a per-application read) and equals what the animal page's
 * list shows: same scope (applicantScope), same to-do rule (`isToDo`: open, on
 * a profile, no live link).
 *
 * Not a `'use server'` module: callers authorize and pass the team in.
 */

import { and, count, eq, isNotNull, isNull, or, gt, sql } from 'drizzle-orm';
import { animals, applications, formSubmissions, contractInvitations } from '@/db/schema';
import { APPLICATION_STATES, APPLICATION_CLOSE_REASONS, RECORD_TYPES } from '@/domain/constants';
import { generalScopeWhere, teamApplicationsWhere } from '@/lib/applicantScope';
import { healMissingApplications } from '@/lib/applicationWrites';
import { normalizeTeamScope } from '@/lib/applicantScope';
import { perRequest } from '@/lib/requestMemo';

/* eslint-disable @typescript-eslint/no-explicit-any -- the D1/better-sqlite db union is untyped here, as in the callers */
type Db = any;

/**
 * Heals the team's missing application rows at most once per request (src/lib/requestMemo.ts): the
 * home and /my-adopters ask several counts of the same team in one load, and each heal is a write.
 */
function healOnce(db: Db, team: readonly string[]): Promise<number> {
    const key = normalizeTeamScope(team).slice().sort().join(',');
    return perRequest(`healApplications:${key}`, () => healMissingApplications(db, team));
}

/**
 * `heal: false` — the homepage: it reads without the heal WRITE on its path and schedules
 * `healMissingApplications` after the response instead (loadHomeAnimals), so the next load counts
 * any healed row. Every other caller heals first (once per team per request).
 */
export type CountOpts = { heal?: boolean };

/** The animal row of an application, for the owner rule in `teamApplicationsWhere`. */
const animalOf = eq(animals.id, applications.animalId);

/** The invitation join: a LIVE link (unused, unexpired; expires_at NULL counts as live — `isLiveInvitation`) of this animal + person. */
const liveLink = (nowSec: number) => and(
    eq(contractInvitations.animalId, applications.animalId),
    eq(contractInvitations.adopterId, formSubmissions.linkedAdopterId),
    isNull(contractInvitations.usedAt),
    or(isNull(contractInvitations.expiresAt), gt(contractInvitations.expiresAt, nowSec)),
);

/**
 * Open and on a LIVE profile — `isToDo` before the link check (a query that left-joins `liveLink` adds «no
 * match»). A soft-deleted or missing profile is no profile: nobody can decline or send a contract to it, and
 * the panel lists it unlinked (enrichApplicantRows). EXISTS, not a join: one select per count.
 */
const openOnProfile = (scope: unknown) => and(
    scope as never,
    eq(applications.state, APPLICATION_STATES.OPEN),
    isNotNull(formSubmissions.linkedAdopterId),
    sql`EXISTS (SELECT 1 FROM adopters ad WHERE ad.id = ${formSubmissions.linkedAdopterId} AND ad.deleted_at IS NULL)`,
);
const noLiveLink = isNull(contractInvitations.token);

/**
 * `takesContract` in SQL: the application's animal has no active ADOPTION (a general application has no
 * animal, so it always passes). The home and the tab apply the same rule in JS on the animal row.
 */
const animalTakesContract = sql`NOT EXISTS (SELECT 1 FROM placements p WHERE p.animal_id = ${applications.animalId} AND p.ended_at IS NULL AND p.record_type = ${RECORD_TYPES.ADOPTION})`;

/** Open applications on a profile with NO live link, per animal (the animals whose owner's team is `ownerTeam`). */
export async function countToEvaluateByAnimal(db: Db, ownerTeam: readonly string[], nowSec: number, opts: CountOpts = {}): Promise<Map<string, number>> {
    const scope = teamApplicationsWhere(ownerTeam, 'animals');
    if (!scope) return new Map();
    if (opts.heal !== false) await healOnce(db, ownerTeam);
    const rows = await db.select({ animalId: applications.animalId, n: count() })
        .from(applications)
        .innerJoin(formSubmissions, eq(formSubmissions.id, applications.submissionId))
        .leftJoin(animals, animalOf)
        .leftJoin(contractInvitations, liveLink(nowSec))
        .where(and(openOnProfile(scope), noLiveLink))
        .groupBy(applications.animalId)
        .all() as Array<{ animalId: string; n: number }>;
    return new Map(rows.map(r => [r.animalId, r.n]));
}

/** Open applications (to evaluate AND contract sent) per animal — «N candidatos». */
export async function countOpenByAnimal(db: Db, ownerTeam: readonly string[]): Promise<Map<string, number>> {
    const scope = teamApplicationsWhere(ownerTeam, 'animals');
    if (!scope) return new Map();
    await healOnce(db, ownerTeam);
    const rows = await db.select({ animalId: applications.animalId, n: count() })
        .from(applications)
        .innerJoin(formSubmissions, eq(formSubmissions.id, applications.submissionId))
        .leftJoin(animals, animalOf)
        .where(and(scope, eq(applications.state, APPLICATION_STATES.OPEN)))
        .groupBy(applications.animalId)
        .all() as Array<{ animalId: string; n: number }>;
    return new Map(rows.map(r => [r.animalId, r.n]));
}

/** The team's general applications still to evaluate (`isToDo` rows only). */
export async function countGeneralToEvaluate(db: Db, viewerTeam: readonly string[], opts: CountOpts = {}): Promise<number> {
    const scope = generalScopeWhere(viewerTeam);
    if (!scope) return 0;
    if (opts.heal !== false) await healOnce(db, viewerTeam);
    const row = await db.select({ n: count() })
        .from(applications)
        .innerJoin(formSubmissions, eq(formSubmissions.id, applications.submissionId))
        // General applications carry no animal, so no link can be live: no invitation join.
        .where(openOnProfile(scope))
        .get() as { n: number } | undefined;
    return row?.n ?? 0;
}

/**
 * Linked adopter ids of the team's applications still to evaluate (animal + general) — the profiles whose
 * plain duplicate pair waits inside the evaluation (Q6). Only applications someone can still finish: an
 * adopted animal's (`takesContract`) and a deleted animal's (the scope) are out.
 */
export async function toEvaluateAdopterIds(db: Db, team: readonly string[], nowSec: number): Promise<Set<string>> {
    const scope = teamApplicationsWhere(team, 'any');
    if (!scope) return new Set();
    await healOnce(db, team);
    const rows = await db.select({ adopterId: formSubmissions.linkedAdopterId })
        .from(applications)
        .innerJoin(formSubmissions, eq(formSubmissions.id, applications.submissionId))
        .leftJoin(animals, animalOf)
        .leftJoin(contractInvitations, liveLink(nowSec))
        .where(and(openOnProfile(scope), noLiveLink, animalTakesContract))
        .groupBy(formSubmissions.linkedAdopterId)
        .all() as Array<{ adopterId: string | null }>;
    return new Set(rows.flatMap(r => (r.adopterId ? [r.adopterId] : [])));
}

/** Animals with candidates closed by another adoption whose offer is not done: animalId → candidates. */
export async function offerCountsByAnimal(db: Db, ownerTeam: readonly string[]): Promise<Map<string, number>> {
    const scope = teamApplicationsWhere(ownerTeam, 'animals');
    if (!scope) return new Map();
    const rows = await db.select({ animalId: applications.animalId, n: count() })
        .from(applications)
        .innerJoin(formSubmissions, eq(formSubmissions.id, applications.submissionId))
        .leftJoin(animals, animalOf)
        .where(and(
            scope,
            eq(applications.state, APPLICATION_STATES.CLOSED),
            eq(applications.closeReason, APPLICATION_CLOSE_REASONS.ADOPTED_OTHER),
            isNull(applications.offerDoneAt),
            isNotNull(formSubmissions.linkedAdopterId),
        ))
        .groupBy(applications.animalId)
        .all() as Array<{ animalId: string; n: number }>;
    return new Map(rows.map(r => [r.animalId, r.n]));
}
