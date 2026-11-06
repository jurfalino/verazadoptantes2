/**
 * Who may answer «¿Es la misma persona?» about a pair — ONE rule for every screen
 * (step 2, Jon 2026-11-05: "the team acts as one"): anyone on the team of whoever
 * loaded either profile. Admins are let in by the callers that already check them.
 *
 * `team` is the viewer plus their org-mates, already trimmed + lower-cased
 * (getTeamEmails). Owners are compared the same way: an `added_by` stored with
 * capitals still counts. No owner, '' or 'anonymous' never counts.
 */
export function mayAnswerPair(team: ReadonlySet<string>, ...owners: Array<string | null | undefined>): boolean {
    return owners.some(o => {
        const k = (o ?? '').trim().toLowerCase();
        return !!k && k !== 'anonymous' && k.includes('@') && team.has(k);
    });
}
