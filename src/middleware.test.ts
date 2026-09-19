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
