/**
 * Utilities for computing, formatting, and parsing animal age
 * based on an estimated birth date.
 *
 * The canonical storage format is `estimated_birth_date` (unix timestamp).
 * These helpers bridge between the user-facing input (number + unit) and
 * the stored timestamp, and produce locale-aware display strings.
 */

// Coerce the heterogeneous shapes a birth date can take at runtime — Drizzle
// returns Date, raw integer columns surface as number, and `NextResponse.json`
// stringifies Date to ISO — into a single Date object. Numbers <1e12 are
// treated as Unix seconds (matching the schema's epoch-seconds storage).
function toDate(value: Date | number | string): Date {
    if (value instanceof Date) return value;
    if (typeof value === 'number') {
        return new Date(value < 1e12 ? value * 1000 : value);
    }
    return new Date(value);
}

/**
 * Compute an estimated birth date by subtracting an age from a reference date.
 * @param value - The numeric age value (e.g. 3)
 * @param unit  - 'months' or 'years'
 * @param referenceDate - Date to subtract from (defaults to now)
 * @returns Estimated birth date
 */
export function computeBirthDate(
    value: number,
    unit: 'months' | 'years',
    referenceDate: Date = new Date()
): Date {
    const d = new Date(referenceDate);
    if (unit === 'years') {
        d.setFullYear(d.getFullYear() - value);
    } else {
        d.setMonth(d.getMonth() - value);
    }
    return d;
}

/**
 * Derive age value + unit from a birth date (for edit-mode hydration).
 * @param birthDate - Unix timestamp (seconds), Date, or ISO string (as returned by JSON APIs)
 * @returns { value, unit } suitable for the form inputs
 */
export function deriveAgeFromBirthDate(
    birthDate: number | Date | string
): { value: number; unit: 'months' | 'years' } {
    const birth = toDate(birthDate);
    const now = new Date();
    const diffMs = now.getTime() - birth.getTime();
    const diffMonths = Math.round(diffMs / (30.44 * 24 * 60 * 60 * 1000));

    if (diffMonths >= 24) {
        return { value: Math.round(diffMonths / 12), unit: 'years' };
    }
    return { value: Math.max(1, diffMonths), unit: 'months' };
}

/**
 * Format a birth date into a human-readable approximate age string.
 * @param birthDate - Unix timestamp (seconds), Date, ISO string (as returned by JSON APIs), or null
 * @param locale    - 'es' or 'en'
 * @returns Formatted string like "~3 meses" or null if no birth date
 */
export function formatAge(
    birthDate: Date | number | string | null | undefined,
    locale: 'es' | 'en' = 'es'
): string | null {
    if (birthDate == null) return null;

    const birth = toDate(birthDate);
    if (isNaN(birth.getTime())) return null;
    const now = new Date();
    const diffMs = now.getTime() - birth.getTime();
    const diffMonths = Math.round(diffMs / (30.44 * 24 * 60 * 60 * 1000));

    if (diffMonths < 1) {
        return locale !== 'en' ? '< 1 mes' : '< 1 month';
    }
    if (diffMonths < 24) {
        const unit = locale !== 'en'
            ? (diffMonths === 1 ? 'mes' : 'meses')
            : (diffMonths === 1 ? 'month' : 'months');
        return `~${diffMonths} ${unit}`;
    }
    const years = Math.round(diffMonths / 12);
    const unit = locale !== 'en'
        ? (years === 1 ? 'año' : 'años')
        : (years === 1 ? 'year' : 'years');
    return `~${years} ${unit}`;
}

/**
 * Best-effort parser for legacy freeform age text (e.g. "2 años", "3 months").
 * Used only for edit-mode hydration of records that lack estimated_birth_date.
 * @returns Parsed { value, unit } or null if unparseable
 */
export function parseLegacyAge(
    raw: string | null | undefined
): { value: number; unit: 'months' | 'years' } | null {
    if (!raw) return null;

    const match = raw.match(/^(\d+)\s*(meses?|months?|años?|years?)$/i);
    if (!match) return null;

    const value = parseInt(match[1], 10);
    if (value <= 0) return null;

    const unitRaw = match[2].toLowerCase();
    const unit: 'months' | 'years' =
        unitRaw.startsWith('año') || unitRaw.startsWith('year') ? 'years' : 'months';

    return { value, unit };
}
