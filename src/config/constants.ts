/**
 * Centralised business constants.
 *
 * Pull any "magic number" or domain-specific limit here so they can be
 * found, reviewed, and changed in one place.
 */

// ── Search ──────────────────────────────────────────────────────
/** Maximum adopter results returned from a single search query. */
export const SEARCH_RESULT_LIMIT = 50;

/** Cap on enrichment sub-queries (images, flags, etc.) per search. */
export const SEARCH_ENRICHMENT_LIMIT = 20;

// ── Stats / Analytics ───────────────────────────────────────────
/** Seconds in 90 days — used for the "last 90 days" stats window. */
export const NINETY_DAYS_IN_SECONDS = 90 * 24 * 60 * 60;

/** Seconds in 365 days — used for the "last year" stats window. */
export const ONE_YEAR_IN_SECONDS = 365 * 24 * 60 * 60;

/**
 * SQL subquery that returns admin email addresses.
 * Used in stats aggregation queries to exclude admin activity (views/searches).
 * Admins are determined by `user_profiles.role = 'admin'` (DB-backed).
 */
export const ADMIN_STATS_EXCLUSION_SQL =
    `SELECT u.email FROM user u INNER JOIN user_profiles up ON up.user_id = u.id WHERE up.role = 'admin'`;

// ── Dashboard ───────────────────────────────────────────────────
/** Number of recent activity items shown on the dashboard. */
export const DASHBOARD_RECENT_ACTIVITY_LIMIT = 4;

// ── Session ─────────────────────────────────────────────────────
/**
 * NextAuth session max-age in seconds.
 * Set to 10 years — effectively "never expire".
 */
export const SESSION_MAX_AGE_SECONDS = 315_360_000;
