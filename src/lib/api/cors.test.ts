import { describe, expect, it } from 'vitest';
import { apiPreflight, corsHeaders, withCors } from './cors';

const preflight = (url: string, requested?: string) => apiPreflight(new Request(url, {
    method: 'OPTIONS',
    headers: { origin: 'https://hoppscotch.io', 'access-control-request-method': 'POST', ...(requested ? { 'access-control-request-headers': requested } : {}) },
}));

describe('API CORS: browsers on staging only', () => {
    it('production sends no CORS headers, so browsers stay refused', () => {
        expect(corsHeaders('buenadoptante.org')).toEqual({});
        expect(corsHeaders('www.buenadoptante.org')).toEqual({});
        const res = preflight('https://buenadoptante.org/api/v1/search');
        expect(res.status).toBe(204);
        expect(res.headers.get('access-control-allow-origin')).toBeNull();
        expect(res.headers.get('access-control-allow-headers')).toBeNull();
    });

    it('staging lets any site call, and reads the rate-limit headers', () => {
        const h = corsHeaders('staging.buenadoptante.org');
        expect(h['Access-Control-Allow-Origin']).toBe('*');
        expect(h['Access-Control-Expose-Headers']).toContain('RateLimit-Remaining');
        expect(h['Access-Control-Expose-Headers']).toContain('x-request-id');
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
        const live = withCors(new Response('{}', { status: 401 }), new Request('https://buenadoptante.org/api/v1/me'));
        expect(live.headers.get('access-control-allow-origin')).toBeNull();
    });
});
