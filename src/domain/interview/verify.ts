/**
 * Compares what the interviewee said with what a profile holds. Runs on the
 * server only, so a protected value never reaches the browser; the client
 * learns a boolean (spec §4.4).
 */
import { extractAddressWords, normalizeText } from '@/lib/tokenizer';
import { contactKey } from './facts';
import type { Answer, ContactType, VerifiableFact } from './types';

const CONTACT_TYPE: Record<Exclude<VerifiableFact, 'address'>, ContactType> = { phones: 'phone', emails: 'email', socials: 'social' };

function normalizeAddressString(addr: string): string {
    return normalizeText(addr).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractStreetPairs(addr: string): Set<string> {
    const words = extractAddressWords(addr);
    const pairs = new Set<string>();
    for (let i = 1; i < words.length; i++) {
        const current = words[i];
        if (/^\d+$/.test(current) && current.length >= 3) {
            pairs.add(`${words[i - 1]} ${current}`);
        }
    }
    return pairs;
}

function addressMatches(a: string, b: string): boolean {
    const na = normalizeAddressString(a);
    const nb = normalizeAddressString(b);
    if (na && na === nb) return true;

    const pairsA = extractStreetPairs(a);
    const pairsB = extractStreetPairs(b);

    if (!pairsA.size || !pairsB.size) return false;

    for (const pair of pairsA) {
        if (pairsB.has(pair)) return true;
    }
    return false;
}

export function factMatches(fact: VerifiableFact, stored: string[], given: string[]): boolean {
    if (!stored.length || !given.length) return false;
    if (fact === 'address') return given.some(g => stored.some(s => addressMatches(s, g)));
    const type = CONTACT_TYPE[fact];
    const keys = new Set(stored.map(v => contactKey(type, v)).filter((k): k is string => !!k));
    return given.some(g => {
        const k = contactKey(type, g);
        return !!k && keys.has(k);
    });
}

/** Distinct "street number" pairs in a free-text address; the verify budget rule lives here. */
export function streetPairs(text: string): string[] {
    return [...extractStreetPairs(text)];
}

/** At most this many values of one contact type are compared per call. */
export const MAX_GIVEN_CONTACTS = 3;

/**
 * The values of an answer that may be compared with a profile, or null when
 * the answer is not ready to compare. Blank rows are ignored; then contacts
 * need 1–3 values of the fact's type, every one a usable identifier (a
 * 4-digit partial phone is not), and an address needs exactly one "street
 * number" pair (so a numberless address is never compared). The client calls
 * the server only when this is non-null, and the server refuses — before
 * spending any of the call budget — when it is null, so a half-typed answer
 * neither burns the budget nor shows a false "doesn't match".
 */
export function verifyGivenValues(fact: VerifiableFact, answer: Answer | null | undefined): string[] | null {
    if (!answer || answer.status !== 'answered') return null;
    if (fact === 'address') {
        const text = (answer.text ?? '').trim();
        return text && streetPairs(text).length === 1 ? [text] : null;
    }
    const type = CONTACT_TYPE[fact];
    const given = (answer.contacts ?? []).filter(c => c.type === type).map(c => (c.value ?? '').trim()).filter(Boolean);
    if (!given.length || given.length > MAX_GIVEN_CONTACTS) return null;
    return given.every(v => contactKey(type, v) !== null) ? given : null;
}
