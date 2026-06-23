/**
 * Domain constants — single source of truth for magic strings.
 * Used by both server actions (data access) and components (presentation).
 * 
 * ⚠️  If you need a new constant, add it HERE. Do NOT hardcode strings in server actions or components.
 */

export const FLAG_REASONS = {
    INACCURATE: 'inaccurate_information',
    DUPLICATE: 'duplicate',
    VERIFIED_IDENTITY: 'verified_identity',
    VERIFIED_ADDRESS: 'verified_address',
} as const;

export const RECORD_TYPES = {
    ADOPTION: 'adoption',
    REQUEST: 'adoption_request',
    OBSERVATION: 'observation',
    FOLLOW_UP: 'follow_up',
    RETURNED: 'returned_pet',
    AVAILABLE: 'available',
    FOSTER: 'foster',
} as const;

export const EVENT_TYPES = {
    SEARCH_HIT: 'search_hit',
    PROFILE_VIEW: 'profile_view',
} as const;

// User roles (user_profiles.role). Source of truth for the /admin/users role
// selects + the PUT validation. Order is ascending privilege.
export const USER_ROLES = ['viewer', 'contributor', 'moderator', 'admin'] as const;
export type UserRole = typeof USER_ROLES[number];
