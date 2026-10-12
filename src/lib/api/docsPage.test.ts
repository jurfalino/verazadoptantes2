import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { CSP, INLINE, INLINE_SHA256, PAGE, SCALAR_SRI, SCALAR_VERSION } from './docsPage';

describe('API docs page', () => {
    it('the CSP hash matches the inline script exactly (else the page renders blank)', () => {
        expect(INLINE_SHA256).toBe(`sha256-${createHash('sha256').update(INLINE).digest('base64')}`);
        expect(PAGE).toContain(`<script>${INLINE}</script>`);
    });
    it('loads one pinned Scalar build with SRI, with the proxy and telemetry off', () => {
        expect(SCALAR_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
        expect(PAGE).toContain(`integrity="${SCALAR_SRI}"`);
        expect(INLINE).toContain("proxyUrl: ''");
        expect(INLINE).toContain('telemetry: false');
        expect(CSP).toContain("connect-src 'self'");
    });
});
