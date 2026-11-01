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

/** A rating as every card writes it: one decimal («2.0», «2.3») — RatingBadge and the housemate chip share it. */
export function formatRating(rating: number): string {
    return rating % 1 !== 0 ? rating.toFixed(1) : `${rating}.0`;
}

/**
 * A low rating: the 1★ / 2★ buckets («Peligroso», «Malo») of the rating AS
 * WRITTEN (formatRating, one decimal) — review M6: the housemate chip writes
 * the rating with formatRating, so deciding on that same number means the chip
 * never shows a «2.5» it counted as low. 2.44 is «2.4» and low; 2.45 is «2.5»,
 * «Regular», not low. Unrated (null, 0, outside 1–5) is never low: ratings are
 * never inferred. (RatingBadge's word and colour, and the 1★ ban rule, still
 * round the raw average.)
 */
export function isLowRating(rating: number | null | undefined): boolean {
    if (rating == null) return false;
    const n = Number(rating);
    if (Number.isNaN(n) || n < 1 || n > 5) return false;
    const key = getRatingLabelKey(Number(formatRating(n)));
    return key === RATING_LABEL_KEYS[1] || key === RATING_LABEL_KEYS[2];
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

/**
 * The rating a profile will have once another is merged into it: a merge
 * moves every record of the absorbed profile onto the survivor, so it is the
 * same rule (computeAvgRating) over both profiles' records together — never
 * the average of the two averages.
 */
export function ratingAfterMerge(
    survivor: { rating: number | null | undefined }[],
    absorbed: { rating: number | null | undefined }[],
): number | null {
    return computeAvgRating([...survivor, ...absorbed]);
}
