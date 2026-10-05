/**
 * The gift's recipient — the person who will live with the animal (spec Part 2
 * §7). The public form asks for them after "Es un regalo"; the server re-parses
 * it here and never trusts the client's shape.
 */
import { FORM_RELATIONSHIPS, type FormRelationship } from './householdPeople';

export type GiftRecipient = { relationship: FormRelationship; firstName: string; lastName?: string; phone?: string };

const REL = new Set<string>(FORM_RELATIONSHIPS);
const PHONE = /^[\d\s+()-]{6,30}$/;
const cleanName = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 60) : '');

export function parseGiftRecipient(raw: unknown): GiftRecipient | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.relationship !== 'string' || !REL.has(r.relationship)) return null;
    const firstName = cleanName(r.firstName);
    if (!firstName) return null;
    const lastName = cleanName(r.lastName);
    const phone = typeof r.phone === 'string' && PHONE.test(r.phone.trim()) ? r.phone.trim() : undefined;
    return {
        relationship: r.relationship as FormRelationship,
        firstName,
        ...(lastName ? { lastName } : {}),
        ...(phone ? { phone } : {}),
    };
}

/** Only a fully named recipient goes onto the giver's profile (same rule as household people). */
export function recipientFullName(r: GiftRecipient): string | null {
    return r.firstName && r.lastName ? `${r.firstName} ${r.lastName}` : null;
}
