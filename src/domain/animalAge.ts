/**
 * An animal's age as a person writes it ("2 años", "3 meses", "6 semanas",
 * "1 año y 3 meses", "1,5 años", "6m") → number + unit, the shape the app
 * stores as an estimated birth date (src/lib/ageUtils.ts computeBirthDate).
 * Pure. Null when it can't be read: the caller keeps the text as written and
 * simply has no estimate — an odd age never blocks saving an adoption.
 */
export interface ParsedAge { value: number; unit: 'months' | 'years' }

const MONTHS_PER: Record<'years' | 'months' | 'weeks', number> = { years: 12, months: 1, weeks: 12 / 52 };
const UNIT_RE: Array<{ re: RegExp; unit: keyof typeof MONTHS_PER }> = [
    { re: /^(a|ano|anos|y|yr|yrs|year|years|any|anys)$/, unit: 'years' },
    { re: /^(m|mes|meses|mo|mos|month|months)$/, unit: 'months' },
    { re: /^(s|sem|semana|semanas|w|wk|wks|week|weeks)$/, unit: 'weeks' },
];
const MAX_MONTHS = 30 * 12;

export function parseAgeText(raw: string | null | undefined): ParsedAge | null {
    const s = (raw ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (!s) return null;
    // One or more "<number> <unit>" parts, joined by "y" / "and" / "e" / commas / spaces.
    // A comma followed by a space separates parts; "1,5" is a decimal.
    const parts = s.split(/\s*(?:,\s+|\by\b|\band\b|\be\b)\s*/).filter(Boolean);
    let months = 0;
    for (const part of parts) {
        const m = part.match(/^(\d{1,3}(?:[.,]\d+)?)\s*([a-z]+)\.?$/);
        if (!m) return null;
        const n = Number(m[1].replace(',', '.'));
        const unit = UNIT_RE.find(u => u.re.test(m[2]))?.unit;
        if (!unit || !Number.isFinite(n) || n <= 0) return null;
        months += n * MONTHS_PER[unit];
    }
    // Limits on the total, before any rounding: "99,5 años" is not an age.
    if (months > MAX_MONTHS) return null;
    if (months < 0.5) return { value: 1, unit: 'months' }; // a few weeks old: the app's smallest step
    const whole = Math.round(months);
    return whole % 12 === 0 && whole >= 12 ? { value: whole / 12, unit: 'years' } : { value: whole, unit: 'months' };
}
