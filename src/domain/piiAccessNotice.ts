/**
 * What a viewer WITHOUT contact access is told about their own access history
 * on one profile (H3): «Tu solicitud no fue aprobada.» (+ the approver's note)
 * and «El responsable quitó tu acceso el {fecha}.».
 *
 * Read from the viewer's own `pii_access_requests` and `pii_access_grants`
 * rows only — never from a notification — so deleting the notice loses
 * nothing. Pure: no DB, no server imports.
 */

/** Every grant the household conversion wrote starts with this (`conversionGrantPrefix`). */
export const CONVERSION_GRANT_ID_PREFIX = 'hcg:';
/** `pii_access_grants.origin` of the access a merge gave the absorbed team. */
export const MERGE_GRANT_ORIGIN = 'merge';

export interface AccessRequestFact {
    status: string; // pending | approved | denied
    createdAt: number | null;
    resolvedAt: number | null;
    resolutionNote: string | null;
}

export interface AccessGrantFact {
    id: string;
    scope: string; // all_contact | entry | name_token
    origin: string;
    createdAt: number | null;
    revokedAt: number | null;
    revokedByEmail: string | null;
}

export interface PiiAccessNotice {
    /** The latest decided request was a denial and nothing newer was asked or given. */
    denial: { note: string | null } | null;
    /** Epoch ms of the revoke to show as «El responsable quitó tu acceso el …», or null. */
    accessRevokedAt: number | null;
    /** Who took it back (the revoke shown in `accessRevokedAt`), or null. The
     *  caller decides whether that person reads as «Un administrador». */
    accessRevokedBy: string | null;
}

const norm = (e: string | null | undefined) => (e ?? '').trim().toLowerCase();

/**
 * A grant given by machinery (a merge, a household conversion) is taken back by
 * that machinery's undo, not by a person deciding about the viewer — so its
 * revoke never reads «El responsable quitó tu acceso».
 */
function machineGranted(g: AccessGrantFact): boolean {
    return g.origin === MERGE_GRANT_ORIGIN || g.id.startsWith(CONVERSION_GRANT_ID_PREFIX);
}

export function piiAccessNotice(input: {
    viewerEmail: string;
    requests: AccessRequestFact[];
    grants: AccessGrantFact[];
}): PiiAccessNotice {
    const { requests, grants } = input;
    const viewer = norm(input.viewerEmail);
    const hasPending = requests.some(r => r.status === 'pending');

    // ── Denial: the latest DECIDED request (by resolvedAt), if it's a denial.
    // Tie on resolvedAt (second precision): the later-created wins, then an
    // approval wins — never claim «no fue aprobada» on a coin flip.
    const decided = requests
        .filter(r => r.resolvedAt != null && (r.status === 'approved' || r.status === 'denied'))
        .sort((a, b) =>
            (b.resolvedAt! - a.resolvedAt!)
            || ((b.createdAt ?? 0) - (a.createdAt ?? 0))
            || ((a.status === 'approved' ? 0 : 1) - (b.status === 'approved' ? 0 : 1)));
    const latest = decided[0];
    let denial: PiiAccessNotice['denial'] = null;
    if (latest && latest.status === 'denied' && !hasPending) {
        const newerApproved = requests.some(r => r.status === 'approved' && (r.createdAt ?? 0) > latest.resolvedAt!);
        if (!newerApproved) {
            const note = latest.resolutionNote?.trim();
            denial = { note: note ? note : null };
        }
    }

    // ── Revoke: only while no live profile-wide grant, and only when the
    // viewer's LATEST event on this profile is a person other than the grantee
    // taking back a profile-wide grant. Self-revokes (a contributor taking back
    // their own contacts writes revokedByEmail = grantee) never count.
    let accessRevokedAt: number | null = null;
    let accessRevokedBy: string | null = null;
    const liveProfileGrant = grants.some(g => g.scope === 'all_contact' && g.revokedAt == null);
    if (!liveProfileGrant && !hasPending) {
        type Ev = { at: number; revoke: AccessGrantFact | null };
        const events: Ev[] = [];
        for (const r of requests) {
            if (r.createdAt != null) events.push({ at: r.createdAt, revoke: null });
            if (r.resolvedAt != null) events.push({ at: r.resolvedAt, revoke: null });
        }
        for (const g of grants) {
            if (g.createdAt != null) events.push({ at: g.createdAt, revoke: null });
            if (g.revokedAt != null) events.push({ at: g.revokedAt, revoke: g });
        }
        // Latest first; on a tie the non-revoke event wins (hides the line).
        events.sort((a, b) => (b.at - a.at) || ((a.revoke ? 1 : 0) - (b.revoke ? 1 : 0)));
        const g = events[0]?.revoke;
        if (g && g.scope === 'all_contact' && !machineGranted(g)
            && norm(g.revokedByEmail) !== '' && norm(g.revokedByEmail) !== viewer) {
            accessRevokedAt = g.revokedAt;
            accessRevokedBy = g.revokedByEmail;
        }
    }

    return { denial, accessRevokedAt, accessRevokedBy };
}
