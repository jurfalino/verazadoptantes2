/**
 * Cleaning what a partner sends about a person BEFORE the API checks it
 * (Jon, 2026-10-18, from Catpuccino's 5,889 real forms —
 * .agents/audits/2026-10-14-catpuccino-api-data-risks.md):
 *
 *  a) socials: "no tengo" / "-" (no account, or won't share) are dropped; a
 *     Facebook / Instagram answer that is a name ("Ana Perez") is kept as a
 *     name — never a link or a matching key (see normalizeSocialHandle).
 *  c) a phone with a note keeps only the number(s): "11 4455-6677 solo
 *     WhatsApp" → "11 4455-6677"; two numbers are both kept, "A / B".
 *  d) a bad phone or email is dropped — and the activity still saved — when
 *     another usable identifier remains; the answer says what was dropped.
 *     Several emails in one field keep the first valid one. With no other
 *     identifier the value is left as sent, so the call is refused as before.
 *
 * Names are not cleaned here: a name that isn't one is refused (isFullName). Pure.
 */
import { isPlaceholderContact } from './importFields';
import { readPhones } from './phoneNumber';
import { isUsableDocumentId } from './apiExactMatch';

export const API_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface CleanablePerson {
    fullName?: string;
    email?: string;
    phone?: string;
    documentId?: { value: string; country?: string };
    address?: string;
    socials?: Array<{ platform: string; handle: string }>;
}

export type DroppedReason = 'not_an_email' | 'not_a_phone' | 'no_account';
export interface DroppedValue { field: string; reason: DroppedReason }

/** A cleaned value differs from what was sent (kept, but trimmed to what is usable). */
export interface CleanedValue { field: string; reason: 'first_valid_email' | 'phone_numbers_only' }

/**
 * The first well-formed email inside free text ("a@x.com /// b@y.com", "a@x.com (hija)").
 * Never a guess: when a bare word sits right before the address ("ana perez@gmail.com"),
 * the address might be cut out of a longer one — "perez@gmail.com" is someone else's
 * (review 2026-10-19), so there is no usable email.
 */
export function firstEmailIn(text: string): string | null {
    const v = text.trim().replace(/\s+@\s*|\s*@\s+/g, '@'); // "ana @gmail.com"
    if (API_EMAIL_RE.test(v)) return v;
    for (const m of v.matchAll(/[^\s@,;/()<>[\]"']+@[^\s@,;/()<>[\]"']+/g)) {
        const before = v.slice(0, m.index);
        if (/[\p{L}\p{N}._-]\s+$/u.test(before)) return null;
        const candidate = m[0].replace(/[.:]+$/, '');
        if (API_EMAIL_RE.test(candidate)) return candidate;
    }
    return null;
}

/** Runs of a phone number inside free text: digits with the usual separators. */
const PHONE_RUN = /\+?\(?\d[\d\s().-]{5,}\d/g;
/** A number labelled as a document is not a phone ("DNI 30123456 cel 11…"). */
const DOCUMENT_LABEL = /(?:dni|documento|doc\.?|cuit|cuil|pasaporte)\W*$/i;

/**
 * Only the numbers in a phone field. When the phone reader already understands
 * the whole value — a note ("cel", "solo WhatsApp") doesn't bother it — it is
 * returned as sent: a cleanup must never make a valid phone worse (review
 * 2026-10-19). Only when it can't (no number, or several numbers glued by words
 * into one overlong one) are the numbers taken out: "11 4455-6677 el de mi
 * marido 11 5566-7788" → "11 4455-6677 / 11 5566-7788". null when none is readable.
 */
export function phoneNumbersIn(text: string, country?: string | null): string | null {
    // Typographic dashes and non-breaking spaces read as plain ones.
    const v = text.replace(/[\u2010-\u2015\u2212]/g, '-').replace(/[\u00a0\u2007\u202f]/g, ' ').trim();
    const whole = readPhones(v, country);
    if (whole.length && whole.every(r => r.kind === 'complete' || !r.overlong)) return v;
    const runs = [...v.matchAll(PHONE_RUN)]
        .filter(m => !DOCUMENT_LABEL.test(v.slice(0, m.index)))
        .map(m => m[0].trim())
        .filter(r => { const read = readPhones(r, country); return read.length > 0 && read.every(x => x.kind === 'complete' || !x.overlong); });
    if (runs.length) return runs.join(' / ');
    return whole.length ? v : null; // an overlong number stays as before: accepted, never used to prove a match
}

/** "Ana Perez" in a Facebook field: a display name, not an account (no link, no @, has a space). */
export function isSocialDisplayName(handle: string): boolean {
    const v = handle.trim();
    return /\s/.test(v) && !/^@/.test(v) && !/[/.]\w+\//.test(v) && !/^https?:/i.test(v) && !/\.(com|me)\b/i.test(v);
}

export function cleanApiPerson<P extends CleanablePerson>(person: P, country?: string | null): { person: P; dropped: DroppedValue[]; cleaned: CleanedValue[] } {
    const p: P = { ...person };
    const dropped: DroppedValue[] = [];
    const cleaned: CleanedValue[] = [];

    if (p.socials?.length) {
        const kept = p.socials.filter(s => !isPlaceholderContact(s.handle));
        p.socials.forEach((s, i) => { if (!kept.includes(s)) dropped.push({ field: `person.socials[${i}]`, reason: 'no_account' }); });
        p.socials = kept.length ? kept : undefined;
    }

    // Each identifier read as leniently as is safe; null = unusable.
    let email: string | null | undefined = p.email;
    if (p.email !== undefined) {
        email = isPlaceholderContact(p.email) ? null : firstEmailIn(p.email);
        if (email && email !== p.email.trim()) cleaned.push({ field: 'person.email', reason: 'first_valid_email' });
    }
    let phone: string | null | undefined = p.phone;
    if (p.phone !== undefined) {
        phone = isPlaceholderContact(p.phone) ? null : phoneNumbersIn(p.phone, country);
        if (phone && phone !== p.phone.trim()) cleaned.push({ field: 'person.phone', reason: 'phone_numbers_only' });
    }
    const docOk = !!p.documentId && isUsableDocumentId(p.documentId.value);
    const usable = (email ? 1 : 0) + (phone ? 1 : 0) + (docOk ? 1 : 0);

    if (email) p.email = email;
    else if (email === null && usable > 0) { delete p.email; dropped.push({ field: 'person.email', reason: 'not_an_email' }); }
    if (phone) p.phone = phone;
    else if (phone === null && usable > 0) { delete p.phone; dropped.push({ field: 'person.phone', reason: 'not_a_phone' }); }
    return { person: p, dropped, cleaned };
}
