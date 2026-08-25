/**
 * Contact-entry categorization & serialization.
 *
 * Bridges the free-text `adopters.contactInfo` blob and the structured
 * `adopters.contactEntries` JSON column. Pure functions, safe to import on
 * client or server. Categorization reuses the duplicate-detection extractors
 * in ./tokenizer so a paste is classified the same way the dedup index is.
 *
 * Round-trip guarantee: contactEntriesToBlob(parseBlobToContactEntries(blob))
 * preserves every prose line. A note that shares a line with a phone/email is
 * kept as the line's leftover `other` text; the identifier moves to its own
 * typed entry.
 */

import { extractEmails, extractSocials, extractIds, stripIdsFromText, isPlaceholderPhone } from './tokenizer';

export type ContactEntryType = 'phone' | 'email' | 'social' | 'id' | 'address' | 'alias' | 'other';

export type SocialPlatform = 'facebook' | 'instagram' | 'tiktok' | 'x' | 'threads' | 'other';

/** Ordered list for the picker; `host` builds a link from a bare handle. */
export const SOCIAL_PLATFORMS: ReadonlyArray<{ key: SocialPlatform; label: string; host: string | null }> = [
    { key: 'facebook', label: 'Facebook', host: 'facebook.com' },
    { key: 'instagram', label: 'Instagram', host: 'instagram.com' },
    { key: 'tiktok', label: 'TikTok', host: 'tiktok.com' },
    { key: 'x', label: 'X', host: 'x.com' },
    { key: 'threads', label: 'Threads', host: 'threads.net' },
    { key: 'other', label: 'Otra', host: null },
];
const SOCIAL_PLATFORM_KEYS: SocialPlatform[] = SOCIAL_PLATFORMS.map(p => p.key);

/** Deduce the network from a social value. URL/host -> platform; null for a bare handle or an unrecognized URL. */
export function detectSocialPlatform(value: string | null | undefined): SocialPlatform | null {
    const v = (value || '').trim().toLowerCase();
    if (!v) return null;
    if (/(?:^|\/\/|\.)(?:facebook\.com|fb\.com|fb\.me)\b/.test(v)) return 'facebook';
    if (/(?:instagram\.com|instagr\.am)\b/.test(v)) return 'instagram';
    if (/tiktok\.com\b/.test(v)) return 'tiktok';
    if (/(?:^|\.)(?:x\.com|twitter\.com|t\.co)\b/.test(v)) return 'x';
    if (/threads\.(?:net|com)\b/.test(v)) return 'threads';
    return null;
}

