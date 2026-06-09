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
    parseBlobToContactEntries,
    normalizeEntryValue,
} from './contactEntries';
import { PHONE_SEARCH_MIN_DIGITS } from '@/config/constants';
import { normalizeText, extractAddressWords } from './tokenizer';

/** Visible token shown in place of a hidden value. */
export const PII_MASK = '••••••';

/**
 * Placeholder for a masked legacy `contactInfo` blob — a row with no structured
 * `contactEntries`, so individual fields can't be masked selectively. Distinct
 * from `null` (which means "no contact info at all"): the UI shows the row HAS
 * protected contact info.
 */
export const MASKED_CONTACT_PLACEHOLDER = 'Contacto protegido';

/** Contact-entry types whose values are PII and get masked. `other` (notes) and
 * `alias` (name-like) never are — aliases are visible to all viewers, mirroring
 * the way `adopters.name` is name-data, not contact PII. */
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
    /** Whether the actor shares an org with the owner (v2.18.11). Treated
     *  identically to ownership for edit purposes — the audit log + owner
     *  notification system is the backstop. */
    actorIsOrgMate?: boolean;
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
    actorIsOrgMate,
}: AdopterEditAuth): boolean {
    if (!gatingEnabled) return true;
    if (actorIsAdmin) return true;
    if (actorIsOrgMate) return true;
    return !!actorEmail && actorEmail === ownerEmail;
}

// ── Entry-value hashing ───────────────────────────────────────────────────────

/** cyrb53 — fast 53-bit string hash. Not cryptographic; used here for
 * data-minimization on the grants table (the raw value lives in
 * `adopters.contactEntries`, so a hash collision attack on a stored grant
 * gives an attacker nothing they couldn't read from that table directly). */
