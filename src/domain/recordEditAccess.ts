/**
 * Who may edit (or delete) a record in a person's history — pure.
 *
 * ONE rule for both the edit pencil (getAdoptions → `canEdit` per row →
 * AdoptionHistory) and the server gate (saveAdoption / deleteAdoption), so the
 * pencil shows exactly where the save works. The deciding fact is the RECORD's
 * author, not the profile's owner: a record an outside rescue wrote on your
 * teammate's profile is theirs, and one your teammate wrote on a stranger's
 * profile is your team's (teams act as one).
 *
 * The caller resolves `viewerIsAuthorOrTeammate` (isOwnerOrOrgMate against the
 * record's addedBy) and `viewerIsAdmin`; see src/lib/recordEditAccess.ts.
 */
export interface RecordEditInput {
    viewer: string | null | undefined;
    viewerIsAdmin: boolean;
    /** The viewer wrote the record, or shares a team with whoever did. */
    viewerIsAuthorOrTeammate: boolean;
}

export function canEditRecord({ viewer, viewerIsAdmin, viewerIsAuthorOrTeammate }: RecordEditInput): boolean {
    if (!viewer || !viewer.trim()) return false;
    return viewerIsAuthorOrTeammate || viewerIsAdmin;
}

