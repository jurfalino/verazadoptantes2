/**
 * Which profiles a search shows by country (Jon, 2026-11-12):
 *   - a profile's country is the country set in its creator's account when it
 *     was created (stamped by saveAdopter / the auto-creates);
 *   - a search shows the profiles of the viewer's CURRENT account country;
 *   - and always every profile the viewer or someone in their group loaded,
 *     whatever its country — changing your country never hides your own or
 *     your group's people.
 * `team` is the viewer plus their group-mates (getTeamEmails), any case.
 * No viewer country → no country filter (fails open: shows more, never hides).
 */
export function shownInCountrySearch(
    row: { country: string | null; addedBy: string | null },
    viewerCountry: string | null | undefined,
    team: readonly string[],
): boolean {
    if (!viewerCountry) return true;
    if (row.country === viewerCountry) return true;
    const by = row.addedBy?.trim().toLowerCase();
    return !!by && team.some(e => e.trim().toLowerCase() === by);
}

/** The team list as the SQL gate compares it: trimmed, lowercased, deduped, no blanks. */
export function normalizedTeam(team: readonly string[]): string[] {
    return [...new Set(team.map(e => e.trim().toLowerCase()).filter(Boolean))];
}
