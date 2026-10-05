/**
 * Compares what the interviewee said with what a profile holds. Runs on the
 * server only, so a protected value never reaches the browser; the client
 * learns a boolean (spec §4.4).
 */
import { extractAddressWords, normalizeText } from '@/lib/tokenizer';
import { contactKey } from './facts';
import type { ContactType, VerifiableFact } from './types';

const CONTACT_TYPE: Record<Exclude<VerifiableFact, 'address'>, ContactType> = { phones: 'phone', emails: 'email', socials: 'social' };

function addressMatches(a: string, b: string): boolean {
    const na = normalizeText(a).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const nb = normalizeText(b).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (na && na === nb) return true;
    const wa = new Set(extractAddressWords(a));
    return extractAddressWords(b).filter(w => wa.has(w)).length >= 2;
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
