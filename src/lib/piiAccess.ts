/**
 * PII access gating — pure helpers (no DB, no server imports).
 *
 * Gated by the ENABLE_PII_ACCESS_GATING feature flag. Holds the core-record
 * edit gate, the visibility resolver, and the masking helpers. DB-touching
 * orchestration lives in src/lib/piiAccessServer.ts.
 */

import {
    type ContactEntry,
    type ContactEntryType,
    deserializeContactEntries,
    contactEntriesToBlob,
    normalizeEntryValue,
} from './contactEntries';
import { PHONE_SEARCH_MIN_DIGITS } from '@/config/constants';

/** Visible token shown in place of a hidden value. */
export const PII_MASK = '••••••';

/**
 * Placeholder for a masked legacy `contactInfo` blob — a row with no structured
 * `contactEntries`, so individual fields can't be masked selectively. Distinct
 * from `null` (which means "no contact info at all"): the UI shows the row HAS
 * protected contact info.
 */
export const MASKED_CONTACT_PLACEHOLDER = 'Contacto protegido';

/** Contact-entry types whose values are PII and get masked. `other` (notes) never is. */
export const MASKED_ENTRY_TYPES: readonly ContactEntryType[] = ['phone', 'email', 'social', 'id', 'address'];

export interface AdopterEditAuth {
    /** Whether ENABLE_PII_ACCESS_GATING is on. Off ⇒ edits are unrestricted (legacy behavior). */
    gatingEnabled: boolean;
    /** Email of the actor attempting the edit (the resolved session user). */
    actorEmail: string | null | undefined;
    /** `adopters.addedBy` of the record being edited. May be a sentinel (`anonymous`, …). */
    ownerEmail: string | null | undefined;
    /** Whether the actor is an admin (bootstrap list or DB `role='admin'`). */
    actorIsAdmin: boolean;
}

/**
 * Decide whether `actorEmail` may edit the core adopter record (name, contact
 * entries, address). When gating is on, only the record owner or an admin may
 * edit — this is what keeps "edit a record ⇒ become an editor ⇒ gain PII
 * visibility" closed. When gating is off, anyone may edit (today's behavior).
 *
 * An empty/sentinel `ownerEmail` never matches a real actor, so a non-admin
 * can't edit an unowned record — intended (it falls to admins).
 */
export function canEditAdopterRecord({
    gatingEnabled,
    actorEmail,
    ownerEmail,
    actorIsAdmin,
}: AdopterEditAuth): boolean {
    if (!gatingEnabled) return true;
    if (actorIsAdmin) return true;
    return !!actorEmail && actorEmail === ownerEmail;
}

// ── Entry-value hashing ───────────────────────────────────────────────────────

/**
 * Stable, non-reversible hash of a normalized entry value — stored as
 * `pii_access_grants.entryRef`. A search match and the render-time mask both
 * hash through here, so a `scope='entry'` grant matches its entry iff the value
 * is unchanged. Not cryptographic: the raw value already lives in
 * `adopters.contactEntries`, so this is data-minimization for the grants table,
 * not a secrecy boundary. cyrb53 — a fast 53-bit string hash.
 */
export function hashEntryValue(type: ContactEntryType, value: string): string {
    const str = normalizeEntryValue(type, value);
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    const combined = 4294967296 * (2097151 & h2) + (h1 >>> 0);
    return combined.toString(16);
}

// ── Search-match detection ────────────────────────────────────────────────────

export interface SearchEntryMatch {
    entry: ContactEntry;
    /** hashEntryValue(entry) — the `entryRef` for the resulting search-match grant. */
    hash: string;
}

/**
 * Find the contact entries a discovery query genuinely matched — the basis for
 * a search-match grant ("you see what you searched for"). Conservative on
 * purpose: only an identifier-shaped query unlocks an identifier, so a
 * name-token search never reveals a phone / email / social.
 *  - phone:  query carries ≥ PHONE_SEARCH_MIN_DIGITS digits; entry digits contain them.
 *  - email:  query contains '@' and is a substring of the entry value.
 *  - social: query is an @handle or a URL, and is a substring of the entry value.
 * `id` / `address` / `other` never auto-unlock — those go through a request.
 */
