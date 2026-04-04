import type { AdoptionRecord } from '@/types/adopter';

/**
 * Parse an adoption date that may be stored as a Unix timestamp (seconds) or a Date.
 */
function parseAdoptionDate(date: Date | number | null | undefined): Date | null {
    if (!date) return null;
    return typeof date === 'number' ? new Date(date * 1000) : new Date(date);
}

/**
 * Detect the period containing the maximum number of records of a given type within a sliding window.
 */
export function computeMaxDensityPeriod(
    adoptions: AdoptionRecord[],
    recordType: string,
    periodDays: number
): { count: number; timeSpanDays: number; startDate: Date | null; endDate: Date | null } {
    // 1. Filter and parse dates
    const timestamps: number[] = [];
    for (const a of adoptions) {
        if (a.recordType === recordType) {
            const d = parseAdoptionDate(a.date);
            if (d) timestamps.push(d.getTime());
        }
    }

    if (timestamps.length === 0) {
        return { count: 0, timeSpanDays: 0, startDate: null, endDate: null };
    }

    // 2. Sort chronologically
    timestamps.sort((a, b) => a - b);

    if (periodDays === Infinity) {
        return {
            count: timestamps.length,
            timeSpanDays: (timestamps[timestamps.length - 1] - timestamps[0]) / (1000 * 60 * 60 * 24),
            startDate: new Date(timestamps[0]),
            endDate: new Date(timestamps[timestamps.length - 1])
        };
    }

    // 3. Two-pointer sliding window
    const windowMs = periodDays * 24 * 60 * 60 * 1000;
    
    let maxCount = 0;
    let optLeft = 0;
    let optRight = 0;
    let left = 0;

    for (let right = 0; right < timestamps.length; right++) {
        // Shrink the window if it exceeds periodDays
        while (timestamps[right] - timestamps[left] > windowMs) {
            left++;
        }

        const currentCount = right - left + 1;
        if (currentCount >= maxCount) {
            maxCount = currentCount;
            optLeft = left;
            optRight = right;
        }
    }

    const startMs = timestamps[optLeft];
    const endMs = timestamps[optRight];

    return {
        count: maxCount,
        timeSpanDays: (endMs - startMs) / (1000 * 60 * 60 * 24),
        startDate: new Date(startMs),
        endDate: new Date(endMs)
    };
}
