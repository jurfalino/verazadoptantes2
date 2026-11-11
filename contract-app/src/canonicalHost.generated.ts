/**
 * Written by CI (.github/workflows/contract-app.yml, "Canonical host" step) from the GitHub variable
 * CANONICAL_HOST_STAGING / CANONICAL_HOST_PROD. Committed empty = no redirect (local, or variable unset).
 * Built in rather than a Pages env var because `wrangler pages deploy` wiped the project's env vars on every deploy.
 */
export const CANONICAL_HOST = '';
