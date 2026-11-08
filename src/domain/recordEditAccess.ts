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
import { PLACEMENT_RECORD_TYPES } from './placements';

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

/**
 * Whether a record type stores «¿Verificaste su identidad?». Only placements
 * (adoption, foster) have the column; events (follow-up, return, observation,
 * request) would silently drop it, so the forms don't ask there.
 */
export function recordStoresIdentityCheck(recordType: string | null | undefined): boolean {
    return !!recordType && (PLACEMENT_RECORD_TYPES as readonly string[]).includes(recordType);
}

/**
 * What a record asks about the handover: «¿Entregado en casa del adoptante?»
 * (with its address) and «¿Verificaste su identidad?». ONE rule for the create
 * wizard, the edit form and the server's address copy (F3, Jon 2026-11-08): a
 * «Tránsito» asks exactly what an «Adopción» asks — the foster family receives
 * the animal at home too — and only those placements store the answers.
 */
export interface HandoverFields {
    deliveredToHome: boolean;
    identityCheck: boolean;
}

export function recordHandoverFields(recordType: string | null | undefined): HandoverFields {
    const placement = recordStoresIdentityCheck(recordType);
    return { deliveredToHome: placement, identityCheck: placement };
}

/** The delivery address as the two fields the forms show (street and number, locality). */
export interface DeliveryAddressParts {
    streetAndNumber: string;
    locality: string;
}

/**
 * The stored single-string delivery address → the two fields. Splits on the
 * LAST comma, the same place masking takes the locality from
 * (partialRevealAddressString), so «Calle 5 1234, depto 3, Vicente López»
 * keeps «depto 3» in the street. No comma (or nothing after it): all of it is
 * the street, so no character of an old record is dropped on the way back.
 */
export function splitDeliveryAddress(text: string | null | undefined): DeliveryAddressParts {
    const v = (text ?? '').trim();
    const lastComma = v.lastIndexOf(',');
    if (lastComma > 0) {
        const locality = v.slice(lastComma + 1).trim();
        if (locality) return { streetAndNumber: v.slice(0, lastComma).trim(), locality };
    }
    return { streetAndNumber: v, locality: '' };
}

/** The two fields → the stored string («street, locality»; an empty half is left out). */
export function joinDeliveryAddress({ streetAndNumber, locality }: DeliveryAddressParts): string {
    return [streetAndNumber.trim(), locality.trim()].filter(Boolean).join(', ');
}
