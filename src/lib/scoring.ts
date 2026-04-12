/**
 * Scoring utilities for duplicate detection and search relevance.
 *
 * Centralises:
 *  - Score normalisation (raw int → 0–100 %)
 *  - Confidence band classification
 *  - Levenshtein edit distance (for name fuzzy matching)
 *
 * All functions are pure and Edge-runtime compatible (no Node.js dependencies).
 */

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Practical score ceiling for duplicate detection.
 * Derived from the maximum realistic token match:
 *   phone (3) + email (3) + name_full (2) + name_phonetic (1.5) = 9.5
 * Rounded to 12 to give headroom for multi-signal matches.
 */
export const PRACTICAL_MAX_DUPLICATE = 12;

/**
 * Score ceiling for general search relevance normalisation.
 * Derived from the maximum achievable score in searchAdopter():
 *   name_exact (100) + query_coverage_full (40) + contact (40) +
 *   verified (2) + rating (3) + thumbnail (5) + recent_update (3) = 193
 * Using 150 keeps the "very relevant" band meaningful without requiring
 * every signal to fire simultaneously.
 */
export const SEARCH_SCORE_CEILING = 150;

// ── Normalisation ────────────────────────────────────────────────────────────

/**
 * Normalise a raw score to a 0–100 confidence percentage.
 * Clamps values above `max` to 100 so the result is always in range.
 *
 * @param score - raw weighted score (e.g. sum of token match weights)
 * @param max   - practical ceiling for this scoring context
 */
export function normalizeConfidence(score: number, max: number): number {
    if (max <= 0) return 0;
    return Math.min(100, Math.round((score / max) * 100));
}

// ── Band Classification ───────────────────────────────────────────────────────

export type ConfidenceBand = 'none' | 'low' | 'medium' | 'high';

/**
 * Map a normalised confidence % (0–100) to a human-readable band.
 *
 * Thresholds (tunable via feature flag in the future):
 *   - none   : < 15  — too weak to surface; collapse or hide
 *   - low    : 15–39 — passive suggestion, low visual weight
 *   - medium : 40–74 — prompt user to review; merge is suggested CTA
 *   - high   : ≥ 75  — strong signal; block or auto-select merge
 */
export function confidenceBand(pct: number): ConfidenceBand {
    if (pct >= 75) return 'high';
    if (pct >= 40) return 'medium';
    if (pct >= 15) return 'low';
    return 'none';
}

// ── Levenshtein Edit Distance ────────────────────────────────────────────────

/**
 * Compute the Levenshtein edit distance between two strings.
 *
 * Uses the standard Wagner-Fischer DP algorithm with a single-row
 * optimisation (O(min(m,n)) space). Edge-runtime safe — pure TS, no deps.
 *
 * Complexity: O(m × n) time, O(min(m,n)) space.
 * Practical for name tokens (typically < 30 chars): negligible CPU cost.
 */
export function levenshtein(a: string, b: string): number {
    // Ensure `a` is the shorter string to minimise space usage
    if (a.length > b.length) { const tmp = a; a = b; b = tmp; }

    const la = a.length;
    const lb = b.length;

    // Fast paths
    if (la === 0) return lb;
    if (lb === 0) return la;
    if (a === b) return 0;

    // Single row DP
    let row: number[] = Array.from({ length: la + 1 }, (_, i) => i);

    for (let j = 1; j <= lb; j++) {
        let prev = row[0];
        row[0] = j;
        for (let i = 1; i <= la; i++) {
            const temp = row[i];
            row[i] = a[i - 1] === b[j - 1]
                ? prev
                : 1 + Math.min(prev, row[i], row[i - 1]);
            prev = temp;
        }
    }

    return row[la];
}

// ── Levenshtein Scoring Helper ────────────────────────────────────────────────

/**
 * Score a name token fuzzy match using Levenshtein distance.
 *
 * Rules:
 *  - Exact match          → full `exactWeight` (handled by caller; returns 0 here)
 *  - 1-edit, length > 4  → 0.6  (e.g. "Jhon" → "John", "Perez" → "Pérez")
 *  - 2-edit, length > 7  → 0.3  (e.g. "Maldonado" → "Maldovado")
 *  - Otherwise            → 0    (too risky for short tokens)
 *
 * Length gates are mandatory: without them, short common tokens like "Ana"
 * would spuriously match "uno" (distance 2) or "la" (distance 2).
 *
 * Only intended for `name_word` tokens — phone/email must stay exact.
 *
 * @param input  - normalised input token (from user data being checked)
 * @param stored - normalised stored token (from duplicate_tokens index)
 * @returns fractional score contribution (0 if no partial match)
 */
export function fuzzyNameScore(input: string, stored: string): number {
    if (input === stored) return 0; // exact — caller already added full weight
    const dist = levenshtein(input, stored);
    if (dist === 1 && input.length > 4) return 0.6;
    if (dist === 2 && input.length > 7) return 0.3;
    return 0;
}
