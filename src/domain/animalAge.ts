/**
 * An animal's age as a person writes it ("2 años", "3 meses", "1 year",
 * "6m") → number + unit, the shape the app stores as an estimated birth date
 * (src/lib/ageUtils.ts computeBirthDate). Pure. Null when it can't be read:
 * the caller refuses rather than guessing.
 */
export interface ParsedAge { value: number; unit: 'months' | 'years' }

const UNITS: Array<{ re: RegExp; unit: ParsedAge['unit'] }> = [
    { re: /^(a|años?|anos?|y|yrs?|years?|anys?)$/, unit: 'years' },
    { re: /^(m|mes|meses|mos?|months?|mês)$/, unit: 'months' },
];

export function parseAgeText(raw: string | null | undefined): ParsedAge | null {
    const s = (raw ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const m = s.match(/^(\d{1,2}(?:[.,]\d)?)\s*([a-z]+)\.?$/);
    if (!m) return null;
    const n = Number(m[1].replace(',', '.'));
    const unit = UNITS.find(u => u.re.test(m[2]))?.unit;
    if (!unit || !Number.isFinite(n) || n <= 0) return null;
    // Half years read as months, so "1,5 años" keeps its precision.
    if (unit === 'years' && !Number.isInteger(n)) return { value: Math.round(n * 12), unit: 'months' };
    if (unit === 'months' && !Number.isInteger(n)) return { value: Math.round(n), unit: 'months' };
    if (unit === 'years' && n > 30) return null;
    if (unit === 'months' && n > 360) return null;
    return { value: n, unit };
}
