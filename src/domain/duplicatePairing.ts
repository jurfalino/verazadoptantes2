/**
 * Which shared index values may pair two records in the duplicate Scan.
 *
 * A value shared by many records says nothing about any two of them: a social
 * handle on 9+ records is a rescuer's contact pasted across imports, and an
 * address word on 6+ records is a place ("villa", "caba", "capital", "buenos")
 * — pairing on it turned "lives in the same area" into ~2,000 suggestions
 * (review 2026-10-11). One such value on N records would spawn N·(N-1)/2 pairs.
 */
export const SHARED_SOCIAL_HANDLE_CAP = 8;
export const SHARED_ADDRESS_WORD_CAP = 5;

export function pairsOnSharedToken(tokenType: string, sharedByRecords: number): boolean {
    if ((tokenType === 'social' || tokenType === 'social_handle') && sharedByRecords > SHARED_SOCIAL_HANDLE_CAP) return false;
    if (tokenType === 'address_word' && sharedByRecords > SHARED_ADDRESS_WORD_CAP) return false;
    return true;
}

/** Points per shared signal in the duplicate Scan. */
export const SCAN_SCORE: Readonly<Record<string, number>> = {
    source_url: 100,
    phone: 50,
    email: 50,
    social: 40,
    name_full: 30,
    address_word: 25,
    name_word: 20,
};

/**
 * Score one candidate pair from what it shares (`values[type]` = the shared
 * values of that type). ≥ 50 high, ≥ 25 medium, ≥ 10 low, below 10 dropped.
 *
 * Address words count as a real shared address (25, medium) only when the
 * house number is among them: two shared words without a number ("rivadavia",
 * "moron") mean the same street or town, not the same person — that pair is
 * low (10). Before 2.56.155 address entries were never indexed, so this rule
 * had never run on real data; a simulated production Scan put 48 such pairs in
 * the medium tier.
 */
export function scorePair(values: Record<string, string[]>): number {
    let score = 0;
    for (const [type, shared] of Object.entries(values)) {
        const count = shared.length;
        if (type === 'name_word') {
            score += count >= 2 ? SCAN_SCORE.name_word : 5; // 1 word = 5pts
        } else if (type === 'address_word') {
            if (count < 2) continue; // 1 address word = 0pts (too noisy)
            const hasHouseNumber = shared.some(w => /^\d+$/.test(w));
            score += hasHouseNumber ? SCAN_SCORE.address_word : 10;
        } else {
            score += SCAN_SCORE[type] || 0;
        }
    }
    return score;
}

export function confidenceOf(score: number): 'high' | 'medium' | 'low' {
    return score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';
}
