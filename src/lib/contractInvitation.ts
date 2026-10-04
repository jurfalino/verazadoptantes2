/**
 * Contract invitations (/c/<token>) — pure decisions. No DB, no server imports;
 * contractInvitationAccess.ts gathers the inputs.
 *
 * An invitation is issued by a rescuer for one adopter. That adopter may be a
 * profile ANOTHER rescuer created (the applicant was linked to it with «Es la
 * misma persona»), so three things are decided from what the inviting rescuer
 * may see — never from the raw row:
 *   - who may be invited at all (decideInvitationAccess);
 *   - what the unauthenticated token page pre-fills (buildContractPrefill);
 *   - what signing writes back onto the profile (contactUpdateOnSign) — keyed
 *     on OWNERSHIP (owner or teammate), never on visibility: seeing a profile
 *     in full (admin, grant holder, public profile, gating off) is not a right
 *     to rewrite another rescuer's record.
 */

import type { Visibility, MaskContactOptions } from './piiAccess';
import { maskContactEntries, submissionUnlockHashes } from './piiAccess';
import {
    type ContactEntry,
    deserializeContactEntries,
    parseBlobToContactEntries,
    contactEntriesToBlob,
    mergeContactEntries,
} from './contactEntries';

/**
 * A log-safe reference to an invitation token. Tokens are bearer credentials
 * (whoever holds one opens and signs the contract), so logs carry only the
 * first 8 characters — enough to correlate with a row, useless to replay.
 */
export function tokenRef(token: string | null | undefined): string {
    return token ? `${token.slice(0, 8)}…` : '';
}

export interface InvitationAccessInput {
    /** A form for THIS animal, received by this rescuer, is linked to the adopter
     *  (the same rows the applicants panel lists). */
    isApplicant: boolean;
    /** The rescuer sees the adopter's contact unmasked (owner / teammate /
     *  admin / moderator / approved full-contact grant). */
    nothingMasked: boolean;
    /** ENABLE_PII_ACCESS_GATING (a failed read counts as ON). */
    gatingOn: boolean;
    /** The whole profile is public (flag on + admin-flagged record). */
    adopterIsPublic: boolean;
    /** The rescuer created the profile or shares a team with whoever did. */
    isOwnerOrTeammate: boolean;
}

export interface InvitationAccessDecision {
    /** May this rescuer issue / use an invitation for this adopter. */
    allowed: boolean;
    /** Nothing about the adopter's contact is hidden from this rescuer — the
     *  same predicate as the match card and the profile page. Drives the
     *  pre-fill only. */
    fullAccess: boolean;
    /** A signature may REPLACE the profile's contact and name. Only on the
     *  rescuer's own or her team's profile; everywhere else it merges. */
    overwriteOnSign: boolean;
}

/**
 * Applicants of the animal, or adopters the rescuer fully sees. Deliberately
 * NOT relaxed when gating is off: the gate also protects other rescuers'
 * records from being rewritten by a signature (contactUpdateOnSign).
 */
export function decideInvitationAccess(input: InvitationAccessInput): InvitationAccessDecision {
    return {
        allowed: input.isApplicant || input.nothingMasked,
        fullAccess: !input.gatingOn || input.nothingMasked || input.adopterIsPublic,
        overwriteOnSign: input.isOwnerOrTeammate,
    };
}

export interface ContractPrefill {
    name: string;
    lastName: string;
    email: string;
    phone: string;
    address: string;
    dni: string;
}

/** `Prefix: value` line from the legacy contact blob ('' when absent). */
export function splitContactLine(contactInfo: string | null | undefined, prefix: string): string {
    if (!contactInfo) return '';
    const re = new RegExp(`^${prefix}:\\s*(.*)$`, 'mi');
    const m = contactInfo.match(re);
    return m ? m[1].trim() : '';
}

export function splitName(full: string | null | undefined): { first: string; last: string } {
    const trimmed = (full ?? '').trim();
    if (!trimmed) return { first: '', last: '' };
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) return { first: parts[0], last: '' };
    return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