export function matchSearchEntries(entries: ContactEntry[], query: string): SearchEntryMatch[] {
    const q = query.trim();
    if (!q) return [];
    const qDigits = q.replace(/\D/g, '');
    const qLower = q.toLowerCase();
    const out: SearchEntryMatch[] = [];
    for (const e of entries) {
        let matched = false;
        if (e.type === 'phone') {
            matched = qDigits.length >= PHONE_SEARCH_MIN_DIGITS
                && e.value.replace(/\D/g, '').includes(qDigits);
        } else if (e.type === 'email') {
            matched = q.includes('@') && q.length >= 6 && e.value.toLowerCase().includes(qLower);
        } else if (e.type === 'social') {
            const looksSocial = q.startsWith('@') || /^https?:\/\//i.test(q);
            matched = looksSocial && q.length >= 4 && e.value.toLowerCase().includes(qLower);
        }
        if (matched) out.push({ entry: e, hash: hashEntryValue(e.type, e.value) });
    }
    return out;
}

// ── Visibility resolution ─────────────────────────────────────────────────────

export type VisibilityTier = 'full' | 'partial' | 'none';

/** Subset of a `pii_access_grants` row that the resolver needs. */
export interface PiiGrantRow {
    scope: string;            // 'all_contact' | 'entry'
    entryRef: string | null;
    revokedAt: Date | number | null;
}

export interface ResolveVisibilityInput {
    viewerEmail: string | null | undefined;
    /** `adopters.addedBy` of the record. */
    ownerEmail: string | null | undefined;
    isAdmin: boolean;
    /** Whether the viewer appears in this adopter's `adopter_history.changedBy`. */
    isEditor: boolean;
    /** The viewer's grants for THIS adopter (any scope; revoked ones are filtered here). */
    grants: PiiGrantRow[];
}

export interface Visibility {
    tier: VisibilityTier;
    /** owner / editor / admin — gets the "who has access" UI, can approve, sees no banner. */
    privileged: boolean;
    /** True ⇒ no contact field is masked for this viewer (privileged OR holds an all-contact grant). */
    nothingMasked: boolean;
    hasAllContactGrant: boolean;
    /** entryRef hashes the viewer has unlocked via search-match grants. */
    unlockedEntryHashes: Set<string>;
}

/**
 * Resolve a (viewer, adopter) pair to a visibility verdict. Pure — the caller
 * fetches `isAdmin` / `isEditor` / `grants` (see piiAccessServer.ts).
 */
export function resolveVisibility(input: ResolveVisibilityInput): Visibility {
    const { viewerEmail, ownerEmail, isAdmin, isEditor, grants } = input;
    const privileged = !!viewerEmail && (
        isAdmin || isEditor || (!!ownerEmail && viewerEmail === ownerEmail)
    );
    const live = grants.filter(g => !g.revokedAt);
    const hasAllContactGrant = live.some(g => g.scope === 'all_contact');
    const unlockedEntryHashes = new Set<string>(
        live.filter(g => g.scope === 'entry' && g.entryRef).map(g => g.entryRef as string),
    );
    const nothingMasked = privileged || hasAllContactGrant;
    const tier: VisibilityTier = privileged
        ? 'full'
        : (hasAllContactGrant || unlockedEntryHashes.size > 0) ? 'partial' : 'none';
    return { tier, privileged, nothingMasked, hasAllContactGrant, unlockedEntryHashes };
}

/** A viewer with no email (unauthenticated / unresolved) — everything masked. */
export const NO_ACCESS_VISIBILITY: Visibility = {
    tier: 'none',
    privileged: false,
    nothingMasked: false,
    hasAllContactGrant: false,
    unlockedEntryHashes: new Set(),
};

// ── Masking ───────────────────────────────────────────────────────────────────

export interface MaskableAdopter {
    contactInfo?: string | null;
    contactEntries?: string | null;
    addressInfo?: string | null;
}

