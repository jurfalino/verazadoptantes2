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

/**
 * When a single-token search returns more results than this threshold,
 * the UI shows a refinement nudge prompting the user to add more context.
 * Common names like "Maria" or "Juan" easily exceed this.
 */
export const REFINEMENT_NUDGE_THRESHOLD = 10;

/**
 * Results scoring below this relevance % (0–100) on a multi-token query
 * are moved to the `lowRelevanceResults` bucket in SearchResponse.
 * Keeps the main list clean without silently discarding results.
 */
export const LOW_RELEVANCE_PERCENT_THRESHOLD = 10;


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

// ── Legal ────────────────────────────────────────────────────────
/**
 * Current Terms of Service version.
 *
 * HOW TO BUMP FOR A NEW T&C UPDATE:
 *   1. Increment this number (e.g. 1 → 2).
 *   2. Update the T&C content in src/app/terms/page.tsx
 *      (revise the relevant sections + update the "last updated" date).
 *   3. Deploy — no new migration needed.
 *      All users whose stored `terms_version` is lower than this value
 *      will see the dedicated "We've updated our Terms" modal on their
 *      next page load and must accept before continuing.
 *
 * NOTE: Do NOT reset country_confirmed in a migration for future bumps.
 * The banner's visibility logic handles re-prompting via the version
 * comparison alone. The one-time reset in 0033 was only needed for the
 * initial rollout when no users had a terms_version record at all.
 */
export const CURRENT_TERMS_VERSION = 1;