export interface PrefillAccess {
    fullAccess: boolean;
    visibility: Visibility;
    maskOptions?: MaskContactOptions;
    /** What this adopter typed in their own form(s) for this animal. */
    submitted: Array<string | null | undefined>;
}

/**
 * The contract form's pre-fill. With full access: today's behaviour (the
 * contact blob's lines). Otherwise only values the inviting rescuer could see
 * in full — her grants plus what the applicant typed (submissionUnlockHashes,
 * as on the match card); a masked value is never pre-filled, the field stays
 * blank for the adopter to type. Address only via an existing grant (the
 * legacy `addressInfo` column is always masked for her). Names are not masked
 * anywhere in the app, so they are pre-filled as before.
 */
export function buildContractPrefill(
    adopter: { name: string | null; contactInfo: string | null; contactEntries: string | null; addressInfo: string | null },
    access: PrefillAccess,
): ContractPrefill {
    const { first, last } = splitName(adopter.name);
    if (access.fullAccess) {
        const ci = adopter.contactInfo;
        return {
            name: first,
            lastName: last,
            email: splitContactLine(ci, 'Email'),
            phone: splitContactLine(ci, 'Tel') || splitContactLine(ci, 'Teléfono') || splitContactLine(ci, 'Telefono'),
            address: splitContactLine(ci, 'Dirección') || splitContactLine(ci, 'Direccion') || (adopter.addressInfo || ''),
            dni: splitContactLine(ci, 'Documento') || splitContactLine(ci, 'DNI'),
        };
    }
    const parsed = deserializeContactEntries(adopter.contactEntries);
    const source = parsed.length > 0 ? parsed : parseBlobToContactEntries(adopter.contactInfo);
    const unlockedEntryHashes = new Set([
        ...access.visibility.unlockedEntryHashes,
        ...submissionUnlockHashes(source, access.submitted),
    ]);
    const { entries } = maskContactEntries(source, { ...access.visibility, unlockedEntryHashes }, access.maskOptions ?? {});
    const firstVisible = (type: ContactEntry['type']) =>
        entries.find(e => e.type === type && !!e.value && !e.masked)?.value ?? '';
    return {
        name: first,
        lastName: last,
        email: firstVisible('email'),
        phone: firstVisible('phone'),
        address: firstVisible('address'),
        dni: firstVisible('id'),
    };
}

export interface ContactUpdate {
    contactInfo: string | null;
    contactEntries: string | null;
    addressInfo: string | null;
    /** Whether the signer's name replaces the profile's name. */
    replaceName: boolean;
}

/**
 * What a signature through an invitation writes onto the adopter's profile.
 * `overwrite` (decideInvitationAccess.overwriteOnSign — the inviting rescuer's
 * own or team profile): today's behaviour, the signed values replace the
 * contact and the name. Otherwise the profile belongs to another rescuer — the
 * signed values are ADDED (mergeContactEntries dedupes), nothing the profile
 * already had is removed, an existing address is kept, and the name is left
 * alone.
 */
export function contactUpdateOnSign(
    existing: { contactInfo: string | null; contactEntries: string | null; addressInfo: string | null },
    signed: { entries: ContactEntry[]; address: string | null },
    overwrite: boolean,
): ContactUpdate {
    if (overwrite) {
        return {
            contactInfo: contactEntriesToBlob(signed.entries) || null,
            contactEntries: signed.entries.length ? JSON.stringify(signed.entries) : null,
            addressInfo: signed.address || null,
            replaceName: true,
        };
    }
    const parsed = deserializeContactEntries(existing.contactEntries);
    const current = parsed.length > 0 ? parsed : parseBlobToContactEntries(existing.contactInfo);
    const merged = mergeContactEntries(current, signed.entries);
    return {
        contactInfo: contactEntriesToBlob(merged) || null,
        contactEntries: merged.length ? JSON.stringify(merged) : null,
        addressInfo: existing.addressInfo || signed.address || null,
        replaceName: false,
    };
}
