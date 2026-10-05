/**
 * Shared session / team / admin state for server-action integration tests.
 * Each test file wires these into vi.mock calls (vi.mock must stay in the
 * test file to be hoisted). Test-only.
 */
export const OWNER = 'owner@example.com';
export const MATE = 'mate@example.com';
export const STRANGER = 'stranger@example.com';
export const ADMIN = 'admin@example.com';

export const session = { user: null as string | null };

export const isAdmin = async (email: string | null | undefined) => email === ADMIN;
/** OWNER and MATE share a team. */
export const isOrgMate = async (viewer: string | null | undefined, owner: string | null | undefined) =>
    !!viewer && !!owner && viewer !== owner && [OWNER, MATE].includes(viewer) && [OWNER, MATE].includes(owner);
export const isOwnerOrOrgMate = async (viewer: string | null | undefined, owner: string | null | undefined) =>
    (!!viewer && viewer === owner) || isOrgMate(viewer, owner);
/** Team emails for a viewer (incl. themselves): OWNER and MATE share a team. */
export const getOrgMemberEmailsFor = async (email: string) =>
    [OWNER, MATE].includes(email) ? [OWNER, MATE] : [email];
export const getUser = async () => {
    if (!session.user) throw new Error('Authentication required');
    return session.user;
};