function cyrb53Hex(str: string): string {
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

/**
 * Stable, non-reversible hash of a normalized contact-entry value — stored as
 * `pii_access_grants.entryRef` for `scope='entry'` rows. A search match and the
 * render-time mask both hash through here, so a grant matches its entry iff
 * the value is unchanged.
 */
export function hashEntryValue(type: ContactEntryType, value: string): string {
    return cyrb53Hex(normalizeEntryValue(type, value));
}

/**
 * Stable, non-reversible hash of a normalized name token — stored as
 * `pii_access_grants.entryRef` for `scope='name_token'` rows. Lowercased and
 * accent-stripped via `normalizeText`, so `"María"` and `"maria"` hash the same.
 */
export function hashNameToken(token: string): string {
    return cyrb53Hex(normalizeText(token));
}

// ── Search-match detection ────────────────────────────────────────────────────

export interface SearchEntryMatch {
    entry: ContactEntry;
    /** hashEntryValue(entry) — the `entryRef` for the resulting search-match grant. */
    hash: string;
}

const ID_ANCHOR_MIN_DIGITS = 6;
const ADDRESS_PART_MIN_LEN = 2;
const ADDRESS_SPECIFIC_MIN_LEN = 5;
const ADDRESS_SPECIFIC_MIN_LETTERS = 2;

/**
 * Levenshtein distance ≤ 1 — same string, OR one insertion / deletion /
 * substitution. Absorbs single-character typos in letter-only address parts
 * ("Sprigfield" ↔ "Springfield"). Specific parts (text + digit run) use exact
 * comparison instead — Lev-1 on numbers would let "Peru 998" silently match
 * "Peru 999", and numerically adjacent doors are different addresses, not typos.
 */
function levAtMostOne(a: string, b: string): boolean {
    if (a === b) return true;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    let i = 0, j = 0, diff = 0;
    while (i < la && j < lb) {
        if (a[i] === b[j]) { i++; j++; continue; }
        diff++;
        if (diff > 1) return false;
        if (la === lb) { i++; j++; }
        else if (la > lb) { i++; }
        else { j++; }
    }
    if (i < la || j < lb) diff++;
    return diff <= 1;
}

/** Does `query` contain a substring within Lev-1 of `part`? Loose-part-only. */
function queryContainsApprox(query: string, part: string): boolean {
    if (part.length === 0) return false;
    if (query.includes(part)) return true;
    const lens = [part.length - 1, part.length + 1].filter(n => n >= 2);
    for (const L of lens) {
        if (L > query.length) continue;
        for (let i = 0; i + L <= query.length; i++) {
            if (levAtMostOne(part, query.slice(i, i + L))) return true;
        }
    }
    return false;
}

/**
 * Anchor rule for an address entry. Three shapes:
 *
 *  STRUCTURED — entry has `streetAndNumber`. The gated half is structurally
 *  known to be the street + number, so the rule reduces to "exact substring
 *  match of normalized `streetAndNumber` in the normalized query". No
 *  comma-tokenization, no specific/loose heuristic, no Lev-1 (same
 *  digit-confusion concern as before: "Peru 998" must not unlock "Peru 999").
 *  Min length 5 prevents trivially short streets ("Av 1") from fan-granting.
 *
 *  RAW / LEGACY — entry has `raw` (escape-hatch) or only a free-text `value`.
 *  Falls back to the comma-tokenized rule below:
 *   - SPECIFIC — has a digit AND ≥ 2 letters AND length ≥ 5 (a street +
 *     number). A single match anchors. Exact substring required.
 *   - LOOSE — anything else (locality, neighborhood, postal code, apartment).
 *     Two loose matches together anchor; one alone is not enough. Lev-1
 *     tolerance applies (typos in locality names).
 *
 * Combining loose parts ("San Isidro 3680") is itself the evidence — harder to
 * coincidence into than either piece alone.
 */
/**
 * Pair-anchor fallback for an address SPECIFIC chunk (v2.16.0-18). The
 * original substring-includes rule required the query to contain the whole
 * normalized chunk verbatim — "calle cuba 2734 pb 6" as a single string —
 * which is too rigid for natural address knowledge ("cuba 2734" gets
 * rejected even though it clearly demonstrates knowledge of the address).
 *
 * Anchors when the query contains BOTH a name word AND a number that
 * appear in the stored part — both as whole address-word tokens. Reuses
 * `extractAddressWords` from the tokenizer, which already strips stopwords
 * (calle, av, de, piso, etc.) and short fragments (<3 chars). The pair
 * requirement is the anti-fishing guarantee: typing only the street name
 * OR only the number doesn't anchor — you must demonstrate knowledge of
 * the specific intersection of street + door.
 */
function containsStreetNumberPair(qNormalized: string, part: string): boolean {
    const partWords = extractAddressWords(part);
    const partNames = partWords.filter(w => /^[a-z]+$/.test(w));
    const partNumbers = partWords.filter(w => /^\d+$/.test(w));
    if (partNames.length === 0 || partNumbers.length === 0) return false;
    const qWords = new Set(extractAddressWords(qNormalized));
    const hasName = partNames.some(n => qWords.has(n));
    const hasNumber = partNumbers.some(n => qWords.has(n));
    return hasName && hasNumber;
}

function addressMatchesAsAnchor(addressValue: string, qNormalized: string): boolean {
    const parts = addressValue.split(',').map(p => normalizeText(p)).filter(p => p.length >= ADDRESS_PART_MIN_LEN);
    if (parts.length === 0) return false;
    let specific = 0;
    let loose = 0;
    for (const part of parts) {
        const hasDigit = /\d/.test(part);
        const letterCount = part.replace(/[^a-z]/g, '').length;
        const isSpecific = hasDigit && letterCount >= ADDRESS_SPECIFIC_MIN_LETTERS && part.length >= ADDRESS_SPECIFIC_MIN_LEN;
        if (isSpecific) {
            // Substring is the strict-but-narrow check; pair is the
            // looser-but-anti-fishing fallback. Either suffices for an anchor.
            if (qNormalized.includes(part) || containsStreetNumberPair(qNormalized, part)) specific++;
        } else {
            if (queryContainsApprox(qNormalized, part)) loose++;
        }
    }
    return specific >= 1 || loose >= 2;
}

/**
 * Anchor rule for an id entry. The normalized digit-only stored value must
 * appear in the query's digit-only form, with a minimum length to keep short
 * ids from fan-granting. Exact (no Lev-1) — digit typos coincide with
 * neighboring valid ids and are indistinguishable from a guess.
 */
function idMatchesAsAnchor(idValue: string, query: string): boolean {
    const entryDigits = normalizeEntryValue('id', idValue);
    if (entryDigits.length < ID_ANCHOR_MIN_DIGITS) return false;
    const queryDigits = query.replace(/\D/g, '');
    return queryDigits.includes(entryDigits);
}

/**
 * Find the contact entries a discovery query genuinely matched — the basis for
 * a search-match grant ("you see what you searched for"). Two-phase:
 *
 * Phase 1 — ANCHOR (high-confidence match). Any type can anchor when the
 * query matches the stored value at sufficient confidence. The shape-check is
 * type-specific because "specific" means different things per type:
 *  - phone:  the query carries a digit run ≥ PHONE_SEARCH_MIN_DIGITS that is
 *            a substring of the entry's digits. We check each contiguous run
 *            AND the full concatenated digits, so mixed queries
 *            ("808080 Corrientes 3444") and formatted single phones
 *            ("+54 11 2345-6789") both match.
 *  - email:  query contains '@' and is a substring of the entry value.
 *  - social: query is an @handle or URL, and is a substring of the entry value.
 *  - id:     full normalized id digits (≥ 6 chars) appear in the query digits
 *            (formatting-insensitive: "30.123.456" matches "30123456").
 *  - address: comma-tokenized part rule — see addressMatchesAsAnchor.
 *
 * Phase 2 — ANCHORED FRAGMENT RIDE-ALONG (address, id). If something already
 * anchored this adopter in Phase 1, an `address` or `id` entry whose value
 * also appears as a substring of the query (at a lower length threshold)
 * unlocks too. Lets "1123456789 Corrientes" reveal the address fragment
 * alongside the phone. Entries already matched in Phase 1 are skipped.
 *
 * `other` (free-text notes) never auto-unlocks under either phase.
 *
 * `options.anchorRequiredForSecondary` defaults to `true` (discovery context).
 * Set `false` for the on-profile "verify what you know" check that's already
 * scoped to one adopter — the cross-adopter fan-grant concern no longer
 * applies, so Phase 2 runs even without an anchor.
 */
export function matchSearchEntries(
    entries: ContactEntry[],
    query: string,
    options: { anchorRequiredForSecondary?: boolean } = {},
): SearchEntryMatch[] {
    const q = query.trim();
    if (!q) return [];
    const qDigits = q.replace(/\D/g, '');
    const qLower = q.toLowerCase();
    const qNormalized = normalizeText(q);
    // Plausible phone shapes in the query, deduped: the full concatenated
    // digits (catches a single formatted phone like "+54 11 2345-6789" filling
    // the whole query) plus each whitespace-separated token's digits (catches
    // mixed queries, including a phone with internal separators living
    // alongside other text, e.g. "11 2345-6789 Corrientes 3444" → "23456789").
    const phoneCandSet = new Set<string>();
    if (qDigits.length >= PHONE_SEARCH_MIN_DIGITS) phoneCandSet.add(qDigits);
    for (const token of q.split(/\s+/)) {
        const d = token.replace(/\D/g, '');
        if (d.length >= PHONE_SEARCH_MIN_DIGITS) phoneCandSet.add(d);
    }
    const phoneCandidates = [...phoneCandSet];

    // ── Phase 1: any-type anchor ──
    const out: SearchEntryMatch[] = [];
    const matchedHashes = new Set<string>();
    let anchored = false;
    for (const e of entries) {
        let matched = false;
        if (e.type === 'phone') {
            const entryDigits = e.value.replace(/\D/g, '');
            matched = phoneCandidates.some(c => entryDigits.includes(c));
        } else if (e.type === 'email') {
            matched = q.includes('@') && q.length >= 6 && e.value.toLowerCase().includes(qLower);
        } else if (e.type === 'social') {
            // v2.16.0-14: normalize both sides (lowercase + trim + strip
            // leading @) and require EXACT equality. The user's reported case
            // — stored '@handle', typed 'handle' — works because both
            // normalize to 'handle'. Substring matching would let bare-name
            // queries like 'juan' fish out '@juanperez' from any profile;
            // exact match keeps the anti-fishing posture. URLs stored as-is
            // ('https://instagram.com/x') only match a query of the same URL.
            const entryNorm = normalizeEntryValue('social', e.value);
            const qNorm = normalizeEntryValue('social', q);
            matched = qNorm.length >= 4 && entryNorm === qNorm;
        } else if (e.type === 'id') {
            matched = idMatchesAsAnchor(e.value, q);
        } else if (e.type === 'address') {
            // Structured shape: substring of the gated half (streetAndNumber)
            // against the normalized query, OR the looser street+number pair
            // anchor (v2.16.0-18) that lets a query like "cuba 2734" unlock a
            // stored "Calle Cuba 2734 PB 6" without requiring the whole chunk
            // verbatim. Locality is non-gated and not a matcher concern. Min
            // length 5 prevents trivially short streets from fan-granting.
            if (e.streetAndNumber && e.streetAndNumber.trim().length >= 5) {
                const sn = normalizeText(e.streetAndNumber);
                matched = !!sn && (qNormalized.includes(sn) || containsStreetNumberPair(qNormalized, sn));
            } else {
                // Raw / legacy: fall back to the comma-tokenized rule over `value`.
                matched = addressMatchesAsAnchor(e.value, qNormalized);
            }
        }
        if (matched) {
            const hash = hashEntryValue(e.type, e.value);
            if (!matchedHashes.has(hash)) {
                out.push({ entry: e, hash });
                matchedHashes.add(hash);
            }
            anchored = true;
        }
    }

    // ── Phase 2: anchored fragment ride-along (address, id) ──
    const anchorRequired = options.anchorRequiredForSecondary !== false;
    if (anchored || !anchorRequired) {
        const qIdNormalized = qLower.replace(/[^a-z0-9]/g, '');
        for (const e of entries) {
            if (e.type !== 'address' && e.type !== 'id') continue;
            const hash = hashEntryValue(e.type, e.value);
            if (matchedHashes.has(hash)) continue;
            // ids normalize away formatting ("30.123.456" matches "30123456");
            // addresses match as typed (case-insensitive).
            const ev = e.type === 'id'
                ? normalizeEntryValue('id', e.value)
                : e.value.trim().toLowerCase();
            const haystack = e.type === 'id' ? qIdNormalized : qLower;
            if (ev.length >= 4 && haystack.includes(ev)) {
                out.push({ entry: e, hash });
                matchedHashes.add(hash);
            }
        }
    }

    return out;
}

/**
 * Whole-token, case- and accent-insensitive intersection of a name and a
 * query — the basis for a `scope='name_token'` grant. Each whitespace-
 * separated token of the name is checked against the query's tokens
 * (normalized via the tokenizer's `normalizeText`). A token shorter than 2
 * chars is skipped so a single-letter query can't unlock anything. Returns
 * the matched tokens in their original casing/accents — the caller hashes
 * each via `hashNameToken`.
 */
export function matchSearchNameTokens(name: string | null | undefined, query: string): string[] {
    if (!name || !query) return [];
    const queryTokens = new Set(
        query.trim().split(/\s+/).map(t => normalizeText(t)).filter(t => t.length >= 2),
    );
    if (queryTokens.size === 0) return [];
    const out: string[] = [];
    for (const token of name.trim().split(/\s+/)) {
        const normalized = normalizeText(token);
        if (normalized.length >= 2 && queryTokens.has(normalized)) out.push(token);
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
    /** Moderator role in user_profiles (v2.18.10). Treated identically to admin
     *  for PII visibility — full unmasked view, can approve and revoke grants,
     *  sees the "who has access" disclosure. Same trust level as admin for
     *  read; admin still owns write actions like `setAdopterPublic`. */
    isModerator: boolean;
    /** Viewer shares at least one org with the adopter's owner (v2.18.11).
     *  Org-mates get the same `privileged` tier as admin/moderator/editor —
     *  unmask all contact, see "who has access", approve PII requests on
     *  teammate profiles. The audit log + owner notifications are the
     *  trust-but-verify backstop. */
    isOrgMate: boolean;
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
    /** entryRef hashes the viewer has unlocked via `scope='entry'` search-match grants. */
    unlockedEntryHashes: Set<string>;
    /** Normalized-name-token hashes unlocked via `scope='name_token'` grants. */
    unlockedNameTokenHashes: Set<string>;
}

/**
 * Resolve a (viewer, adopter) pair to a visibility verdict. Pure — the caller
 * fetches `isAdmin` / `isEditor` / `grants` (see piiAccessServer.ts).
 */
export function resolveVisibility(input: ResolveVisibilityInput): Visibility {
    const { viewerEmail, ownerEmail, isAdmin, isModerator, isOrgMate, isEditor, grants } = input;
    const privileged = !!viewerEmail && (
        isAdmin || isModerator || isOrgMate || isEditor || (!!ownerEmail && viewerEmail === ownerEmail)
    );
    const live = grants.filter(g => !g.revokedAt);
    const hasAllContactGrant = live.some(g => g.scope === 'all_contact');
    const unlockedEntryHashes = new Set<string>(
        live.filter(g => g.scope === 'entry' && g.entryRef).map(g => g.entryRef as string),
    );
    const unlockedNameTokenHashes = new Set<string>(
        live.filter(g => g.scope === 'name_token' && g.entryRef).map(g => g.entryRef as string),
    );
    const nothingMasked = privileged || hasAllContactGrant;
    const tier: VisibilityTier = privileged
        ? 'full'
        : (hasAllContactGrant || unlockedEntryHashes.size > 0 || unlockedNameTokenHashes.size > 0) ? 'partial' : 'none';
    return { tier, privileged, nothingMasked, hasAllContactGrant, unlockedEntryHashes, unlockedNameTokenHashes };
}

/** A viewer with no email (unauthenticated / unresolved) — everything masked. */
export const NO_ACCESS_VISIBILITY: Visibility = {
    tier: 'none',
    privileged: false,
    nothingMasked: false,
    hasAllContactGrant: false,
    unlockedEntryHashes: new Set(),
    unlockedNameTokenHashes: new Set(),
};

// ── Partial-reveal ────────────────────────────────────────────────────────────

/**
 * Partial-reveal an entry value — shows just enough for a non-privileged viewer
 * to recognize their person ("yes, this is the +54 11 number I have") without
 * exposing the full identifier. The SAME mask shape is used by both the
 * unauthenticated discovery path and the authenticated PII-gating mask, so what
 * an outsider sees is the same in either case.
 *
 *   phone   — first 4 digits visible (country + area), rest replaced (separators kept)
 *   email   — first char of local part, then "•••@<domain>"
 *   social  — URL form → keep "domain[/path-base]/", mask handle. Bare @handle → "@••••"
 *   address — last comma-separated token kept as locality, street masked
 *   id      — fully masked (the row's label already names the type)
 *   other   — passed through unchanged (notes are not contact PII)
 */
export function partialReveal(entry: ContactEntry): ContactEntry {
    if (!entry.value) return entry;
    const mark = (value: string): ContactEntry => ({
        type: entry.type,
        value,
        ...(entry.label ? { label: entry.label } : {}),
        masked: true,
    });
    switch (entry.type) {
        case 'phone': {
            let seen = 0;
            return mark(entry.value.replace(/\d/g, d => (++seen <= 4 ? d : '•')));
        }
        case 'email': {
            const at = entry.value.indexOf('@');
            if (at <= 0) return mark('•••••@•••');
            return mark(`${entry.value.slice(0, 1)}•••${entry.value.slice(at)}`);
        }
        case 'social': {
            const v = entry.value.trim();
            const urlMatch = v.match(/^(https?:\/\/[^/]+\/)/i);
            if (urlMatch) return mark(`${urlMatch[1]}••••`);
            const bareDomain = v.match(/^([\w-]+(?:\.[\w-]+)+\/)/);
            if (bareDomain) return mark(`${bareDomain[1]}••••`);
            if (v.startsWith('@')) return mark('@••••');
            return mark('••••••');
        }
        case 'address': {
            // Structured two-field shape: only `streetAndNumber` is gated;
            // `locality` is non-gated and always visible. Re-derive `value`
            // from the masked half + the visible half so any read site that
            // reads `entry.value` shows the right thing automatically.
            if (entry.streetAndNumber || entry.locality) {
                const maskedStreet = entry.streetAndNumber ? '•••••' : '';
                const locality = entry.locality?.trim() ?? '';
                const value = [maskedStreet, locality].filter(Boolean).join(', ');
                return {
                    type: 'address',
                    value: value || '•••••',
                    ...(entry.label ? { label: entry.label } : {}),
                    ...(entry.streetAndNumber ? { streetAndNumber: maskedStreet } : {}),
                    ...(locality ? { locality } : {}),
                    masked: true,
                };
            }
            // Raw-paste / legacy fall back to the comma-tokenized text heuristic
            // (the last comma-separated chunk is typically the locality).
            // "Corrientes 3444, CABA" → "•••••, CABA". No comma → full mask.
            const source = entry.raw?.trim() || entry.value.trim();
            const lastComma = source.lastIndexOf(',');
            if (lastComma > 0) {
                const locality = source.slice(lastComma + 1).trim();
                if (locality) {
                    const value = `•••••, ${locality}`;
                    return {
                        type: 'address',
                        value,
                        ...(entry.label ? { label: entry.label } : {}),
                        ...(entry.raw ? { raw: value } : {}),
                        masked: true,
                    };
                }
            }
            return mark('•••••••');
        }
        case 'id':
            return mark('••••••');
        case 'alias':
        case 'other':
        default:
            return entry;
    }
}

/**
 * Apply the address partial-reveal rule to a free-text address string
 * (`adopters.addressInfo` column, which isn't a typed contact entry). Last
 * comma-separated token kept as locality; otherwise full mask.
 */
export function partialRevealAddressString(text: string): string {
    const v = text.trim();
    if (!v) return v;
    const lastComma = v.lastIndexOf(',');
    if (lastComma > 0) {
        const locality = v.slice(lastComma + 1).trim();
        if (locality) return `•••••, ${locality}`;
    }
    return '•••••••';
}

/**
 * Initials-only baseline for an adopter name shown to a non-privileged viewer
 * ("Maria Gomez" → "M G"). One letter per whitespace-separated word; preserves
 * the word count so a multi-word name still reads as multi-word. Per-query and
 * per-grant token reveal on top of this baseline is a separate concern.
 *
 * Returns the empty string for empty input; the caller is expected to fall
 * back to the original value if extraction yields nothing meaningful.
 */
export function partialRevealName(name: string | null | undefined): string {
    if (!name) return '';
    return name.trim().split(/\s+/).map(w => w.charAt(0)).filter(Boolean).join(' ');
}

/**
 * Render a name with per-token reveal — the chunk-1 `partialRevealName`
 * initials baseline, plus full reveal for any token the viewer has
 * demonstrated knowing:
 *  - tokens whose hash is in `visibility.unlockedNameTokenHashes` (persistent
 *    `scope='name_token'` grants — auth viewers only),
 *  - tokens that appear (whole word, normalized) in `currentQuery` (transient
 *    reveal — works for unauth too, just doesn't carry across pages).
 *
 * A privileged viewer (owner / editor / admin / all-contact grant) gets the
 * unchanged name. Falls back to the original name if extraction yields the
 * empty string (e.g. a name made of only punctuation).
 */
export function renderName(
    name: string | null | undefined,
    visibility: Visibility,
    currentQuery?: string,
    options: MaskContactOptions = {},
): string {
    // `adopterIsPublic` is the admin "this whole record is publicly known"
    // override — name renders fully alongside the contact bypass (v2.16.0-12+).
    if (visibility.nothingMasked || options.adopterIsPublic) return name ?? '';
    if (!name) return '';

    const queryTokens = currentQuery
        ? new Set(currentQuery.trim().split(/\s+/).map(t => normalizeText(t)).filter(t => t.length >= 2))
        : null;

    const rendered = name.trim().split(/\s+/).map(token => {
        const normalized = normalizeText(token);
        if (normalized.length >= 2) {
            if (visibility.unlockedNameTokenHashes.has(hashNameToken(token))) return token;
            if (queryTokens && queryTokens.has(normalized)) return token;
        }
        return token.charAt(0) || '';
    }).filter(Boolean).join(' ');

    return rendered || name;
}

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
 * entries are always kept. A locked identifier entry is run through
 * `partialReveal` — keeping just enough (country/area for a phone, domain for
 * an email, locality for an address, …) for the viewer to recognise their
 * person without exposing the full value. The entry keeps its type and label
 * and gains `masked: true` so the UI renders it inert (no `tel:` / `mailto:`).
 */
export interface MaskContactOptions {
    /**
     * The whole adopter's `is_public` flag is on AND the
     * `ENABLE_PUBLIC_PROFILES` feature flag is enabled (v2.16.0-12+). When
     * true, every entry bypasses the mask — admin override for "this whole
     * record is publicly known," wins over per-entry `isPublic` (so
     * contributor-added entries are exposed too).
     */
    adopterIsPublic?: boolean;
}

export function maskContactEntries(
    entries: ContactEntry[],
    visibility: Visibility,
    options: MaskContactOptions = {},
): { entries: ContactEntry[]; maskedCount: number } {
    if (visibility.nothingMasked) return { entries, maskedCount: 0 };
    if (options.adopterIsPublic) return { entries, maskedCount: 0 };
    let maskedCount = 0;
    const out = entries.map((e): ContactEntry => {
        // `other` (notes) and `alias` (name-like) are never masked. `alias`
        // mirrors how `adopters.name` itself is treated — name data, not PII.
        if (e.type === 'other' || e.type === 'alias') return e;
        // Per-entry "sourced from a public channel" flag (v2.16.0-12+) —
        // unmasked even for non-privileged viewers. Distinct from
        // `adopterIsPublic`: this only exposes the entry that was itself
        // imported from a public source, NOT later contributor-added entries.
        if (e.isPublic) return e;
        if (visibility.unlockedEntryHashes.has(hashEntryValue(e.type, e.value))) return e;
        maskedCount++;
        return partialReveal(e);
    });
    return { entries: out, maskedCount };
}

/**
 * Mask an adopter's contact fields (`contactInfo`, `contactEntries`,
 * `addressInfo`) against a visibility verdict. Name, family members and notes
 * are NOT contact PII and are untouched.
 */
export function maskAdopterContact(
    adopter: MaskableAdopter,
    visibility: Visibility,
    options: MaskContactOptions = {},
): AdopterContactMask {
    const contactInfo = adopter.contactInfo ?? null;
    const contactEntriesJson = adopter.contactEntries ?? null;
    const addressInfo = adopter.addressInfo ?? null;

    // Either privileged (owner / editor / admin / all-contact grant) or the
    // whole adopter is admin-flagged public — pass everything through.
    if (visibility.nothingMasked || options.adopterIsPublic) {
        return { contactInfo, contactEntries: contactEntriesJson, addressInfo, maskedFieldCount: 0 };
    }

    // Source entries: prefer structured contactEntries; for legacy rows parse
    // the blob so partial-reveal applies there too (no more all-or-nothing
    // placeholder for legacy rows).
    const parsed = deserializeContactEntries(contactEntriesJson);
    const sourceEntries = parsed.length > 0 ? parsed : parseBlobToContactEntries(contactInfo);
    const { entries: maskedEntries, maskedCount } = maskContactEntries(sourceEntries, visibility, options);
    let maskedFieldCount = maskedCount;

    // Re-derive contactInfo from the partial-revealed entries; works for both
    // structured and legacy rows. Only fall back to the placeholder when the
    // blob is non-empty but parses to nothing (extremely rare).
    let maskedContactInfo: string | null;
    if (sourceEntries.length > 0) {
        maskedContactInfo = contactEntriesToBlob(maskedEntries) || null;
    } else if (contactInfo && contactInfo.trim()) {
        maskedContactInfo = MASKED_CONTACT_PLACEHOLDER;
        maskedFieldCount++;
    } else {
        maskedContactInfo = null;
    }

    // addressInfo column (legacy free-text) — apply the same address rule as
    // a structured `address` entry: keep the locality, mask the street.
    let maskedAddress = addressInfo;
    if (addressInfo && addressInfo.trim()) {
        maskedAddress = partialRevealAddressString(addressInfo);
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
const SENTINEL_ACTORS = new Set([
    'unknown', 'anonymous', 'system',
    'form-submission', 'contract-submission', 'contract', 'contract-signed-via-invitation',
]);

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

/**
 * Implicit-access row in the "who has access" disclosure: a user who sees the
 * owner's records' contact PII because they share an organization, not because
 * they requested + were approved (v2.19.25). Not revocable per-adopter — the
 * org-admin manages membership at the org level.
 */
export interface PiiOrgMateAccess {
    granteeEmail: string;
    granteeName: string;
    /** Orgs through which the org-mate is related to the owner (display chips). */
    orgs: Array<{ id: string; name: string }>;
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
        /** v2.19.25: org-mates of the owner who get implicit full-contact
         *  access via shared org membership. Listed alongside (but
         *  visually distinct from) explicit `allContact` grants. */
        orgMates: PiiOrgMateAccess[];
        searchMatchCount: number;
    };
}
