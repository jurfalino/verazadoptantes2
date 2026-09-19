import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { DEPLOYMENT_SKEW_SENTINEL } from '@/domain/clientErrors';

/**
 * The deploy-skew guard in middleware. Next's client turns our 409 into an
 * error only if the content type is EXACTLY 'text/plain' (server-action-reducer:
 * `contentType === 'text/plain' ? await res.text() : 'An unexpected response…'`),
 * so a charset suffix would silently disable recognition — pinned here.
 */
describe('middleware deploy-skew guard', () => {
    beforeEach(() => { vi.stubEnv('APP_BUILD_ID', 'BUILD_B'); });
    afterEach(() => { vi.unstubAllEnvs(); });

    const req = (headers: Record<string, string>) =>
        new NextRequest('https://buenadoptante.org/adopter/x', { method: 'POST', headers: { host: 'buenadoptante.org', ...headers } });

    it('rejects a tab from another build with 409, exact text/plain, and a marker header', async () => {
        const { default: middleware } = await import('./middleware');
        const res = await middleware(req({ 'x-deployment-id': 'BUILD_A', 'next-action': 'abc' }));
        expect(res.status).toBe(409);
        expect(res.headers.get('content-type')).toBe('text/plain');
        expect(await res.text()).toBe(DEPLOYMENT_SKEW_SENTINEL);
        expect(res.headers.get('x-deployment-skew')).toBe('1');
        expect(res.headers.get('x-deployment-id-server')).toBe('BUILD_B');
    });

    it('lets a tab on the running build through', async () => {
        const { default: middleware } = await import('./middleware');
        const res = await middleware(req({ 'x-deployment-id': 'BUILD_B' }));
        expect(res.status).not.toBe(409);
    });

    it('lets requests without a build id through (external callers, old clients)', async () => {
        const { default: middleware } = await import('./middleware');
        const res = await middleware(req({}));
        expect(res.status).not.toBe(409);
    });
});

