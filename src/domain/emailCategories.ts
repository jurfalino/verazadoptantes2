/**
 * Email notification categories and per-user switches. Pure — callers fetch
 * the stored JSON prefs and ask here whether a notification type may be
 * emailed.
 *
 * - A missing category means ENABLED (new categories default on).
 * - ALWAYS_ON categories cannot be switched off (they need an answer).
 * - The 'api' category is only offered to users who hold an API key.
 */

export type EmailCategory =
    | 'requests'
    | 'forms'
    | 'merges'
    | 'contact_access'
    | 'profile_changes'
    | 'api'
    | 'other';

/** Display order. */
export const EMAIL_CATEGORIES: readonly EmailCategory[] = [
    'requests',
    'forms',
    'merges',
    'contact_access',
    'profile_changes',
    'api',
    'other',
];

export const ALWAYS_ON_CATEGORIES: ReadonlySet<EmailCategory> = new Set<EmailCategory>(['requests']);

const TYPE_TO_CATEGORY: Readonly<Record<string, EmailCategory>> = {
    merge_request: 'requests',
    pii_access_request: 'requests',
    form_submission: 'forms',
    form_result: 'forms',
    contract_result: 'forms',
    form_attached: 'forms',
    contract_attached: 'forms',
    adopter_merged: 'merges',
    merge_request_resolved: 'merges',
    merge_dispute_resolved: 'merges',
    // Admins only (D50): no switch of its own.
    merge_disputed: 'other',
    duplicate_candidate: 'merges',
    pair_message: 'merges',
    pii_access_approved: 'contact_access',
    pii_access_denied: 'contact_access',
    pii_access_revoked: 'contact_access',
    ownership_transferred: 'profile_changes',
    contact_entry_added: 'profile_changes',
    household_linked: 'profile_changes',
    household_link_removed: 'profile_changes',
    household_contribution: 'profile_changes',
    // Admins only (D48): no switch of its own.
    household_link_disputed: 'other',
    api_record: 'api',
    api_access: 'api',
};

export function categoryForType(type: string): EmailCategory {
    return Object.prototype.hasOwnProperty.call(TYPE_TO_CATEGORY, type) ? TYPE_TO_CATEGORY[type] : 'other';
}

/** Each one is its own question (merge_request) or a person writing to a person (pair_message): every one is emailed. */
const NEVER_THROTTLED_TYPES: ReadonlySet<string> = new Set(['merge_request', 'pair_message']);

/**
 * What a recently emailed notification must share for this one to be
 * throttled (one email per recipient per key per 10 minutes), or null when
 * the type is never throttled. Switchable categories throttle per category.
 * The always-on category throttles per type: `pii_access_request` comes in
 * bursts from bulk imports (one per contact entry), while `merge_request`
 * is exempt and never throttles anything else.
 */
export function emailThrottleKey(type: string): string | null {
    if (NEVER_THROTTLED_TYPES.has(type)) return null;
    const category = categoryForType(type);
    return ALWAYS_ON_CATEGORIES.has(category) ? `type:${type}` : `category:${category}`;
}

export type EmailPrefs = Partial<Record<EmailCategory, boolean>>;

/** Parse stored prefs JSON. Malformed input, unknown keys and non-boolean values are dropped. */
export function parseEmailPrefs(raw: string | null | undefined): EmailPrefs {
    if (!raw) return {};
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return {};
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: EmailPrefs = {};
    for (const category of EMAIL_CATEGORIES) {
        const value = (parsed as Record<string, unknown>)[category];
        if (typeof value === 'boolean') out[category] = value;
    }
    return out;
}

export function isEmailEnabled(prefs: EmailPrefs, category: EmailCategory): boolean {
    if (ALWAYS_ON_CATEGORIES.has(category)) return true;
    return prefs[category] !== false;
}

/** Categories to show in settings; 'api' only for users with an API key. */
export function visibleCategories(hasApiKey: boolean): EmailCategory[] {
    return EMAIL_CATEGORIES.filter((c) => c !== 'api' || hasApiKey);
}
