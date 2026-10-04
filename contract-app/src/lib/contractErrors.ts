/**
 * Catalog key for a contract API refusal the adopter should read in their own
 * language, or null when the caller should fall back to its generic message.
 * Shared by the load (GET /api/contract/by-token) and sign (POST submit) paths.
 */
export function contractErrorKey(status: number, code: string | undefined): string | null {
    if (status === 404) return 'contract.error_not_found'
    if (status !== 410) return null
    switch (code) {
        case 'used': return 'contract.error_used'
        case 'expired': return 'contract.error_expired'
        case 'already_adopted': return 'contract.error_already_adopted'
        case 'not_allowed': return 'contract.error_not_allowed'
        default: return null
    }
}
