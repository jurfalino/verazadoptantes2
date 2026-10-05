/** Who may read a completed interview's answers (spec D7). Everyone else sees only that it happened. */
export function canViewInterviewAnswers(p: {
    viewer: string | null | undefined;
    conductedBy: string;
    ownerEmail: string | null | undefined;
    viewerIsAdmin: boolean;
    viewerIsOrgMate: boolean;
}): boolean {
    if (!p.viewer) return false;
    if (p.viewer === p.conductedBy) return true;
    if (p.viewerIsAdmin) return true;
    if (p.ownerEmail && p.viewer === p.ownerEmail) return true;
    return p.viewerIsOrgMate;
}
