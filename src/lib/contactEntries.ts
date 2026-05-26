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

export type ContactEntryType = 'phone' | 'email' | 'social' | 'id' | 'address' | 'other';

export interface ContactEntry {
    type: ContactEntryType;
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
const TYPE_LABEL: Record<Exclude<ContactEntryType, 'other'>, string> = {
    phone: 'Tel',
    email: 'Email',
    social: 'Redes',
    id: 'Documento',
    address: 'Dirección',
};

/** Order entries appear in the derived blob. */
const BLOB_ORDER: ContactEntryType[] = ['id', 'email', 'phone', 'social', 'address', 'other'];

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
        case 'email':
        case 'social': return value.toLowerCase().trim();
        default: return value.trim().toLowerCase();
    }
}

function dedupe(entries: ContactEntry[]): ContactEntry[] {
    const seen = new Set<string>();
    const out: ContactEntry[] = [];
    for (const e of entries) {
        const key = `${e.type}|${normalizeEntryValue(e.type, e.value)}`;
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
    socials?: Array<string | null | undefined>;
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
    for (const s of parts.socials ?? []) if (s?.trim()) entries.push({ type: 'social', value: s.trim() });
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
    phone: 500, email: 500, social: 500, id: 500, address: 500, other: 4_000,
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
        const valid: ContactEntryType[] = ['phone', 'email', 'social', 'id', 'address', 'other'];
        return parsed
            .filter((e): e is ContactEntry =>
                e && typeof e.value === 'string' && valid.includes(e.type) && e.value.trim().length > 0)
            .slice(0, MAX_ENTRIES)
            .map(e => ({
                type: e.type,
                value: e.value.slice(0, MAX_VALUE_LEN[e.type]),
                ...(e.label ? { label: String(e.label).slice(0, MAX_LABEL_LEN) } : {}),
                ...(e.masked === true ? { masked: true } : {}),
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
