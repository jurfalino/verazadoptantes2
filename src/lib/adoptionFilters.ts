import type { AdoptionRecord } from '@/types/adopter';

/**
 * Parse an adoption date that may be stored as a Unix timestamp (seconds) or a Date.
 */
function parseAdoptionDate(date: Date | number | null | undefined): Date | null {
    if (!date) return null;
    return typeof date === 'number' ? new Date(date * 1000) : new Date(date);
}

/**
 * Count adoptions/requests within a period.
 * Pure function — takes a reference date to avoid hydration mismatches from `new Date()` at render time.
 */
export function countRecordsInPeriod(
    adoptions: AdoptionRecord[],
    recordType: string,
    periodDays: number,
    referenceDate: Date = new Date()
): number {
    if (periodDays === Infinity) {
        return adoptions.filter(a => a.recordType === recordType).length;
    }
    const cutoff = new Date(referenceDate);
    cutoff.setDate(cutoff.getDate() - periodDays);
    return adoptions.filter(a => {
        if (a.recordType !== recordType) return false;
        const d = parseAdoptionDate(a.date);
        return d ? d >= cutoff : false;
    }).length;
}
