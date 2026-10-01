/**
 * Which applicants belong to an animal — ONE rule, used by the animal page
 * (`getApplicantsForAnimal`) and the /my-animals card count, so the card can
 * never say 3 while the page lists 2.
 *
 * 2026-09-30 (product decision): applicants are a TEAM resource, like the
 * animal itself. A `form_submissions` row belongs to animal A when
 *   selected_animal_id = A
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

import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import { formSubmissions } from '@/db/schema';

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

/**
 * The WHERE clause for "applicants of `animalId` within `teamEmails`".
 *
 * An OR of one bound `lower(user_id) = ?` per email — never `IN (array)`,
 * which D1 binds as a single value. Returns `null` (caller must not query)
 * for an empty team or animal id: drizzle's `or()` of nothing is `undefined`
 * and `and(x, undefined)` silently drops it, which would list every row for
 * the animal, forged ones included.
 */
export function applicantScopeWhere(
    animalId: string,
    teamEmails: ReadonlyArray<string | null | undefined>,
): SQL | null {
    const scope = normalizeTeamScope(teamEmails);
    if (!animalId || scope.length === 0) return null;
    const linkOwnerInTeam = or(...scope.map(e => sql`lower(${formSubmissions.userId}) = ${e}`));
    if (!linkOwnerInTeam) return null;
    return and(eq(formSubmissions.selectedAnimalId, animalId), linkOwnerInTeam) ?? null;
}
