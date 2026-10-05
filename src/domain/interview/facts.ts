/**
 * What the interview already knows: prep + answered questions + what the
 * confirmed profile shows this viewer. Drives gap-filling in the queue and
 * the identifiers sent to the duplicate engine.
 */
import { normalizeSocialHandle, normalizeText } from '@/lib/tokenizer';
import type { Answer, ContactType, FactKey, HouseholdValue, InterviewContext, KnownFacts, QuestionDef } from './types';
import { VERIFIABLE_FACTS } from './types';

/** Stable comparison key for an identifier, or null when it can't identify anyone. */
export function contactKey(type: ContactType, value: string): string | null {
    const v = (value || '').trim();
    if (!v) return null;
    if (type === 'phone') {
        const digits = v.replace(/\D/g, '');
        return digits.length >= 7 ? digits.slice(-8) : null;
    }
    if (type === 'email') return v.toLowerCase();
    return normalizeSocialHandle(v) ?? (normalizeText(v).replace(/^@+/, '') || null);
}

export function answerHasContent(a: Answer): boolean {
    if (a.text && a.text.trim()) return true;
    if (a.contacts?.some(c => c.value.trim())) return true;
    if (a.household?.some(h => h.name.trim() || h.relationship)) return true;
    if (a.choice) return true;
    return typeof a.number === 'number' && Number.isFinite(a.number);
}

export function deriveKnownFacts(ctx: InterviewContext, bank: readonly QuestionDef[]): KnownFacts {
    const byId = new Map(bank.map(q => [q.id, q]));
    const lists: Record<ContactType, Map<string, string>> = { phone: new Map(), email: new Map(), social: new Map() };
    const add = (type: ContactType, raw: string) => {
        const key = contactKey(type, raw);
        if (key && !lists[type].has(key)) lists[type].set(key, raw.trim());
    };
    ctx.prep.phones.forEach(p => add('phone', p));
    ctx.prep.emails.forEach(e => add('email', e));
    ctx.prep.socials.forEach(s => add('social', s));

    const filled = new Set<FactKey>();
    const name = ctx.prep.name.trim();
    if (name) filled.add('name');
    let address = ctx.prep.address.trim() || undefined;
    const household: HouseholdValue[] = [];

    for (const id of Object.keys(ctx.answers).sort()) {
        const a = ctx.answers[id];
        const q = byId.get(id);
        if (!q || a.status !== 'answered' || !answerHasContent(a)) continue;
        q.fills.forEach(f => filled.add(f));
        a.contacts?.forEach(c => add(c.type, c.value));
        a.household?.forEach(h => {
            if (h.name.trim() || h.relationship) household.push({ name: h.name.trim(), relationship: h.relationship });
        });
        if (q.fills.includes('address') && a.text?.trim()) address = a.text.trim();
    }

    if (lists.phone.size) filled.add('phones');
    if (lists.email.size) filled.add('emails');
    if (lists.social.size) filled.add('socials');
    if (address) filled.add('address');
    if (household.length) filled.add('household');

    if (ctx.confirmedAdopterId) {
        const c = ctx.candidates.find(x => x.adopterId === ctx.confirmedAdopterId);
        if (c) for (const f of VERIFIABLE_FACTS) if (c.visible[f]?.length) filled.add(f);
    }

    return {
        name,
        phones: [...lists.phone.values()],
        emails: [...lists.email.values()],
        socials: [...lists.social.values()],
        address,
        household,
        filled: [...filled].sort(),
    };
}

/** Changes only when the set of identifiers changes, which is when re-matching is worth it. */
export function identifierSignature(k: KnownFacts): string {
    const keys = (type: ContactType, vs: string[]) => vs.map(v => contactKey(type, v)).filter(Boolean).sort().join(',');
    return [normalizeText(k.name), keys('phone', k.phones), keys('email', k.emails), keys('social', k.socials)].join('|');
}
