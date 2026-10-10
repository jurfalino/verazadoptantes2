/**
 * How a phone number is read — for the search index, for a search, and for the
 * "you typed it, so it is revealed" check. One module so the three can never
 * disagree.
 *
 * A number is read with Google's libphonenumber (metadata only, no network),
 * using a country: the record's when indexing, the rescuer's when searching.
 * That is what makes "+54 9 11 6585-1333", "011 15 6585-1333", "11-6585-1333"
 * and "1165851333" the same number, and keeps "351 412-3456" (Córdoba) apart
 * from "341 412-3456" (Rosario) — area codes run 2 to 4 digits and local
 * numbers 6 to 8, so no fixed digit count can do either.
 *
 *   complete   → `key`: country code + national number. Argentina's "9" (which
 *                only marks a mobile when dialled from abroad) is dropped, so a
 *                mobile and the same number written as a landline coincide.
 *   incomplete → `local`: the digits, without Argentina's old "15" mobile
 *                prefix. Nothing is invented: a number saved without an area
 *                code stays without one.
 *
 * Matching (see `phoneQueryPlan`):
 *   - a complete search matches the same key exactly, and an incomplete stored
 *     number whose local digits are the END of the searched number;
 *   - a partial search matches numbers that END with what was typed — never a
 *     beginning, so a country or area code alone can never match.
 */

import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';

/** A partial search at least this long is trusted enough for the main list. */
export const STRONG_PARTIAL_DIGITS = 8;
/** Local numbers are 6–8 digits; a longer unrecognised number keeps its last 8. */
const MIN_LOCAL_DIGITS = 6;
const MAX_LOCAL_DIGITS = 8;
/** Below this many national digits there is no "ending" worth a duplicate suffix. */
const MIN_NATIONAL_FOR_SUFFIX = 9;

/**
 * Placeholder/dummy values that must never index: all one digit repeated 7+
 * times, plus a small explicit set. Monotonic runs like 23456789 are not
 * filtered — they can be real local numbers.
 */
const PLACEHOLDER_PHONES = new Set(['1234567', '12345678', '123456789', '1234567890', '0123456789']);
export function isPlaceholderPhone(digits: string): boolean {
    if (/^(\d)\1{6,}$/.test(digits)) return true;
    return PLACEHOLDER_PHONES.has(digits);
}

export type ReadPhone =
    | { kind: 'complete'; key: string; national: string }
    | { kind: 'incomplete'; local: string };

function region(country: string | null | undefined): CountryCode {
    const c = (country || '').trim().toUpperCase();
    return (/^[A-Z]{2}$/.test(c) ? c : 'AR') as CountryCode;
}

/** Digits of an unrecognised number, with dialling prefixes taken off. */
function localDigits(value: string, country: CountryCode): string {
    let d = value.replace(/\D/g, '');
    if (country === 'AR') {
        const v = value.trim();
        if (v.startsWith('+54') || v.startsWith('0054')) {
            d = d.replace(/^0{0,2}54/, '').replace(/^9/, '');
        }
        d = d.replace(/^0/, '');                       // trunk prefix
        if (d.length === 10 && d.startsWith('15')) d = d.slice(2); // old "15-xxxx-xxxx"
    } else {
        d = d.replace(/^0/, '');
    }
    return d;
}

/** Read one phone value. Null when it holds no usable number. */
export function readPhone(value: string, country?: string | null): ReadPhone | null {
    const digits = (value || '').replace(/\D/g, '');
    if (digits.length < MIN_LOCAL_DIGITS || isPlaceholderPhone(digits)) return null;
    const cc = region(country);

    const parsed = parsePhoneNumberFromString(value, cc);
    if (parsed && parsed.isValid()) {
        let national = String(parsed.nationalNumber);
        const calling = String(parsed.countryCallingCode);
        if (calling === '54' && national.length === 11 && national.startsWith('9')) national = national.slice(1);
        return { kind: 'complete', key: calling + national, national };
    }

    let local = localDigits(value, cc);
    if (local.length < MIN_LOCAL_DIGITS || isPlaceholderPhone(local)) return null;
    if (local.length > MAX_LOCAL_DIGITS) local = local.slice(-MAX_LOCAL_DIGITS);
    return { kind: 'incomplete', local };
}

/** The endings of a national number that a local-only record could have been saved as. */
function localEndings(national: string): string[] {
    const out: string[] = [];
    for (let n = MIN_LOCAL_DIGITS; n <= MAX_LOCAL_DIGITS && n < national.length; n++) out.push(national.slice(-n));
    return out;
}

export type PhoneToken = { type: 'phone' | 'phone_suffix'; value: string };

/**
 * What the search index stores for one phone entry:
 *   complete   → `phone` = key, plus `phone_suffix` = last 8 national digits
 *                (the duplicate checker's area-code-agnostic signal);
 *   incomplete → `phone` = local digits.
 */
export function phoneIndexTokens(value: string, country?: string | null): PhoneToken[] {
    const r = readPhone(value, country);
    if (!r) return [];
    if (r.kind === 'incomplete') return [{ type: 'phone', value: r.local }];
    const out: PhoneToken[] = [{ type: 'phone', value: r.key }];
    if (r.national.length >= MIN_NATIONAL_FOR_SUFFIX) out.push({ type: 'phone_suffix', value: r.national.slice(-8) });
    return out;
}

