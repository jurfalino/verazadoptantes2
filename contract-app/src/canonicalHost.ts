/**
 * The public site moved to enadopcion.org (Jon 2026-11-11). Links already shared and QR codes already
 * printed point at the old *.pages.dev addresses — those (and www) answer a 301 to the same path on the
 * canonical host. Used by functions/_middleware.ts; pure so it is testable.
 *
 * `canonicalHost` comes from the Pages project's CANONICAL_HOST variable: unset = no redirect at all, so
 * production only starts redirecting once buenadoptante.org accepts requests from the new address.
 */

/** Hosts that are only ever an older name for the canonical one. Preview deployments (<hash>.adoptions…) are not. */
const LEGACY_HOSTS = new Set([
    'adoptions.pages.dev',
    'adoptions-staging.pages.dev',
    'www.enadopcion.org',
    'www.staging.enadopcion.org',
]);

/** A bare hostname only. Anything else (a scheme, a port, a path) would leave the URL unchanged → a 301 to itself. */
const BARE_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export function canonicalRedirect(requestUrl: string, canonicalHost: string | undefined | null): string | null {
    const target = (canonicalHost ?? '').trim().toLowerCase();
    if (!BARE_HOST.test(target)) return null;
    const url = new URL(requestUrl);
    const host = url.hostname.toLowerCase();
    if (host === target || !LEGACY_HOSTS.has(host)) return null;
    url.protocol = 'https:';
    url.hostname = target;
    url.port = '';
    return url.toString();
}
