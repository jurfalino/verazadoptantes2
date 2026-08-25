/**
 * Tokenizer for duplicate adopter detection.
 * 
 * Pure functions that extract matchable tokens from adopter data.
 * Tokens are stored in the duplicate_tokens table and used to find
 * adopters that share identifiers (phones, emails, names, etc.)
 */

export type TokenType = 'name_full' | 'name_word' | 'phone' | 'phone_suffix' | 'email' | 'social' | 'social_handle' | 'address_word' | 'source_url' | 'id_number';

export interface Token {
    type: TokenType;
    value: string;
}

// ── Normalization ────────────────────────────────────────────────

/**
 * Lowercase, trim, and strip diacritics from text using Unicode NFD decomposition.
 * NFD splits accented characters into base + combining mark (e.g. 'á' → 'a' + ◌́),
 * then the regex removes all combining marks in the U+0300–U+036F block.
 * This covers the full Latin accent range including uppercase variants (Á, É, Ñ, Ü…)
 * and edge cases the old ACCENT_MAP missed (e.g. Ç, œ, ß are handled by the base layer).
 */
export function normalizeText(s: string): string {
    return s
        .toLowerCase()
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

// ── Phone Extraction ─────────────────────────────────────────────

const _MIN_PHONE_DIGITS = 7;
const PHONE_SUFFIX_LENGTH = 8;
const MIN_PHONE_FOR_SUFFIX = 9;

/**
 * Placeholder/dummy phone values that should never tokenize. Conservative list:
 * only patterns mathematically near-impossible to be a real phone (all-same-digit
 * with 7+ repeats) plus a tiny explicit set of well-known dummies. Monotonic
 * sequences like 23456789 are deliberately NOT filtered — they can be legit local
 * numbers.
 */
const PLACEHOLDER_PHONES = new Set([
    '1234567', '12345678', '123456789', '1234567890', '0123456789',
]);

export function isPlaceholderPhone(digits: string): boolean {
    if (/^(\d)\1{6,}$/.test(digits)) return true; // 0000000, 9999999999, etc.
    return PLACEHOLDER_PHONES.has(digits);
}

/** Extract phone digit sequences from free text */
export function extractPhones(text: string): string[] {
    if (!text) return [];
    // Remove common separators, then find digit sequences
    const cleaned = text.replace(/[\s\-\.\(\)\+]/g, '');
    const matches = cleaned.match(/\d{7,}/g) || [];
    return [...new Set(matches)].filter(p => !isPlaceholderPhone(p));
}

/** Get phone suffix tokens (last 8 digits) for area-code-agnostic matching */
export function extractPhoneSuffixes(phones: string[]): string[] {
    const suffixes: string[] = [];
    for (const phone of phones) {
        if (phone.length >= MIN_PHONE_FOR_SUFFIX) {
            suffixes.push(phone.slice(-PHONE_SUFFIX_LENGTH));
        }
    }
    return [...new Set(suffixes)];
}

// ── Personal ID Extraction ───────────────────────────────────────

/**
 * Labels we recognize as preceding a personal identification number. Lowercased
 * for case-insensitive match. Covers Argentina, Chile, Mexico, Colombia, Peru,
 * Spain, Uruguay, Ecuador, Venezuela, Bolivia, Paraguay, Brazil, and generic
 * "Pasaporte / Passport / Cédula / Documento" usage.
 *
 * Why label-driven: an unlabeled 7-8 digit sequence is ambiguous with a phone.
 * Routing only labeled IDs to `id_number` is the conservative call — it never
 * misclassifies a phone as an ID, and existing-record phones stay matchable.
 * Unlabeled IDs continue to (incorrectly) tokenize as phones; a future pass can
 * tighten this with locale-aware heuristics.
 */
const ID_LABELS = [
    // Argentina
    'dni', 'cuit', 'cuil', 'le', 'lc',
    // Chile
    'rut', 'run',
    // Mexico
    'curp', 'rfc', 'ine',
    // Colombia
    'cc', 'ce', 'ti', 'nuip',
    // Peru (DNI shared with Arg/Spain), CE shared
    // Spain
    'nie', 'nif', 'cif',
    // Uruguay/Ecuador/Bolivia/Paraguay/Venezuela
    'ci',
    // Brazil
    'cpf', 'cnpj', 'rg',
    // Generic
    'pasaporte', 'passport', 'cedula', 'cédula', 'documento', 'doc',
];

const ID_LABEL_REGEX = new RegExp(
    // \b(label) [optional . :] whitespace? (value: a single token — alnum start/end,
    // internal dots/dashes/slashes only, NO whitespace). Whitespace inside the value
    // would let "DNI 12345678 y tel 5555555" eat the phone digits — that's a worse
    // failure than missing a rarely-written "DNI 12 345 678" form.
    `\\b(${ID_LABELS.join('|')})\\b\\s*[:.]?\\s*([A-Za-z0-9][A-Za-z0-9.\\-/]{3,30}[A-Za-z0-9])`,
    'gi',
);

/**
 * Normalize an ID value: lowercase + strip everything except [a-z0-9].
 * Examples:
 *  - "12.345.678-9" → "123456789"
 *  - "ABCD123456EFGHIJ01" → "abcd123456efghij01"
 *  - "V-12345678" → "v12345678"
 */
function normalizeIdValue(raw: string): string {
    return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Extract labeled personal-ID numbers (DNI, RUT, RUN, CURP, RFC, CC, CPF, …).
 *
 * Filtering rules (false-positive control):
 *  - Normalized length ≥ 5 — guards against "DNI ok" trivially capturing "ok".
 *  - At least 4 digits — every real ID format has ≥ 4 digits, while accidental
 *    matches like "le di un libro" or "Cc: name@example.com" have 0–1. This is
 *    what makes short / common labels (LE, LC, CC, CE, TI, CI, RG, …) safe to
 *    enable in regular Spanish/Portuguese prose.
 */
export function extractIds(text: string): string[] {
    if (!text) return [];
    const out = new Set<string>();
    for (const m of text.matchAll(ID_LABEL_REGEX)) {
        const norm = normalizeIdValue(m[2] || '');
        if (norm.length < 5) continue;
        const digitCount = (norm.match(/\d/g) || []).length;
        if (digitCount < 4) continue;
        out.add(norm);
    }
    return [...out];
}

/**
 * Return the input text with all VALID labeled-ID matches replaced by spaces,
 * so a subsequent extractPhones() call cannot also tokenize the same digits as
 * a phone. Matches that fail extractIds's digit-count filter are left alone —
 * otherwise a sentence like "le di 1234567 al cliente" would suppress the real
 * phone digits without ever creating an id_number token.
 */
export function stripIdsFromText(text: string): string {
    if (!text) return '';
    return text.replace(ID_LABEL_REGEX, (full, _label, value) => {
        const norm = normalizeIdValue(value || '');
        const digitCount = (norm.match(/\d/g) || []).length;
        return (norm.length >= 5 && digitCount >= 4) ? ' ' : full;
    });
}

// ── Email Extraction ─────────────────────────────────────────────

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

/** Extract email addresses from free text */
export function extractEmails(text: string): string[] {
    if (!text) return [];
    const matches = text.match(EMAIL_REGEX) || [];
    return [...new Set(matches.map(e => e.toLowerCase()))];
}

// ── Social Profile Extraction ────────────────────────────────────

const SOCIAL_PATTERNS = [
    // Facebook profile URLs
    /(?:https?:\/\/)?(?:www\.)?facebook\.com\/(?:profile\.php\?id=\d+|[a-zA-Z0-9.]+)/gi,
    /(?:https?:\/\/)?(?:www\.)?fb\.com\/[a-zA-Z0-9.]+/gi,
    // Instagram handles. The negative lookbehind keeps the @ from matching inside
    // email addresses — without it, "mpelli@gmail.com" produced a fake "@gmail.com"
    // social token and every Gmail user got paired with every other Gmail user as
    // a "medium-confidence duplicate by social handle".
    /(?<![a-zA-Z0-9])@[a-zA-Z0-9._]{3,30}/g,
    // Instagram URLs
    /(?:https?:\/\/)?(?:www\.)?instagram\.com\/[a-zA-Z0-9._]+/gi,
    // TikTok / X (Twitter) / Threads profile URLs
    /(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@?[a-zA-Z0-9._]+/gi,
    /(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/[a-zA-Z0-9._]+/gi,
    /(?:https?:\/\/)?(?:www\.)?threads\.(?:net|com)\/@?[a-zA-Z0-9._]+/gi,
];

/** Extract social media handles/URLs from free text */
export function extractSocials(text: string): string[] {
    if (!text) return [];
    const results: string[] = [];
    for (const pattern of SOCIAL_PATTERNS) {
        const matches = text.match(pattern) || [];
        results.push(...matches.map(m => m.toLowerCase().replace(/^https?:\/\/(www\.)?/, '')));
    }
    return [...new Set(results)];
}

/**
 * Detect the social network from a value's URL/host. Mirrors
 * `contactEntries.detectSocialPlatform`, duplicated here so the tokenizer stays
 * free of the contactEntries import (documented circular dependency). Returns
 * null for a bare handle (no host to key on).
 */
export function detectSocialPlatformFromValue(value: string): 'facebook' | 'instagram' | 'tiktok' | 'x' | 'threads' | null {
    const v = (value || '').trim().toLowerCase();
    if (!v) return null;
    if (/(?:^|\/\/|\.)(?:facebook\.com|fb\.com|fb\.me)\b/.test(v)) return 'facebook';
    if (/(?:instagram\.com|instagr\.am)\b/.test(v)) return 'instagram';
    if (/tiktok\.com\b/.test(v)) return 'tiktok';
    if (/(?:^|\.)(?:x\.com|twitter\.com|t\.co)\b/.test(v)) return 'x';
    if (/threads\.(?:net|com)\b/.test(v)) return 'threads';
    return null;
}

/**
 * Reduce a social value (URL or @handle) to its stable handle/id — the single
 * source of truth shared by the tokenizer (index) and findAdopters (query).
 *
 * Facebook is the exception: its identity is usually the numeric profile id in
 * the URL (`profile.php?id=N` or `/people/.../N`), not a path segment — a naive
 * "last path segment" rule would collapse every numeric-id FB profile to the
 * garbage handle "profile.php". IG/TikTok/X/Threads put the username in the last
 * path segment. Returns null when no handle is derivable (bare domain, <3 chars).
 * `platform` (from a structured entry) lets a host-less bare handle resolve
 * correctly (e.g. a bare "@juan" saved under a Facebook entry).
 */
export function normalizeSocialHandle(value: string, platform?: string | null): string | null {
    let v = (value || '').toLowerCase().trim();
    if (!v) return null;
    const url = v.replace(/^https?:\/\//, '').replace(/^www\.|^m\.|^web\./, '');
    const isFb = /^(facebook\.com|fb\.com|fb\.me)\b/.test(url) || platform === 'facebook';
    if (isFb) {
        const numeric = url.match(/(?:profile\.php\?id=|\/people\/[^/]*\/)(\d{5,})/) || value.match(/\bid=(\d{5,})\b/);
        if (numeric) return `id:${numeric[1]}`;
        const vanity = url.match(/^(?:facebook\.com|fb\.com|fb\.me)\/([a-z0-9.]+)/);
        if (vanity && vanity[1] !== 'profile.php') return vanity[1].replace(/^@+/, '');
        if (!url.includes('/') && !url.includes('.com')) return v.replace(/^@+/, '') || null;
        return null;
    }
    v = v.replace(/^@+/, '').replace(/^https?:\/\//, '').replace(/^www\./, '');
    // Only strip a host when there is an actual path (a slash). A bare handle can
    // legitimately contain dots (e.g. "maria.gonzalez" — the most common Instagram
    // form) and must NOT be misread as a domain (that returned null before).
    if (v.includes('/')) {
        const path = v.slice(v.indexOf('/') + 1).replace(/[?#].*$/, '').replace(/\/+$/, '');
        if (!path) return null; // host with no path segment (bare domain)
        v = (path.split('/').filter(Boolean).pop() || '').replace(/^@+/, '');
    } else if (detectSocialPlatformFromValue(v)) {
        return null; // a bare social domain (e.g. "instagram.com") carries no handle
    }
    if (!v || v.length < 3) return null;
    return v;
}

// ── Name Word Extraction ─────────────────────────────────────────

const MIN_NAME_WORD_LENGTH = 3;

/** Extract normalized name words from a text that may contain names */
export function extractNameWords(text: string): string[] {
    if (!text) return [];
    const normalized = normalizeText(text);
    // Split on spaces, commas, semicolons, slashes, pipes
    return normalized
        .split(/[\s,;\/|]+/)
        .map(w => w.replace(/[^a-z]/g, ''))
        .filter(w => w.length >= MIN_NAME_WORD_LENGTH);
}

// ── Address Word Extraction ──────────────────────────────────────

/** Spanish address stopwords to filter out */
const ADDRESS_STOPWORDS = new Set([
    'calle', 'av', 'avenida', 'barrio', 'nro', 'numero', 'piso',
    'dto', 'depto', 'departamento', 'casa', 'manzana', 'lote',
    'entre', 'esquina', 'esq', 'bis', 'interior', 'local',
    'planta', 'baja', 'alta', 'bloque', 'torre', 'edificio',
    'col', 'colonia', 'cp', 'codigo', 'postal', 'ciudad',
    'provincia', 'partido', 'localidad', 'zona', 'sector',
    'pasaje', 'pje', 'boulevard', 'blvd', 'ruta', 'km',
    'kilometro', 'del', 'de', 'la', 'las', 'los', 'el', 'san', 'santa',
]);

/** Extract meaningful address words (skip stopwords and short numbers) */
export function extractAddressWords(text: string): string[] {
    if (!text) return [];
    const normalized = normalizeText(text);
    return normalized
        .split(/[\s,;\/|]+/)
        .map(w => w.replace(/[^a-z0-9]/g, ''))
        .filter(w => {
            if (w.length < MIN_NAME_WORD_LENGTH) return false;
            if (ADDRESS_STOPWORDS.has(w)) return false;
            // Keep numbers only if 3+ digits (street numbers)
            if (/^\d+$/.test(w) && w.length < 3) return false;
            return true;
        });
}

// ── Token Hash ───────────────────────────────────────────────────

/**
 * Bump this whenever any extractor below changes shape — regex, label list,
 * placeholder filter, dedup rules, anything that could produce a different
 * token set for the same input. The constant is prefixed into the hash so a
 * version bump invalidates every stored adopter.tokenHash, which forces the
 * /admin/duplicates Scan to re-tokenize on the next run.
 *
 * v1: original tokenizer (pre-v2.14.10-22)
 * v2: bg-indigo/UX redesign era — added placeholder phone filter, harvest
 *     across all fields, id_number extractor, social regex lookbehind (v31).
 *     The lookbehind was the trigger: without a version bump, every record's
 *     hash still matched the old extractor output and Scan skipped them,
 *     keeping the bogus @gmail.com social tokens alive.
 */
const TOKENIZER_VERSION = 'v4'; // v4: dual social tokens (social=platform|handle + social_handle), platform-aware handle normalization (v2.4x)

/** Compute a simple hash of all tokenizable fields for freshness tracking */
export function computeTokenHash(adopter: {
    name: string;
    contactInfo?: string | null;
    addressInfo?: string | null;
    familyMembers?: string | null;
    sourceUrl?: string | null;
}): string {
    const parts = [
        TOKENIZER_VERSION,
        adopter.name || '',
        adopter.contactInfo || '',
        adopter.addressInfo || '',
        adopter.familyMembers || '',
        adopter.sourceUrl || '',
    ].join('|');

    // Simple string hash (djb2)
    let hash = 5381;
    for (let i = 0; i < parts.length; i++) {
        hash = ((hash << 5) + hash + parts.charCodeAt(i)) & 0xffffffff;
    }
    return hash.toString(36);
}

// ── Main Token Extraction ────────────────────────────────────────

interface AdopterData {
    name: string;
    contactInfo?: string | null;
    addressInfo?: string | null;
    familyMembers?: string | null;
    sourceUrl?: string | null;
}

interface AdoptionData {
    onBehalfOf?: string | null;
}

/**
 * Extract all tokens from an adopter record and its related adoptions.
 * Returns a deduplicated array of tokens.
 *
 * `aliases` (optional): values of `contactEntries` rows with `type='alias'`.
 * Aliases (aka) AND family/household members are treated as FIRST-CLASS names —
 * emitted as both name_full (exact, high-weight) and name_word — because an
 * abuser may try to adopt under a relative's or an alias name, so those names
 * must be searchable and must raise duplicate matches exactly like the record's
 * own name. Callers deserialize `adopter.contactEntries` themselves to avoid the
 * tokenizer → contactEntries circular import.
 */
export function extractTokens(adopter: AdopterData, adoptions?: AdoptionData[], aliases?: string[], socials?: Array<{ value: string; platform?: string | null }>): Token[] {
    const tokens: Token[] = [];
    const seen = new Set<string>();

    function add(type: TokenType, value: string) {
        const key = `${type}:${value}`;
        if (!seen.has(key)) {
            seen.add(key);
            tokens.push({ type, value });
        }
    }

    // 1. Full normalized name(s) — the canonical name PLUS aliases and family
    //    members, all treated as first-class names (an abuser may adopt under a
    //    relative's or alias name). name_full = exact, high-weight match.
    const fullNameSources = [adopter.name, adopter.familyMembers, ...(aliases ?? [])];
    for (const src of fullNameSources) {
        if (!src) continue;
        const fullName = normalizeText(src);
        if (fullName.length >= MIN_NAME_WORD_LENGTH) add('name_full', fullName);
    }

    // 2. Name words — from name, familyMembers, adoption.onBehalfOf, and
    //    `alias`-type contact entries (alternate names a person is known by).
    const nameSources = [
        adopter.name,
        adopter.familyMembers,
    ];
    if (adoptions) {
        for (const adoption of adoptions) {
            if (adoption.onBehalfOf) {
                nameSources.push(adoption.onBehalfOf);
            }
        }
    }
    if (aliases) {
        for (const alias of aliases) {
            if (alias) nameSources.push(alias);
        }
    }
    for (const source of nameSources) {
        if (source) {
            for (const word of extractNameWords(source)) {
                add('name_word', word);
            }
        }
    }

    // 3-6. Phones / emails / socials / ID numbers — harvest across ALL free-text
    // fields, not just contactInfo. Prevents a phone typed in the name or address
    // field from fragmenting into name_word / address_word digit tokens.
    //
    // Ordering matters: extract IDs first (labeled DNI / RUT / CURP / …), then
    // strip those substrings before phone extraction so a "DNI: 12345678" doesn't
    // also tokenize as a phone.
    const allText = [
        adopter.contactInfo || '',
        adopter.name || '',
        adopter.addressInfo || '',
        adopter.familyMembers || '',
    ].join('\n');

    for (const id of extractIds(allText)) add('id_number', id);

    const phoneText = stripIdsFromText(allText);
    const phones = extractPhones(phoneText);
    for (const phone of phones) add('phone', phone);
    for (const suffix of extractPhoneSuffixes(phones)) add('phone_suffix', suffix);

    for (const email of extractEmails(allText)) add('email', email);
    // Social tokens — DUAL emission (see normalizeSocialHandle): a platform-agnostic
    // `social_handle` (always, so a bare-handle query still matches) plus a precise
    // `social` = `platform|handle` when the network is known. Sources: structured
    // contactEntries socials (carry `platform`) + socials harvested from the blob.
    const socialSources: Array<{ value: string; platform?: string | null }> = [
        ...(socials ?? []),
        ...extractSocials(allText).map(v => ({ value: v, platform: null as string | null })),
    ];
    for (const src of socialSources) {
        const platform = (src.platform && src.platform !== 'other')
            ? src.platform
            : detectSocialPlatformFromValue(src.value);
        const handle = normalizeSocialHandle(src.value, platform);
        if (!handle) continue;
        add('social_handle', handle);
        if (platform) add('social', `${platform}|${handle}`);
    }

    // 6. Address words
    for (const word of extractAddressWords(adopter.addressInfo || '')) {
        add('address_word', word);
    }

    // 7. Source URL
    if (adopter.sourceUrl) {
        add('source_url', adopter.sourceUrl);
    }

    return tokens;
}