export interface AdopterContactMask {
    contactInfo: string | null;
    /** Re-serialized ContactEntry[] JSON — masked entries carry `masked: true`. */
    contactEntries: string | null;
    addressInfo: string | null;
    /** Distinct contact fields hidden from this viewer — drives the banner / "N protected" copy. */
    maskedFieldCount: number;
}

/**
 * Mask one contact-entry list against a visibility verdict. `other` (notes)
 * entries are always kept. A locked identifier entry keeps its type/label but
 * its value becomes the mask token and gains `masked: true`.
 */
export function maskContactEntries(
    entries: ContactEntry[],
    visibility: Visibility,
): { entries: ContactEntry[]; maskedCount: number } {
    if (visibility.nothingMasked) return { entries, maskedCount: 0 };
    let maskedCount = 0;
    const out = entries.map((e): ContactEntry => {
        if (e.type === 'other') return e;
        if (visibility.unlockedEntryHashes.has(hashEntryValue(e.type, e.value))) return e;
        maskedCount++;
        return { type: e.type, value: PII_MASK, ...(e.label ? { label: e.label } : {}), masked: true };
    });
    return { entries: out, maskedCount };
}

/**
 * Mask an adopter's contact fields (`contactInfo`, `contactEntries`,
 * `addressInfo`) against a visibility verdict. Name, family members and notes
 * are NOT contact PII and are untouched.
 */
export function maskAdopterContact(adopter: MaskableAdopter, visibility: Visibility): AdopterContactMask {
    const contactInfo = adopter.contactInfo ?? null;
    const contactEntriesJson = adopter.contactEntries ?? null;
    const addressInfo = adopter.addressInfo ?? null;

    if (visibility.nothingMasked) {
        return { contactInfo, contactEntries: contactEntriesJson, addressInfo, maskedFieldCount: 0 };
    }

    const parsed = deserializeContactEntries(contactEntriesJson);
    const { entries: maskedEntries, maskedCount } = maskContactEntries(parsed, visibility);
    let maskedFieldCount = maskedCount;

    // contactInfo blob: derive from the masked entries when the row HAS entries
    // (so the blob agrees with the masked chips); for a legacy row with only a
    // blob, swap the whole blob for the placeholder since fields can't be split.
    let maskedContactInfo: string | null;
    if (parsed.length > 0) {
        maskedContactInfo = contactEntriesToBlob(maskedEntries) || null;
    } else if (contactInfo && contactInfo.trim()) {
        maskedContactInfo = MASKED_CONTACT_PLACEHOLDER;
        maskedFieldCount++;
    } else {
        maskedContactInfo = null;
    }

    let maskedAddress = addressInfo;
    if (addressInfo && addressInfo.trim()) {
        maskedAddress = PII_MASK;
        maskedFieldCount++;
    }

    return {
        contactInfo: maskedContactInfo,
        contactEntries: parsed.length > 0 ? JSON.stringify(maskedEntries) : contactEntriesJson,
        addressInfo: maskedAddress,
        maskedFieldCount,
    };
}

// ── History redaction ─────────────────────────────────────────────────────────

/** `adopter_history.changes` keys whose old/new values are contact PII. */
const CONTACT_HISTORY_KEYS = new Set(['contactInfo', 'contactEntries', 'addressInfo']);

/**
 * Redact contact-field deltas from an `adopter_history.changes` JSON blob so the
 * change log isn't a back-channel to every value a record ever held. Non-contact
 * deltas (name, status, family) are untouched. Returns the input unchanged for
 * privileged / all-contact viewers, or on a parse failure (our own JSON).
 */
