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
