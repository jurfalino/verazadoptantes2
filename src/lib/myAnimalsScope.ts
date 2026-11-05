/**
 * Which rows each /my-animals tab lists, for the viewer's team. The tab
 * lists, their ?counts=1 numbers and the homepage animals card all build
 * on these, so a count can never disagree with its list.
 *
 * v2.55.18: animals are TEAM resources — the list spans the org (self +
 * org-mates). OR fan-out per email, never `IN ${array}` (D1 quirk).
 */
export async function myAnimalsScope(userEmail: string) {
    const { adoptions } = await import('@/db/schema');
    const { eq, and, or, isNull, isNotNull } = await import('drizzle-orm');
    // Fails open to [self] inside getTeamEmails.
    const { getTeamEmails } = await import('@/lib/orgMembership');
    const teamEmails = await getTeamEmails(userEmail);
    // Fail CLOSED: `or()` of an empty array is `undefined`, and `and(undefined, …)`
    // silently drops it — an empty team list would return EVERY animal to any
    // authenticated user. getTeamEmails always includes self today, so this is
    // defense in depth against a future refactor, not a live hole.
    const scopeEmails = teamEmails.length > 0 ? teamEmails : [userEmail];
    const teamMatch = or(...scopeEmails.map((e: string) => eq(adoptions.addedBy, e)));

    // Adopted: recordType = 'adoption', linked to an adopter.
    const adoptedWhere = and(
        teamMatch,
        isNotNull(adoptions.adopterId),
        eq(adoptions.recordType, 'adoption'),
    );
    // Available (not yet adopted) PLUS animals currently in a foster home
    // ("Tránsito"). Foster rows have an adopterId (the foster home) +
    // recordType='foster', so the isNull(adopterId) guard applies only to
    // plain 'available' rows — otherwise a fostered animal falls through
    // both /my-animals tabs and vanishes.
    const availableWhere = and(
        teamMatch,
        or(
            and(isNull(adoptions.adopterId), eq(adoptions.recordType, 'available')),
            eq(adoptions.recordType, 'foster'),
        ),
    );
    // Every animal that can have a follow-up due: in a home, adopted or in
    // foster. «Con controles pendientes» is the subset with one due now.
    const placedWhere = and(
        teamMatch,
        isNotNull(adoptions.adopterId),
        or(eq(adoptions.recordType, 'adoption'), eq(adoptions.recordType, 'foster')),
    );

    return { scopeEmails, teamMatch, adoptedWhere, availableWhere, placedWhere };
}
