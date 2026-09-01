import { describe, it, expect } from 'vitest';
import { resolvePostHogTarget, POSTHOG_API_HOST, POSTHOG_ASSET_HOST } from './posthogProxy';

describe('resolvePostHogTarget', () => {
    it('routes static asset paths to the assets host', () => {
        expect(resolvePostHogTarget(['static', 'array.js'], '')).toBe(
            `${POSTHOG_ASSET_HOST}/static/array.js`
        );
    });

    it('routes array paths to the assets host', () => {
        expect(resolvePostHogTarget(['array', 'phc_abc', 'config.js'], '')).toBe(
            `${POSTHOG_ASSET_HOST}/array/phc_abc/config.js`
        );
    });

    it('routes everything else to the API host', () => {
        expect(resolvePostHogTarget(['e'], '')).toBe(`${POSTHOG_API_HOST}/e`);
    });

    // Regression guard: next-on-pages issue #429 silently dropped query params
    // on external rewrites, which is why this proxy is a route handler at all.
    it('preserves the query string', () => {
        expect(resolvePostHogTarget(['e'], '?ip=1&ver=1.0')).toBe(
            `${POSTHOG_API_HOST}/e?ip=1&ver=1.0`
        );
    });

    it('preserves the query string on asset paths', () => {
        expect(resolvePostHogTarget(['static', 'recorder.js'], '?v=2')).toBe(
            `${POSTHOG_ASSET_HOST}/static/recorder.js?v=2`
        );
    });

    it('handles an empty path', () => {
        expect(resolvePostHogTarget([], '')).toBe(`${POSTHOG_API_HOST}/`);
    });

    it('does not treat a path merely containing "static" as an asset', () => {
        expect(resolvePostHogTarget(['e', 'static'], '')).toBe(`${POSTHOG_API_HOST}/e/static`);
    });
});
