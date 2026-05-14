/**
 * Tokenizer for duplicate adopter detection.
 * 
 * Pure functions that extract matchable tokens from adopter data.
 * Tokens are stored in the duplicate_tokens table and used to find
 * adopters that share identifiers (phones, emails, names, etc.)
 */

export type TokenType = 'name_full' | 'name_word' | 'phone' | 'phone_suffix' | 'email' | 'social' | 'address_word' | 'source_url';

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
    // Instagram handles
    /@[a-zA-Z0-9._]{3,30}/g,
    // Instagram URLs
    /(?:https?:\/\/)?(?:www\.)?instagram\.com\/[a-zA-Z0-9._]+/gi,
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

/** Compute a simple hash of all tokenizable fields for freshness tracking */
export function computeTokenHash(adopter: {
    name: string;
    contactInfo?: string | null;
    addressInfo?: string | null;
    familyMembers?: string | null;
    sourceUrl?: string | null;
}): string {
    const parts = [
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
 */
export function extractTokens(adopter: AdopterData, adoptions?: AdoptionData[]): Token[] {
    const tokens: Token[] = [];
    const seen = new Set<string>();

    function add(type: TokenType, value: string) {
        const key = `${type}:${value}`;
        if (!seen.has(key)) {
            seen.add(key);
            tokens.push({ type, value });
        }
    }

    // 1. Full normalized name
    if (adopter.name) {
        const fullName = normalizeText(adopter.name);
        if (fullName.length >= MIN_NAME_WORD_LENGTH) {
            add('name_full', fullName);
        }
    }

    // 2. Name words — from name, familyMembers, and adoption.onBehalfOf
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
    for (const source of nameSources) {
        if (source) {
            for (const word of extractNameWords(source)) {
                add('name_word', word);
            }
        }
    }

    // 3-5. Phones / emails / socials — harvest across ALL free-text fields, not just
    // contactInfo. This prevents a phone the user typed in the name or address field
    // from being silently fragmented into name_word / address_word digit tokens.
    // Each extractor already normalizes (whitespace/punctuation stripping for phones,
    // case for emails) so a single phone with internal spaces remains one token.
    const allText = [
        adopter.contactInfo || '',
        adopter.name || '',
        adopter.addressInfo || '',
        adopter.familyMembers || '',
    ].join('\n');

    const phones = extractPhones(allText);
    for (const phone of phones) add('phone', phone);
    for (const suffix of extractPhoneSuffixes(phones)) add('phone_suffix', suffix);

    for (const email of extractEmails(allText)) add('email', email);
    for (const social of extractSocials(allText)) add('social', social);

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
