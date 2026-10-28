/**
 * Compute average rating from activity records.
 * 
 * Business rule: every real rating (1-5) counts toward the average,
 * regardless of record type. The rating input is shown for every
 * record type (adoption, request, observation, follow-up, returned).
 * null and 0 both mean "not rated" and are ignored: [4, 0] averages to 4.
 * Every SQL average of adopter ratings must apply the same `rating > 0` rule.
 */
export function computeAvgRating(
    records: { rating: number | null | undefined }[]
): number | null {
    const rated = records.filter(r => r.rating != null && Number(r.rating) > 0);
    if (rated.length === 0) return null;
    return rated.reduce((sum, r) => sum + Number(r.rating), 0) / rated.length;
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

/**
 * How many stars to show filled. 0 (or null/NaN/negative) means "not rated
 * yet" and must show NO star and no label — never clamp it up to level 1
 * ("Peligroso").
 */
export function getRatingDisplayLevel(rating: number): 0 | RatingLevel {
    const r = Math.round(Number(rating) || 0);
    if (r < 1) return 0;
    return Math.min(5, r) as RatingLevel;
}

/**
 * Does a profile's rating ban the person from adopting (the adopter sign-in
 * gate)? Only a profile SHOWN as 1★ «peligroso» — the average rounds to 1.
 * Unrated never bans (ratings are never inferred). Jon, 2026-10-13: it was any
 * average below 4.
 */
export function ratingBansAdopting(avgRating: number | null | undefined): boolean {
    return avgRating != null && getRatingDisplayLevel(avgRating) === 1;
}
