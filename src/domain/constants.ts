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

// Animal-scoped care events (animal_events.event_type). NOT named EVENT_TYPES —
// that name is taken above for adopter_stats analytics.
export const ANIMAL_EVENT_TYPES = ['vaccination', 'deworming', 'vet_visit', 'neuter', 'note'] as const;
export type AnimalEventType = typeof ANIMAL_EVENT_TYPES[number];

/**
 * v2.56.123: the clinical subset of ANIMAL_EVENT_TYPES — the only events a
 * shared health record may show. `note` is deliberately excluded: it is
 * unconstrained free text the rescuer wrote for themselves, so it can name the
 * foster home or the adopter, and the shared page must carry no person at all.
 */
export const VET_EVENT_TYPES = ['vaccination', 'deworming', 'vet_visit', 'neuter'] as const;
export type VetEventType = typeof VET_EVENT_TYPES[number];
export const isVetEventType = (t: string | null | undefined): t is VetEventType =>
    !!t && (VET_EVENT_TYPES as readonly string[]).includes(t);

// User roles (user_profiles.role). Source of truth for the /admin/users role
// selects + the PUT validation. Order is ascending privilege.
export const USER_ROLES = ['viewer', 'contributor', 'moderator', 'admin'] as const;
export type UserRole = typeof USER_ROLES[number];

// Flag reasons stamped on adopters created via the import wizard, by the AI
// extraction's confidence band. Stored in adopter_flags.reason.
export const IMPORT_FLAGS = {
    high: 'import_high',
    medium: 'import_medium',
    low: 'import_low',
} as const;

/**
 * Every `notifications.type` the app writes (createNotification / notifyAdmins / notifyOrgMembers / the
 * follow-up cron). The bell and /notificaciones label and draw each one (components/NotificationTypeIcon,
 * `notifications.types.<type>` in es/en/pt) — a type missing here shows a generic bell and the raw key
 * (audit B4: «household_contribution», «merge_request»… had no label).
 */
export const NOTIFICATION_TYPES = [
    'contract_result', 'contract_attached', 'form_submission', 'form_attached',
    'api_record', 'api_access', 'api_access_requested',
    'profile_renamed', 'profile_rename_undone', 'profile_age_changed',
    'pii_access_request', 'pii_access_approved', 'pii_access_denied', 'pii_access_revoked',
    'contact_entry_added', 'follow_up_due', 'ownership_transferred', 'adopter_flagged', 'deletion_request', 'member_joined',
    'adopter_merged', 'merge_request', 'merge_request_resolved', 'merge_disputed', 'merge_dispute_resolved', 'pair_message',
    'household_linked', 'household_link_removed', 'household_link_disputed', 'household_contribution',
    'household_also_lives_with', 'household_relationship_changed', 'household_member_removed', 'household_member_disputed',
    'system',
] as const;
export type NotificationType = typeof NOTIFICATION_TYPES[number];
