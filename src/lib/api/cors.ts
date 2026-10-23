/**
 * CORS for /api/v1 (Jon, 2026-10-23): browsers may call the API on staging and
 * preview hosts only. That is what lets a web tool like hoppscotch.io run the
 * shared test collection — without it the browser refuses every call.
 *
 * Production stays closed to browsers on purpose: a key pasted into a public web
 * page can be copied by any visitor, and refusing browser calls keeps partners
 * calling from their server. Auth is a bearer key, never a cookie, so on staging
 * `*` exposes nothing a caller doesn't already hold.
 */
import { environmentForHost } from './keys';

const EXPOSED_HEADERS = 'x-request-id, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After';
const ALLOWED_HEADERS = 'Authorization, Content-Type, X-Dry-Run';

export function corsHeaders(host: string): Record<string, string> {
    if (environmentForHost(host) === 'live') return {};
    return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': EXPOSED_HEADERS };
}

export function withCors<R extends Response>(response: R, request: Request): R {
    for (const [k, v] of Object.entries(corsHeaders(new URL(request.url).host))) response.headers.set(k, v);
    return response;
}

/** The browser's preflight (OPTIONS). Production answers it without CORS headers, so the browser refuses. */
export function apiPreflight(request: Request): Response {
    const host = new URL(request.url).host;
    const headers: Record<string, string> = { Allow: 'GET, POST, OPTIONS' };
    if (environmentForHost(host) === 'test') {
        Object.assign(headers, corsHeaders(host), {
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            // Whatever the tool asks to send: no cookies are involved, and any other
            // header is ignored by the API anyway.
            'Access-Control-Allow-Headers': request.headers.get('access-control-request-headers') || ALLOWED_HEADERS,
            'Access-Control-Max-Age': '86400',
        });
    }
    return new Response(null, { status: 204, headers });
}
