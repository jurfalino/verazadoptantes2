/**
 * Linked convivientes (spec 2026-10-25 pendientes D, addendum D44–D46, D48, D51): the
 * rules behind a household member that has its own adopter profile. Pure — no
 * DB, no server imports. The server side (src/lib/householdLinks.ts) fetches
 * rows and asks here what to show and who may do what.
 */
import type { ContactEntry, ContactEntryType } from '@/lib/contactEntries';
import { FLAG_REASONS } from './constants';
import type { ActivityCounts } from './activityCounts';
import { isOpenDuplicateFlag, realOwner, type DuplicateFlagRow } from './dedupPair';

/** At most this many linked summaries per side of a profile page (bounded reads). */
export const MAX_LINKED_SUMMARIES = 10;
/**
 * Link rows read per side before liveness is checked. Stale rows (member edited
 * away, merged host) are filtered BEFORE the MAX_LINKED_SUMMARIES cap so they can
 * never crowd out live links; this only bounds the read itself.
 */
export const MAX_LINK_ROWS = 100;
/** At most this many contact rows in one summary card; the full profile has the rest. */
export const MAX_SUMMARY_CONTACTS = 6;
/** Contact types a summary shows — notes (`other`) and aliases are not contact details. */
export const SUMMARY_CONTACT_TYPES: readonly ContactEntryType[] = ['phone', 'email', 'social', 'address', 'id'];

/**
 * A linked profile, read live, exactly as this viewer may see it (D46).
 * Never carries an email address of a rescuer: owner/creator are display
 * names or email handles.
 */
export interface LinkedSummary {
    linkId: string;
    /** The profile this summary describes (the linked member's, or the host's for «Convive con»). */
    profileId: string;
    name: string;
    /** Who loaded that profile: display name, else email handle; null for anonymous/system rows. */
    ownerName: string | null;
    /** Average of the profile's ratings (same source as the profile page); null = not rated. */
    rating: number | null;
    openAlerts: number;
    /** Activity by record type, exactly as that profile's own «Actividad» header counts it (fosters and returns included). */
    activity: ActivityCounts;
    /** Contacts after the viewer's masking: a hidden one carries `masked: true`. */
    contacts: ContactEntry[];
    /** Contacts left out of `contacts` by MAX_SUMMARY_CONTACTS. */
    moreContacts: number;
    /** True when nothing on that profile is masked for this viewer. */
    canSeeContact: boolean;
    /**
     * The viewer may say the person does not live there («No vive acá», D48): a
     * correction of the fact for everyone. One of «Quitar del hogar»'s answers,
     * so the same people as `canRemove` (src/lib/households.ts).
     */
    canReportNotLiving: boolean;
}

/** The host side: a household member's live summary, keyed by member id. */
export type HouseholdLinkedMembers = Record<string, LinkedSummary>;

/** The linked side: «Convive con {host} · según {creator}». */
export interface LivesWithRow extends LinkedSummary {
    /** Who recorded the link (display name / handle), or null when unknown. */
    creatorName: string | null;
}

export interface LinkedSummaries {
    members: HouseholdLinkedMembers;
    livesWith: LivesWithRow[];
}

export const EMPTY_LINKED_SUMMARIES: LinkedSummaries = { members: {}, livesWith: [] };

/**
 * Open alerts on a profile — what its flag pills warn about: an inaccuracy
 * report or a duplicate flag still open. Verification marks (identity,
 * address) are good news, not alerts; a duplicate flag closed by a merge or a
 * «mantener separados» is history, not an alert.
 */
export function countOpenAlerts(flags: DuplicateFlagRow[]): number {
    let n = 0;
    for (const f of flags) {
        if (f.reason === FLAG_REASONS.INACCURATE || f.reason === 'inaccurate') n++;
        else if (isOpenDuplicateFlag(f)) n++;
    }
    return n;
}

/** A rescuer as other people see them: their display name, else the email handle — never the address. */
export function personLabel(email: string | null | undefined, names: Readonly<Record<string, string>>): string | null {
    const owner = realOwner(email ?? null);
    if (!owner) return null;
    const name = names[owner]?.trim();
    return name || owner.split('@')[0];
}

/**
 * Who hears that a profile was linked (D45): its real owner and their team,
 * never the person who did it. Lowercased (the bell and email key on it),
 * deduped; nobody when the profile has no real owner.
 */
export function linkNoticeRecipients(ownerEmail: string | null | undefined, team: readonly string[], actor: string): string[] {
    const owner = realOwner(ownerEmail ?? null);
    if (!owner) return [];
    const self = actor.trim().toLowerCase();
    const out = new Set<string>();
    for (const e of [owner, ...team]) {
        const n = (e ?? '').trim().toLowerCase();
        if (n && n.includes('@') && n !== self) out.add(n);
    }
    return [...out];
}

/** Contacts a summary shows, in the profile's order, capped. */
export function summaryContacts(entries: readonly ContactEntry[]): { shown: ContactEntry[]; more: number } {
    const wanted = entries.filter(e => SUMMARY_CONTACT_TYPES.includes(e.type));
    return { shown: wanted.slice(0, MAX_SUMMARY_CONTACTS), more: Math.max(0, wanted.length - MAX_SUMMARY_CONTACTS) };
}