/** Resolve a social value to a URL. Full URLs pass through; a bare handle -> https://<host>/<handle>. */
export function socialUrl(value: string, platform?: SocialPlatform | null): string | null {
    const v = (value || '').trim();
    if (!v) return null;
    if (/^https?:\/\//i.test(v)) return v;
    if (/^[\w-]+(\.[\w-]+)+\//.test(v)) return `https://${v}`;
    const host = SOCIAL_PLATFORMS.find(p => p.key === platform)?.host;
    return host ? `https://${host}/${v.replace(/^@+/, '')}` : null;
}

/** Read + validate a stored social entry's platform; deduce from the value when absent. */
function readSocialPlatform(e: { type: ContactEntryType; value: string; platform?: unknown }): { platform?: SocialPlatform } {
    if (e.type !== 'social') return {};
    const stored = SOCIAL_PLATFORM_KEYS.includes(e.platform as SocialPlatform) ? (e.platform as SocialPlatform) : null;
    const p = stored ?? detectSocialPlatform(e.value);
    return p ? { platform: p } : {};
}

export interface ContactEntry {
    type: ContactEntryType;
    /**
     * Stable identifier — assigned on read by `deserializeContactEntries` for
     * any legacy entry that lacks one, persisted on next write. Lets per-entry
     * update / remove target a specific row across reorderings.
     */
    id?: string;
    /**
     * Email of the user who added THIS specific entry. Populated by
     * `addContactEntry` (v2.16.0-9+); undefined for entries that pre-date the
     * field, for entries materialized from the legacy `contactInfo` blob (no
     * attribution available), and for entries inserted by the admin backfill.
     * Used by the UI + the per-entry update/remove server gates to let a
     * contributor edit/remove the entries they themselves added — owner and
     * admin can edit anything regardless.
     */
    addedBy?: string;
    /**
     * True when this specific entry was sourced from a public channel — set
     * by the ImportWizard write path on entries derived from public social
     * posts (v2.16.0-12+). When `ENABLE_PUBLIC_PROFILES` is on the visibility
     * resolver skips masking these entries for any authenticated viewer.
     * Contributor-added entries don't get this flag — their contact info may
     * not be public. The per-profile `adopters.isPublic` is the admin
     * override that exposes ALL entries (including contributor-private ones)
     * for cases where the admin has confirmed the whole record is publicly
     * known.
     */
    isPublic?: boolean;
    /**
     * Canonical rendered string — always populated. For a structured address
     * this is the joined "streetAndNumber, locality"; for a raw-paste address
     * it's the raw text; for any other type it's the value as typed.
     * Read sites (display, dedup, blob, tokenizer) can keep reading `value`
     * unchanged.
     */
    value: string;
    /** Optional display label, e.g. "DNI" / "Documento" for an id entry. */
    label?: string;
    /** For type='social' only: which network this is. Deduced from a URL or picked by the user. */
    platform?: SocialPlatform;
    /**
     * Display-only flag set by the PII-masking layer (src/lib/piiAccess.ts)
     * when this entry's value is hidden from the viewer. Never persisted —
     * saveAdopter re-derives entries from the owner's unmasked form input.
     */
    masked?: boolean;
    /**
     * Address-only structured fields (additive — `value` stays the joined
     * source of truth). `streetAndNumber` is the PII-gated half; `locality`
     * is the non-gated half (locality + city + province + cp combined as a
     * single free-text field). Together they form the new two-field address.
     */
    streetAndNumber?: string;
    locality?: string;
    /**
     * Address escape-hatch: the user opted to type their address as a single
     * free-text blob (rural, informal, "Lote 5 Manzana 12 Barrio X"). When
     * set, the structured fields are absent and the matcher falls back to
     * the comma-tokenized rule on `value`.
     */
    raw?: string;
}

/** Join structured address parts into the canonical `value` string. */
export function joinedAddressValue(streetAndNumber?: string | null, locality?: string | null): string {
    return [streetAndNumber?.trim(), locality?.trim()].filter(Boolean).join(', ');
}

/** True if the entry is an address using the new structured two-field shape. */
export function isStructuredAddress(entry: ContactEntry): boolean {
    return entry.type === 'address' && !!(entry.streetAndNumber || entry.locality);
}

/** True if the entry is an address using the raw-paste escape-hatch shape. */
export function isRawAddress(entry: ContactEntry): boolean {
    return entry.type === 'address' && !!entry.raw && !entry.streetAndNumber && !entry.locality;
}

/** Labels written into the derived contactInfo blob — one line per entry. */
export const TYPE_LABEL: Record<Exclude<ContactEntryType, 'other'>, string> = {
    phone: 'Tel',
    email: 'Email',
    social: 'Redes',
    id: 'Documento',
    address: 'Dirección',
    alias: 'Conocido/a como',
};

/** Order entries appear in the derived blob. */
const BLOB_ORDER: ContactEntryType[] = ['id', 'email', 'phone', 'social', 'address', 'alias', 'other'];

/**
 * Leading label words stripped when computing a line's leftover `other` text,
 * so "Tel: 1123456789" doesn't leave a stray "Tel:" note behind.
 */
const LEADING_LABEL_RE = /^\s*(tel(?:[eé]fono)?|cel(?:ular)?|email|correo|e-?mail|redes?(?:\s+sociales)?|ig|insta(?:gram)?|fb|facebook|documento|doc|dni|cuil|cuit|rut|curp|direcci[oó]n|contacto)\s*[:.\-]?\s*/i;

/**
 * Deliberately-loose strip patterns. Used ONLY to compute a line's leftover
 * text after structured matches are pulled out — never for classification
 * (the ./tokenizer extractors own that). Slight over/under-stripping only
 * affects how a residual note reads, never which entries are produced.
 */
const STRIP_EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const STRIP_SOCIAL = /(?:https?:\/\/)?(?:www\.)?(?:facebook|instagram|fb)\.com\/\S+|(?<![a-zA-Z0-9])@[a-zA-Z0-9._]{2,}/gi;
const STRIP_PHONE = /\d[\d\s().+\-]{5,}\d/g;

/**
 * Address detection (label-first). A line carrying no phone/email/id/social
 * token is classified `address` when it LEADS with one of these keywords:
 *  - LABEL keywords ("Dirección:", "Dir") are markers — stripped from the
 *    stored value.
 *  - STREET keywords ("Av", "Calle") are part of the address itself — kept.
 * Leading-anchored, with an explicit separator/boundary so a longer word that
 * merely starts with the same letters (e.g. "Avísame") does not trip it —
 * note `\b` is ASCII-only and would false-match before an accented letter.
 */
const ADDRESS_LABEL_RE = /^\s*(direcci[oó]n|domicilio|address|direc|dir)[\s.:]+/i;
const ADDRESS_STREET_RE = /^\s*(boulevard|diagonal|avenida|bulevar|manzana|pasaje|barrio|avda|calle|ruta|lote|diag|mza|pje|av|mz)(?=[\s.,]|$)/i;

/**
 * Normalized value used for de-duplication within an entry type, and as the
 * canonical input to the PII search-match / entry-hash logic — every site that
 * compares an entry value (dedup, grant `entryRef` hashing, query matching)
 * MUST normalize through here so the comparisons agree.
 */
export function normalizeEntryValue(type: ContactEntryType, value: string): string {
    switch (type) {
        case 'phone': return value.replace(/\D/g, '');
        case 'id': return value.toLowerCase().replace(/[^a-z0-9]/g, '');
        case 'email': return value.toLowerCase().trim();
        case 'social': {
            // Strip a leading `@` (or whitespace before it) so '@handle' and
            // 'handle' collapse to the same dedup key + hash. Without this,
            // a contributor who types the bare handle creates a duplicate
            // entry AND a grant against a different hash than the existing
            // '@handle' chip — the existing chip stays masked (v2.16.0-14).
            // URLs ('https://...', 'instagram.com/...') keep their full form;
            // the substring-match path in matchSearchEntries handles
            // cross-form lookups.
            return value.toLowerCase().trim().replace(/^@+/, '');
        }
        default: return value.trim().toLowerCase();
    }
}

/**
 * Derive a stable id for a legacy entry that lacks one in its persisted
 * JSON. Both client and server independently call `deserializeContactEntries`
 * — using `crypto.randomUUID()` here would assign a different id to the
 * SAME entry on each call, breaking the per-entry update/remove round-trip
 * (the client sends id A, the server's re-deserialize sees id B, lookup
 * fails with "Entry not found"). Deriving the id deterministically from
 * `type|normalizedValue` makes both sides agree.
 *
 * Format: `legacy-<8hex>-<8hex>` so it visually distinguishes itself from
 * a real crypto.randomUUID() output (which uses canonical 8-4-4-4-12
 * hyphen grouping). Once any per-entry mutation writes the row back, the
 * persisted JSON carries this id and the deterministic path stops firing
 * for that entry.
 */
export function deriveStableLegacyId(type: ContactEntryType, value: string): string {
    const key = `${type}|${normalizeEntryValue(type, value)}`;
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < key.length; i++) {
        const ch = key.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    const a = (h1 >>> 0).toString(16).padStart(8, '0');
    const b = (h2 >>> 0).toString(16).padStart(8, '0');
    return `legacy-${a}-${b}`;
}

/**
 * Derive the street/number portion of an address entry's two-field form
 * from whatever the entry actually carries. For an entry already in the
 * structured shape (`streetAndNumber` set), return that. For a legacy
 * single-`value` entry, fall back to splitting on the first comma so
 * "MAIPU 800, CABA" → street="MAIPU 800". No comma → return the whole
 * value as the street.
 *
 * Used by both `ContactEntriesInput` (bulk edit on ImportWizard) and
 * `ContactEntriesSection` (per-entry inline edit) so legacy address rows
 * render with their existing value pre-filled in the edit form instead of
 * empty.
 */
export function deriveStreet(entry: ContactEntry): string {
    if (typeof entry.streetAndNumber === 'string') return entry.streetAndNumber;
    const v = entry.value || '';
    const firstComma = v.indexOf(',');
    return firstComma > 0 ? v.slice(0, firstComma).trim() : v.trim();
}

/** Companion to deriveStreet — extracts the locality half for legacy single-value entries. */
export function deriveLocality(entry: ContactEntry): string {
    if (typeof entry.locality === 'string') return entry.locality;
    const v = entry.value || '';
    const firstComma = v.indexOf(',');
    return firstComma > 0 ? v.slice(firstComma + 1).trim() : '';
}

function dedupe(entries: ContactEntry[]): ContactEntry[] {
    const seen = new Set<string>();
    const out: ContactEntry[] = [];
    for (const e of entries) {
        const key = e.type === 'social'
            ? `social|${normalizeEntryValue('social', e.value)}|${e.platform ?? ''}`
            : `${e.type}|${normalizeEntryValue(e.type, e.value)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(e);
    }
    return out;
}

/** Leftover prose of a line after structured identifiers are stripped out. */
function residualOf(line: string): string {
    let s = stripIdsFromText(line);
    s = s.replace(STRIP_EMAIL, ' ').replace(STRIP_SOCIAL, ' ').replace(STRIP_PHONE, ' ');
    s = s.replace(LEADING_LABEL_RE, '');
    s = s.replace(/\s+/g, ' ').trim();
    s = s.replace(/^[\s,;:.\-|/]+|[\s,;:.\-|/]+$/g, '').trim();
    return s;
}

/** A leftover is real prose only if it has at least one letter. */
function isMeaningfulProse(s: string): boolean {
    return s.length >= 2 && /[a-zA-Z]/.test(s);
}

/**
 * Classify a free-text fragment (one with no phone/email/id/social token) as
 * an `address` or a plain `other` note — see ADDRESS_LABEL_RE / ADDRESS_STREET_RE.
 * Detection is label-first and conservative; the chip UI's type selector is
 * the safety net for the cases a heuristic gets wrong.
 */
function addressOrOther(text: string): ContactEntry {
    const t = text.trim();
    const labelMatch = t.match(ADDRESS_LABEL_RE);
    if (labelMatch) {
        const value = t.slice(labelMatch[0].length).trim();
        if (value) return { type: 'address', value };
    } else if (ADDRESS_STREET_RE.test(t)) {
        return { type: 'address', value: t };
    }
    return { type: 'other', value: t };
}

/**
 * Phone-like runs in a line, with the user's original formatting preserved.
 * Mirrors the "is it a phone" decision of tokenizer.extractPhones (a run of
 * 7+ digits, not a known placeholder) but keeps the matched substring verbatim
 * — so "11 2345-6789" survives as the user typed it instead of collapsing to
 * "1123456789". Dedup (normalizeEntryValue) and the duplicate-token index
 * normalize to digits anyway, so a formatted stored value is safe.
 */
const PHONE_RUN_RE = /\+?\(?\d[\d\s().+\-]{5,}\d/g;
function formattedPhonesIn(text: string): string[] {
    const out: string[] = [];
    for (const run of text.match(PHONE_RUN_RE) || []) {
        const digits = run.replace(/\D/g, '');
        if (digits.length >= 7 && !isPlaceholderPhone(digits)) out.push(run.trim());
    }
    return out;
}

/**
 * Categorize free-text (a paste, or a legacy contactInfo blob) into typed
 * contact entries. Unlabeled numbers land as `phone` by design — the chip UI
 * is where the user reclassifies them to `id`.
 *
 * Categorization runs per line: extractPhones strips whitespace (including
 * newlines) before matching digit runs, so feeding it the whole blob would
 * merge two phones on adjacent lines into one number.
 */
export function categorizeContactText(text: string | null | undefined): ContactEntry[] {
    if (!text || !text.trim()) return [];

    const entries: ContactEntry[] = [];

    for (const rawLine of text.split(/\r?\n/)) {
        if (!rawLine.trim()) continue;

        const ids = extractIds(rawLine);
        const phones = formattedPhonesIn(stripIdsFromText(rawLine));
        const emails = extractEmails(rawLine);
        const socials = extractSocials(rawLine);

        for (const id of ids) entries.push({ type: 'id', value: id });
        for (const phone of phones) entries.push({ type: 'phone', value: phone });
        for (const email of emails) entries.push({ type: 'email', value: email });
        for (const social of socials) entries.push({ type: 'social', value: social });

        // Keep prose so blob round-trips never drop notes. A line with no
        // structured token is kept verbatim; a line that also had a note
        // alongside an identifier keeps the note as leftover text.
        if (ids.length || phones.length || emails.length || socials.length) {
            const leftover = residualOf(rawLine);
            if (isMeaningfulProse(leftover)) entries.push(addressOrOther(leftover));
        } else {
            entries.push(addressOrOther(rawLine));
        }
    }

    return dedupe(entries);
}

/** Best-effort parse of a legacy contactInfo blob into typed entries. */
export function parseBlobToContactEntries(blob: string | null | undefined): ContactEntry[] {
    return categorizeContactText(blob);
}

/**
 * Derive the labeled `contactInfo` blob from entries — one line per entry.
 * `other` entries are written verbatim so a parse→derive round-trip keeps
 * all prose. Existing LIKE search, tokenization and display read this blob
 * unchanged.
 */
export function contactEntriesToBlob(entries: ContactEntry[] | null | undefined): string {
    if (!entries || entries.length === 0) return '';
    const lines: string[] = [];
    for (const type of BLOB_ORDER) {
        for (const e of entries) {
            if (e.type !== type) continue;
            const v = e.value.trim();
            if (!v) continue;
            if (type === 'other') {
                lines.push(v);
            } else {
                const label = (type === 'id' && e.label?.trim()) ? e.label.trim() : TYPE_LABEL[type];
                lines.push(`${label}: ${v}`);
            }
        }
    }
    return lines.join('\n');
}

interface ContactParts {
    /** Personal IDs — strings, or {value,label} when the label is known. */
    ids?: Array<string | { value: string; label?: string }>;
    phones?: Array<string | null | undefined>;
    emails?: Array<string | null | undefined>;
    socials?: Array<string | { value: string; platform?: SocialPlatform } | null | undefined>;
    addresses?: Array<string | null | undefined>;
}

/**
 * Build entries from already-structured parts (Gemini extraction arrays in the
 * ImportWizard, discrete form fields in the contract factory). De-duplicated.
 */
export function buildContactEntries(parts: ContactParts): ContactEntry[] {
    const entries: ContactEntry[] = [];
    for (const id of parts.ids ?? []) {
        if (typeof id === 'string') {
            if (id.trim()) entries.push({ type: 'id', value: id.trim() });
        } else if (id?.value?.trim()) {
            entries.push({ type: 'id', value: id.value.trim(), ...(id.label?.trim() ? { label: id.label.trim() } : {}) });
        }
    }
    for (const p of parts.phones ?? []) if (p?.trim()) entries.push({ type: 'phone', value: p.trim() });
    for (const e of parts.emails ?? []) if (e?.trim()) entries.push({ type: 'email', value: e.trim() });
    for (const s of parts.socials ?? []) {
        const val = typeof s === 'string' ? s : s?.value;
        if (!val?.trim()) continue;
        const platform = (typeof s === 'object' && s?.platform) ? s.platform : (detectSocialPlatform(val) ?? undefined);
        entries.push({ type: 'social', value: val.trim(), ...(platform ? { platform } : {}) });
    }
    for (const a of parts.addresses ?? []) if (a?.trim()) entries.push({ type: 'address', value: a.trim() });
    return dedupe(entries);
}

/** Upper bounds applied when reading stored/untrusted entry JSON. */
const MAX_ENTRIES = 50;
const MAX_LABEL_LEN = 40;
/**
 * Per-type value cap. Identifiers are short; `other` holds free-text prose
 * (a legacy blob's notes round-trip through it) so it gets a generous cap to
 * avoid silently clipping a long note on save.
 */
const MAX_VALUE_LEN: Record<ContactEntryType, number> = {
    phone: 500, email: 500, social: 500, id: 500, address: 500, alias: 200, other: 4_000,
};

/**
 * Parse the JSON stored in adopters.contactEntries. Returns [] on bad data.
 * Drops malformed and empty-value entries and bounds count + value/label
 * length — the single sanitization chokepoint for untrusted entry JSON.
 */
export function deserializeContactEntries(json: string | null | undefined): ContactEntry[] {
    if (!json) return [];
    try {
        const parsed = JSON.parse(json);
        if (!Array.isArray(parsed)) return [];
        const valid: ContactEntryType[] = ['phone', 'email', 'social', 'id', 'address', 'alias', 'other'];
        return parsed
            .filter((e): e is ContactEntry =>
                e && typeof e.value === 'string' && valid.includes(e.type) && e.value.trim().length > 0)
            .slice(0, MAX_ENTRIES)
            .map(e => ({
                // Legacy entries (pre-2.16) had no `id`; assign one on read. Use a
                // deterministic hash of type+normalizedValue so client and server
                // independently derive the SAME id for the same entry — without
                // this, every deserialize would produce different UUIDs and the
                // per-entry update/remove round-trip would fail with
                // "Entry not found" (see v2.16.0-13). Real-id entries keep theirs.
                id: typeof e.id === 'string' && e.id.trim()
                    ? e.id
                    : deriveStableLegacyId(e.type, e.value),
                type: e.type,
                value: e.value.slice(0, MAX_VALUE_LEN[e.type]),
                ...(e.label ? { label: String(e.label).slice(0, MAX_LABEL_LEN) } : {}),
                ...readSocialPlatform(e),
                ...(e.masked === true ? { masked: true } : {}),
                // Per-entry contributor attribution (v2.16.0-9+). Length-capped
                // defensively; undefined if absent (most pre-existing rows).
                ...(typeof e.addedBy === 'string' && e.addedBy.trim()
                    ? { addedBy: e.addedBy.slice(0, 256) }
                    : {}),
                // Per-entry "sourced from a public channel" flag (v2.16.0-12+).
                // Stored only when explicitly true to keep the JSON tight.
                ...(e.isPublic === true ? { isPublic: true } : {}),
                // Structured-address additive fields. Only kept for type='address';
                // ignored on any other type even if a malformed row carries them.
                ...(e.type === 'address' && typeof e.streetAndNumber === 'string' && e.streetAndNumber.trim()
                    ? { streetAndNumber: e.streetAndNumber.slice(0, MAX_VALUE_LEN.address) }
                    : {}),
                ...(e.type === 'address' && typeof e.locality === 'string' && e.locality.trim()
                    ? { locality: e.locality.slice(0, MAX_VALUE_LEN.address) }
                    : {}),
                ...(e.type === 'address' && typeof e.raw === 'string' && e.raw.trim()
                    ? { raw: e.raw.slice(0, MAX_VALUE_LEN.address) }
                    : {}),
            }));
    } catch {
        return [];
    }
}

/** Merge two entry lists, de-duplicating on normalized value. */
export function mergeContactEntries(a: ContactEntry[], b: ContactEntry[]): ContactEntry[] {
    return dedupe([...a, ...b]);
}