export function redactHistoryChanges(changesJson: string | null, visibility: Visibility): string | null {
    if (visibility.nothingMasked || !changesJson) return changesJson;
    let parsed: unknown;
    try {
        parsed = JSON.parse(changesJson);
    } catch {
        return changesJson;
    }
    if (!parsed || typeof parsed !== 'object') return changesJson;
    const obj = parsed as Record<string, unknown>;
    const redactDelta = (v: unknown): unknown =>
        v && typeof v === 'object' && ('from' in v || 'to' in v)
            ? { from: PII_MASK, to: PII_MASK }
            : PII_MASK;

    for (const key of Object.keys(obj)) {
        if (CONTACT_HISTORY_KEYS.has(key)) {
            obj[key] = redactDelta(obj[key]);
        }
    }
    // appendToExistingAdopter writes { appended_from_create_flow: { appendedFields: {...} } }.
    const appended = obj['appended_from_create_flow'];
    if (appended && typeof appended === 'object') {
        const af = (appended as Record<string, unknown>)['appendedFields'];
        if (af && typeof af === 'object') {
            for (const key of Object.keys(af as Record<string, unknown>)) {
                if (CONTACT_HISTORY_KEYS.has(key)) (af as Record<string, unknown>)[key] = PII_MASK;
            }
        }
    }
    return JSON.stringify(obj);
}

// ── Request-workflow helpers ──────────────────────────────────────────────────

/**
 * Values that occupy `addedBy` / `changedBy` / a session but are not real
 * users. Filtered out before anyone is treated as an actor, approver or
 * notification recipient.
 */
const SENTINEL_ACTORS = new Set(['unknown', 'anonymous', 'form-submission', 'contract-submission', 'system']);

/** True when `email` is a real user (not a sentinel / empty). */
export function isRealActorEmail(email: string | null | undefined): email is string {
    return !!email && !SENTINEL_ACTORS.has(email);
}

/** Days a denied requester must wait before re-requesting the same adopter (Resolution #4). */
export const PII_DENIAL_COOLDOWN_DAYS = 14;

/** When the re-request cooldown ends, given the timestamp the denial was resolved. */
export function piiCooldownUntil(deniedAt: Date | number): Date {
    const ms = typeof deniedAt === 'number' ? deniedAt : deniedAt.getTime();
    return new Date(ms + PII_DENIAL_COOLDOWN_DAYS * 86_400_000);
}

// Shared request-workflow types live here (not in the `'use server'` action
// file) so both the server actions and the client components can import them.

export type RequestPiiAccessStatus = 'created' | 'duplicate' | 'has_access' | 'cooldown' | 'error';

export interface RequestPiiAccessResult {
    ok: boolean;
    status: RequestPiiAccessStatus;
    requestId?: string;
    /** Epoch ms — set when status is 'cooldown'. */
    cooldownUntil?: number;
    error?: string;
}

/** A pending request as shown to an approver (panel + admin dashboard). */
export interface PiiAccessRequestView {
    id: string;
    adopterId: string;
    adopterName: string;
    requesterEmail: string;
    requesterName: string;
    justification: string | null;
    activityId: string | null;
    /** Epoch ms the request was filed. */
    createdAt: number | null;
}

/** The current viewer's request situation for one adopter. */
export interface PiiAccessRequestState {
    /** The viewer has a request awaiting a decision. */
    pending: boolean;
    /** Epoch ms until which a re-request is blocked by the denial cooldown, or null. */
    cooldownUntil: number | null;
    /** Approver's note on the most recent denial, if any. */
    lastResolutionNote: string | null;
}

/** A live `all_contact` grant as shown in the owner "who has access" disclosure. */
export interface PiiAllContactGrant {
    grantId: string;
    granteeEmail: string;
    granteeName: string;
    /** Epoch ms the grant was created. */
    grantedAt: number | null;
}

/** Everything the adopter-profile UI needs to render the PII gating surfaces. */
export interface AdopterPiiContext {
    gatingOn: boolean;
    /** Viewer is owner / editor / admin — sees the approver panel, never the request CTA. */
    privileged: boolean;
    /** Contact fields are masked for this viewer (gating on, not privileged, fields exist). */
    masked: boolean;
    maskedFieldCount: number;
    requestState: PiiAccessRequestState;
    /** Pending requests on this adopter the viewer may act on (privileged viewers only). */
    pendingRequests: PiiAccessRequestView[];
    /**
     * Live grants on this adopter (privileged viewers only) — the "who has
     * access" disclosure. Approved-request grants are listed individually and
     * are revocable; search-match grants are an aggregate count (Resolution #2).
     */
    accessGrants: {
        allContact: PiiAllContactGrant[];
        searchMatchCount: number;
    };
}
