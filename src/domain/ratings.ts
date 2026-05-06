/**
 * Compute average rating from activity records.
 * 
 * Business rule: All non-null ratings count toward the average,
 * regardless of record type. The rating input is shown for every
 * record type (adoption, request, observation, follow-up, returned).
 */
export function computeAvgRating(
    records: { rating: number | null }[]
): number | null {
    const rated = records.filter(r => r.rating !== null);
    if (rated.length === 0) return null;
    return rated.reduce((sum, r) => sum + r.rating!, 0) / rated.length;
}

export const RATING_LEVELS = [1, 2, 3, 4, 5] as const;
export type RatingLevel = typeof RATING_LEVELS[number];

export const RATING_LABEL_KEYS: Record<RatingLevel, string> = {
    1: 'dangerous',
    2: 'poor',
    3: 'average',
    4: 'good',
    5: 'excellent',
};

export function getRatingLabelKey(rating: number): string {
    const r = Math.max(1, Math.min(5, Math.round(Number(rating) || 0))) as RatingLevel;
    return RATING_LABEL_KEYS[r];
}