/**
 * The phone values a duplicate check looks up exactly, for one phone it was given.
 * Mirrors `phoneIndexTokens`, plus the endings a local-only stored record could hold.
 */
export function phoneDuplicateTokens(value: string, country?: string | null): PhoneToken[] {
    const r = readPhone(value, country);
    if (!r) return [];
    if (r.kind === 'incomplete') {
        const out: PhoneToken[] = [{ type: 'phone', value: r.local }];
        if (r.local.length === 8) out.push({ type: 'phone_suffix', value: r.local });
        return out;
    }
    const out: PhoneToken[] = [{ type: 'phone', value: r.key }];
    if (r.national.length >= MIN_NATIONAL_FOR_SUFFIX) out.push({ type: 'phone_suffix', value: r.national.slice(-8) });
    for (const end of localEndings(r.national)) out.push({ type: 'phone', value: end });
    return out;
}

export interface PhoneQueryPlan {
    /** `phone` token values that identify the number exactly (strong). */
    exact: string[];
    /** Digits a stored `phone` must END with; `strong` when long enough for the main list. */
    endsWith: Array<{ digits: string; strong: boolean }>;
}

function isPhoneShaped(q: string): boolean {
    const d = q.replace(/[\s\-.()+]/g, '');
    const cnt = (d.match(/\d/g) ?? []).length;
    return cnt > 0 && cnt / d.length > 0.5;
}

/**
 * How a search query is looked up in the phone index. Null when the query holds
 * no number of at least `minDigits` digits (the anti-fishing floor).
 */
export function phoneQueryPlan(query: string, country: string | null | undefined, minDigits: number): PhoneQueryPlan | null {
    const enough = (s: string) => s.replace(/\D/g, '').length >= minDigits;
    const candidates = new Set<string>();
    // The whole query is ONE number when it reads as a complete number
    // ("+54 9 11 6585-1333") or is short enough to be a local number once its
    // prefixes are off ("6585 1333", "15 6585 1333"). Then its pieces are parts
    // of that number and are not looked up on their own — "351 412-3456" must not
    // also search "412-3456", which Rosario's 341 412-3456 ends with.
    // Otherwise the digits are separate values glued together ("2345-6789
    // 30123456": a phone and a DNI), so each piece is read on its own.
    const whole = query.trim();
    const read = isPhoneShaped(whole) ? readPhone(whole, country) : null;
    const wholeIsOneNumber = !!read && (read.kind === 'complete' || localDigits(whole, region(country)).length <= MAX_LOCAL_DIGITS);
    if (wholeIsOneNumber) {
        candidates.add(whole);
    } else {
        for (const piece of whole.split(/\s+/)) if (enough(piece)) candidates.add(piece);
        for (const run of whole.match(new RegExp(`\\+?\\d{${minDigits},}`, 'g')) ?? []) candidates.add(run);
    }

    const exact = new Set<string>();
    const endsWith = new Map<string, boolean>();
    for (const c of candidates) {
        if (c.replace(/\D/g, '').length < minDigits) continue;
        const r = readPhone(c, country);
        if (!r) continue;
        if (r.kind === 'complete') {
            exact.add(r.key);
            // A record not yet re-indexed may still hold the number as typed.
            exact.add(r.national);
            if (r.key.startsWith('54')) { exact.add(`549${r.national}`); exact.add(`0${r.national}`); }
            for (const end of localEndings(r.national)) exact.add(end);
        } else if (r.local.length >= minDigits) {
            endsWith.set(r.local, (endsWith.get(r.local) ?? false) || r.local.length >= STRONG_PARTIAL_DIGITS);
        }
    }
    if (exact.size === 0 && endsWith.size === 0) return null;
    return { exact: [...exact], endsWith: [...endsWith].map(([digits, strong]) => ({ digits, strong })) };
}

/**
 * Does this query identify this stored phone? Used to reveal a masked number the
 * searcher typed — the same rule as the search itself, so a number found by
 * phone is also the one revealed.
 */
export function phoneMatchesQuery(entryValue: string, query: string, country: string | null | undefined, minDigits: number): boolean {
    const plan = phoneQueryPlan(query, country, minDigits);
    const r = readPhone(entryValue, country);
    if (!plan || !r) return false;
    const stored = r.kind === 'complete' ? r.key : r.local;
    if (plan.exact.includes(stored)) return true;
    return plan.endsWith.some(e => stored.endsWith(e.digits));
}

/** Two phone values are the same number (both read with the same country). */
export function samePhone(a: string, b: string, country?: string | null): boolean {
    const ra = readPhone(a, country);
    const rb = readPhone(b, country);
    if (!ra || !rb) return false;
    if (ra.kind === 'complete' && rb.kind === 'complete') return ra.key === rb.key;
    if (ra.kind === 'complete' && rb.kind === 'incomplete') return ra.national.endsWith(rb.local);
    if (ra.kind === 'incomplete' && rb.kind === 'complete') return rb.national.endsWith(ra.local);
    return ra.kind === 'incomplete' && rb.kind === 'incomplete' && ra.local === rb.local;
}
