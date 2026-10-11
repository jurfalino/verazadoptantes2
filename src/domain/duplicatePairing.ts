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
