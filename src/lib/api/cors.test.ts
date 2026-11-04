import { describe, expect, it } from 'vitest';
import { apiPreflight, corsHeaders, withCors } from './cors';

const preflight = (url: string, requested?: string) => apiPreflight(new Request(url, {
    method: 'OPTIONS',
    headers: { origin: 'https://hoppscotch.io', 'access-control-request-method': 'POST', ...(requested ? { 'access-control-request-headers': requested } : {}) },
}));

// Every name production answers on, not just the canonical one (review of 2.56.232).
const PRODUCTION = [
    'https://buenadoptante.org/api/v1/me', 'https://www.buenadoptante.org/api/v1/me',
    'https://buenadoptante.org./api/v1/me', 'https://buenadoptante.org:8443/api/v1/me',
    'https://verazadoptantes2.pages.dev/api/v1/me', 'https://a1b2c3d4.verazadoptantes2.pages.dev/api/v1/me',
];

describe('API CORS: browsers on staging only', () => {
    it.each(PRODUCTION)('%s sends no CORS headers, so browsers stay refused', (url) => {
        expect(corsHeaders(url)).toEqual({});
        const res = preflight(url, 'authorization');
        expect(res.status).toBe(204);
        expect(res.headers.get('access-control-allow-origin')).toBeNull();
        expect(res.headers.get('access-control-allow-headers')).toBeNull();
    });

    it('staging lets any site call, and read the rate-limit headers', () => {
        for (const url of ['https://staging.buenadoptante.org/api/v1/me', 'https://staging.verazadoptantes2.pages.dev/api/v1/me']) {
            const h = corsHeaders(url);
            expect(h['Access-Control-Allow-Origin']).toBe('*');
            expect(h['Access-Control-Expose-Headers']).toContain('RateLimit-Remaining');
            expect(h['Access-Control-Expose-Headers']).toContain('x-request-id');
        }
    });

    it('a staging preflight allows the key, the JSON body and X-Dry-Run', () => {
        const res = preflight('https://staging.buenadoptante.org/api/v1/search', 'authorization,content-type,x-dry-run');
        expect(res.status).toBe(204);
        expect(res.headers.get('access-control-allow-origin')).toBe('*');
        expect(res.headers.get('access-control-allow-methods')).toContain('POST');
        expect(res.headers.get('access-control-allow-headers')).toBe('authorization,content-type,x-dry-run');
        // Never cookies: the key travels in Authorization.
        expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    });

    it('withCors adds the headers on staging and leaves production answers untouched', () => {
        const staging = withCors(new Response('{}', { status: 401 }), new Request('https://staging.buenadoptante.org/api/v1/me'));
        expect(staging.headers.get('access-control-allow-origin')).toBe('*');
        const live = withCors(new Response('{}', { status: 401 }), new Request('https://buenadoptante.org./api/v1/me'));
        expect(live.headers.get('access-control-allow-origin')).toBeNull();
    });
});
