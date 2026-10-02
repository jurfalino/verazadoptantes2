/**
 * Client-side reading of a "view as" session (src/domain/viewAs.ts). The
 * session callback in src/auth.ts adds `viewingAs` only while an admin is
 * browsing as someone else; `user` is then the viewed user.
 */

export interface ViewingAs {
    adminEmail: string | null;
    adminName: string | null;
    expiresAt: number;
}

export function viewingAsOf(session: unknown): ViewingAs | null {
    const v = (session as { viewingAs?: ViewingAs } | null | undefined)?.viewingAs;
    return v && typeof v === 'object' ? v : null;
}

/**
 * Analytics must not identify as the viewed user: the admin's browsing would
 * merge into that person's analytics profile and replays. Identity providers
 * skip the update and keep the admin's own identity while this is true.
 */
export function isViewingAs(session: unknown): boolean {
    return viewingAsOf(session) !== null;
}
