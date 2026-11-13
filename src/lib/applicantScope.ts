/**
 * Which applicants belong to an animal — ONE rule, used by the animal page
 * (`getApplicantsForAnimal`) and the /my-animals card count, so the card can
 * never say 3 while the page lists 2.
 *
 * 2026-09-30 (product decision): applicants are a TEAM resource, like the
 * animal itself. A `form_submissions` row belongs to animal A when
 *   applications.animal_id = A
 *   AND the form link that produced it (`user_id`) belongs to the team of
 *       A's OWNER — `getTeamEmails(animal.addedBy)`: owner + org-mates.
 *
 * Why the team filter stays: the submit route does not check that `?animal=`
 * belongs to the form owner `u`, so anyone can file a row against any animal
 * through their own link. Scoping to the owner's team keeps those forged rows
 * out.
 *
 * Not a `'use server'` module on purpose: every export of one is a public
 * endpoint. Pure apart from building a drizzle condition (no DB access), so it
 * is unit-tested by compiling the SQL (applicantScope.test.ts).
 */

import { and, eq, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { animals, applications, formSubmissions } from '@/db/schema';
import { APPLICATION_STATES } from '@/domain/constants';

/** Lower-case, trim, dedupe, drop blanks. `getTeamEmails` already lower-cases;
 *  `form_submissions.user_id` is the raw `users.email`, so both sides are
 *  normalised before they meet. */
export function normalizeTeamScope(emails: ReadonlyArray<string | null | undefined>): string[] {
    const out: string[] = [];
    for (const raw of emails) {
        const e = (raw ?? '').trim().toLowerCase();
        if (e && !out.includes(e)) out.push(e);
    }
    return out;
}

/** True when a form-link owner (`user_id`) is in the normalised team scope.
 *  An empty scope matches nothing (fail closed). */
export function isInTeamScope(formLinkOwner: string | null | undefined, scope: readonly string[]): boolean {
    const e = (formLinkOwner ?? '').trim().toLowerCase();
    return !!e && scope.includes(e);
}

/** A «replaced» application (superseded by a merge) is in no list, count or access decision. */
const notReplaced = ne(applications.state, APPLICATION_STATES.REPLACED);

/** An OR of one bound `lower(user_id) = ?` per email — never `IN (array)` (D1 binds it as one value). */
function linkOwnerInTeam(scope: readonly string[]): SQL | undefined {
    return or(...scope.map(e => sql`lower(${formSubmissions.userId}) = ${e}`));
}

/**
 * The WHERE clause for "applications of `animalId` within `teamEmails`".
 * Callers MUST `innerJoin(formSubmissions, eq(formSubmissions.id, applications.submissionId))`.
 *
 * Returns `null` (caller must not query) for an empty team or animal id:
 * drizzle's `or()` of nothing is `undefined` and `and(x, undefined)` silently
 * drops it, which would list every row for the animal, forged ones included.
 * Excludes «replaced» applications.
 */
export function applicantScopeWhere(
    animalId: string,
    teamEmails: ReadonlyArray<string | null | undefined>,
): SQL | null {
    const scope = normalizeTeamScope(teamEmails);
    if (!animalId || scope.length === 0) return null;
    const inTeam = linkOwnerInTeam(scope);
    if (!inTeam) return null;
    return and(eq(applications.animalId, animalId), inTeam, notReplaced) ?? null;
}

/**
 * General applications (no animal) filed through a form link of the viewer's
 * team. Same join requirement and fail-closed rule as `applicantScopeWhere`.
 */
export function generalScopeWhere(teamEmails: ReadonlyArray<string | null | undefined>): SQL | null {
    const scope = normalizeTeamScope(teamEmails);
    if (scope.length === 0) return null;
    const inTeam = linkOwnerInTeam(scope);
    if (!inTeam) return null;
    return and(isNull(applications.animalId), inTeam, notReplaced) ?? null;
}

/** An OR of one bound `lower(trim(animals.added_by)) = ?` per email: the animal's OWNER is in the team. */
function animalOwnerInTeam(scope: readonly string[]): SQL | undefined {
    return or(...scope.map(e => sql`lower(trim(${animals.addedBy})) = ${e}`));
}

/**
 * The team-wide variants the grouped counts use — `applicantScopeWhere` /
 * `generalScopeWhere` without the per-animal fan-out. Same rules as those:
 * an animal's application belongs to a team when the form link AND the
 * animal's OWNER are both in it (so a forged `?animal=` row, or an animal
 * whose owner left the team, is nobody's to evaluate), a general one when the
 * form link is; «replaced» never counts, nor does an application of a
 * soft-deleted animal.
 *   'animals' → only applications of an animal (grouped per animal);
 *   'any'     → those plus the general ones.
 * Callers MUST innerJoin form_submissions AND `leftJoin(animals, eq(animals.id, applications.animalId))`.
 * Fails closed (null) on an empty team.
 */
export function teamApplicationsWhere(teamEmails: ReadonlyArray<string | null | undefined>, animalScope: 'animals' | 'any'): SQL | null {
    const scope = normalizeTeamScope(teamEmails);
    if (scope.length === 0) return null;
    const linkInTeam = linkOwnerInTeam(scope);
    const ownerInTeam = animalOwnerInTeam(scope);
    if (!linkInTeam || !ownerInTeam) return null;
    // A soft-deleted animal's applications are nobody's to evaluate (its page refuses every action).
    const ofAnimal = and(isNotNull(applications.animalId), isNull(animals.deletedAt), ownerInTeam);
    const target = animalScope === 'animals' ? ofAnimal : or(isNull(applications.animalId), ofAnimal);
    return and(target, linkInTeam, notReplaced) ?? null;
}

/**
 * The animal a form-submission notification may name to the FORM-LINK
 * OWNER's org-mates: only when the animal's owner is in that team. A forged
 * `/form?u=<x>&animal=<another team's animal>` row would otherwise show x's
 * teammates another team's animal name. Null → generic title, no animal in
 * the metadata.
 */
export function teammateVisibleAnimal(
    animal: { id: string | null; name: string | null; owner: string | null },
    formLinkOwnerTeam: ReadonlyArray<string | null | undefined>,
): { id: string; name: string } | null {
    if (!animal.id || !animal.name?.trim() || !animal.owner) return null;
    return isInTeamScope(animal.owner, normalizeTeamScope(formLinkOwnerTeam))
        ? { id: animal.id, name: animal.name }
        : null;
}
