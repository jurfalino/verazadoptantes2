import { FLAG_REASONS } from './constants';
import type { AdopterFlags } from '@/types/adopter';

/**
 * Build AdopterFlags from a list of flag reason strings.
 * 
 * Uses FLAG_REASONS constants to prevent string mismatches
 * (e.g., 'inaccurate' vs 'inaccurate_information' bug).
 * 
 * Note: tooManyAdoptions/tooManyRequests are left null — callers
 * fill these from period-based threshold logic after calling this function.
 */
export function buildFlags(
    flagReasons: string[],
    systemDuplicateCount: number
): AdopterFlags {
    return {
        inaccurate: flagReasons.includes(FLAG_REASONS.INACCURATE),
        duplicate: flagReasons.includes(FLAG_REASONS.DUPLICATE),
        systemDuplicate: systemDuplicateCount > 0,
        verified_identity: flagReasons.includes(FLAG_REASONS.VERIFIED_IDENTITY),
        verified_address: flagReasons.includes(FLAG_REASONS.VERIFIED_ADDRESS),
        tooManyAdoptions: null,
        tooManyRequests: null,
    };
}