describe('middleware — an old tab\'s action is served by its own deployment', () => {
    const OLD = 'https://38ff5995.verazadoptantes2.pages.dev';
    beforeEach(() => {
        vi.resetModules();
        vi.stubEnv('APP_BUILD_ID', 'BUILD_B');
        vi.stubEnv('APP_DEPLOY_MAP', JSON.stringify({ BUILD_A: OLD }));
    });
    afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

    it('forwards method, path, body and cookies, adds x-forwarded-host, and returns the old build\'s answer', async () => {
        const upstream = vi.fn(async () => new Response('0:{"ok":true}', {
            status: 200, headers: { 'content-type': 'text/x-component', 'content-encoding': 'gzip', 'x-action-revalidated': '[[],0,0]' },
        }));
        vi.stubGlobal('fetch', upstream);
        const { default: middleware } = await import('./middleware');
        const res = await middleware(new NextRequest('https://buenadoptante.org/adopter/x?q=1', {
            method: 'POST', body: '["payload"]',
            headers: { host: 'buenadoptante.org', 'x-deployment-id': 'BUILD_A', 'next-action': 'abc', cookie: 'authjs.session-token=t', origin: 'https://buenadoptante.org' },
        }));

        expect(upstream).toHaveBeenCalledTimes(1);
        const [url, init] = upstream.mock.calls[0] as unknown as [URL | string, RequestInit & { headers: Headers }];
        expect(String(url)).toBe(`${OLD}/adopter/x?q=1`);
        expect(init.method).toBe('POST');
        expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe('["payload"]');
        expect(init.headers.get('x-forwarded-host')).toBe('buenadoptante.org');
        expect(init.headers.get('cookie')).toBe('authjs.session-token=t');
        expect(init.headers.get('next-action')).toBe('abc');
        expect(init.headers.get('x-skew-proxied')).toBe('1');
        expect(init.redirect).toBe('manual');

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('text/x-component');
        expect(res.headers.get('x-action-revalidated')).toBe('[[],0,0]');
        expect(res.headers.get('x-deployment-skew-proxied')).toBe('BUILD_A');
        // The body was already decoded by fetch; the stale encoding header must go.
        expect(res.headers.get('content-encoding')).toBeNull();
        expect(await res.text()).toBe('0:{"ok":true}');
    });

    it('falls back to the 409 when the old deployment cannot be reached', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connect failed'); }));
        const { default: middleware } = await import('./middleware');
        const res = await middleware(new NextRequest('https://buenadoptante.org/', {
            method: 'POST', body: '[]', headers: { host: 'buenadoptante.org', 'x-deployment-id': 'BUILD_A', 'next-action': 'abc' },
        }));
        expect(res.status).toBe(409);
        expect(res.headers.get('x-deployment-skew')).toBe('1');
    });

    it('never forwards to another host, however the path is written (SSRF)', async () => {
        // new URL('//evil.com/x', origin) resolves to evil.com. Found in the
        // pre-production review of 2.56.68.
        const upstream = vi.fn(async () => new Response('x')); vi.stubGlobal('fetch', upstream);
        const { default: middleware } = await import('./middleware');
        for (const path of ['//evil.com/x?a=1', '/\\evil.com/x', '///evil.com']) {
            const req = new NextRequest('https://buenadoptante.org/', { method: 'POST', body: '[]', headers: { host: 'buenadoptante.org', 'x-deployment-id': 'BUILD_A', 'next-action': 'abc' } });
            Object.defineProperty(req, 'nextUrl', { value: { pathname: path.split('?')[0], search: path.includes('?') ? '?' + path.split('?')[1] : '', host: 'buenadoptante.org' } });
            const res = await middleware(req);
            expect(res.status).toBe(409);
        }
        expect(upstream).not.toHaveBeenCalled();
    });

    it('falls back to the 409 when the old deployment answers with an error page', async () => {
        // A deleted deployment or a Cloudflare error page is not an action result;
        // passing it through gave the user a generic error and no notice.
        vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>gone</html>', { status: 404, headers: { 'content-type': 'text/html' } })));
        const { default: middleware } = await import('./middleware');
        const res = await middleware(new NextRequest('https://buenadoptante.org/', { method: 'POST', body: '[]', headers: { host: 'buenadoptante.org', 'x-deployment-id': 'BUILD_A', 'next-action': 'abc' } }));
        expect(res.status).toBe(409);
        expect(res.headers.get('x-deployment-skew')).toBe('1');
    });

    it('passes through a real action error from the old build (RSC content type)', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('1:E{"digest":"x"}', { status: 500, headers: { 'content-type': 'text/x-component' } })));
        const { default: middleware } = await import('./middleware');
        const res = await middleware(new NextRequest('https://buenadoptante.org/', { method: 'POST', body: '[]', headers: { host: 'buenadoptante.org', 'x-deployment-id': 'BUILD_A', 'next-action': 'abc' } }));
        expect(res.status).toBe(500);
        expect(res.headers.get('x-deployment-skew-proxied')).toBe('BUILD_A');
    });

    it('only forwards POST, and gives the old deployment a deadline', async () => {
        const upstream = vi.fn(async () => new Response('ok', { headers: { 'content-type': 'text/x-component' } })); vi.stubGlobal('fetch', upstream);
        const { default: middleware } = await import('./middleware');
        const get = await middleware(new NextRequest('https://buenadoptante.org/', { method: 'GET', headers: { host: 'buenadoptante.org', 'x-deployment-id': 'BUILD_A', 'next-action': 'abc' } }));
        expect(get.status).toBe(409);
        expect(upstream).not.toHaveBeenCalled();
        await middleware(new NextRequest('https://buenadoptante.org/', { method: 'POST', body: '[]', headers: { host: 'buenadoptante.org', 'x-deployment-id': 'BUILD_A', 'next-action': 'abc' } }));
        const [, init] = upstream.mock.calls[0] as unknown as [unknown, RequestInit];
        expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('still rejects an old tab\'s page navigation, which Next turns into a silent upgrade', async () => {
        const upstream = vi.fn(); vi.stubGlobal('fetch', upstream);
        const { default: middleware } = await import('./middleware');
        const res = await middleware(new NextRequest('https://buenadoptante.org/faq', { headers: { host: 'buenadoptante.org', 'x-deployment-id': 'BUILD_A', rsc: '1' } }));
        expect(res.status).toBe(409);
        expect(upstream).not.toHaveBeenCalled();
    });
});
