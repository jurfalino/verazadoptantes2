/**
 * CORS for /api/v1 (Jon, 2026-10-23): browsers may call the API on staging only.
 * That is what lets a web tool like hoppscotch.io run the shared test collection —
 * without it the browser refuses every call.
 *
 * Production stays closed to browsers on purpose: a key pasted into a public web
 * page can be copied by any visitor, and refusing browser calls keeps partners
 * calling from their server. Auth is a bearer key, never a cookie, so on staging
 * `*` exposes nothing a caller doesn't already hold.
 *
 * An ALLOW-list, not "anything but production": production also answers on
 * `buenadoptante.org.`, Cloudflare's other HTTPS ports and verazadoptantes2.pages.dev
 * (the master deployment; middleware's pages.dev redirect skips /api), which
 * environmentForHost read as test until 2.56.234 (independent review of 2.56.232).
 * Browser access stays a separate, explicit list either way.
 */
const BROWSER_HOSTS = new Set(['staging.buenadoptante.org', 'staging.verazadoptantes2.pages.dev', 'localhost', '127.0.0.1']);

const EXPOSED_HEADERS = 'x-request-id, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After';
const ALLOWED_HEADERS = 'Authorization, Content-Type, X-Dry-Run';

function browsersAllowed(url: string): boolean {
    return BROWSER_HOSTS.has(new URL(url).hostname);
}

export function corsHeaders(url: string): Record<string, string> {
    if (!browsersAllowed(url)) return {};
    return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': EXPOSED_HEADERS };
}

export function withCors<R extends Response>(response: R, request: Request): R {
    for (const [k, v] of Object.entries(corsHeaders(request.url))) response.headers.set(k, v);
    return response;
}

/** The browser's preflight (OPTIONS). Any other host answers it without CORS headers, so the browser refuses. */
export function apiPreflight(request: Request): Response {
    const headers: Record<string, string> = { Allow: 'GET, POST, OPTIONS' };
    if (browsersAllowed(request.url)) {
        Object.assign(headers, corsHeaders(request.url), {
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            // Whatever the tool asks to send: no cookies are involved, and any other
            // header is ignored by the API anyway.
            'Access-Control-Allow-Headers': request.headers.get('access-control-request-headers') || ALLOWED_HEADERS,
            'Access-Control-Max-Age': '86400',
        });
    }
    return new Response(null, { status: 204, headers });
}
