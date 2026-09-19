import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * public/sw.js is a plain script, not a module, so the cache-key function is
 * lifted out of the real file and executed — no copy that could drift.
 *
 * Since 2.56.61 `deploymentId` appends `?dpl=<sha>` to every /_next/static URL,
 * and the cache keyed on the full URL: every deploy stored a fresh copy of every
 * visited asset, unchanged chunks included, and nothing evicted them (audit
 * 2026-09-19, P2-1).
 */
const src = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8');
const match = src.match(/function cacheKeyFor\([\s\S]*?\n}\n/);
const cacheKeyFor = match ? (new Function(`${match[0]}; return cacheKeyFor;`)() as (url: string) => string) : null;

describe('service worker cache key', () => {
    it('exists in public/sw.js', () => {
        expect(cacheKeyFor).not.toBeNull();
    });

    it('ignores the per-deploy dpl parameter, so an unchanged chunk is cached once', () => {
        const a = cacheKeyFor!('https://buenadoptante.org/_next/static/chunks/main-abc.js?dpl=111');
        const b = cacheKeyFor!('https://buenadoptante.org/_next/static/chunks/main-abc.js?dpl=222');
        expect(a).toBe(b);
        expect(a).toBe('https://buenadoptante.org/_next/static/chunks/main-abc.js');
    });

    it('keeps any other query parameter, which may genuinely change the response', () => {
        expect(cacheKeyFor!('https://buenadoptante.org/icon-192.png?v=3&dpl=9'))
            .toBe('https://buenadoptante.org/icon-192.png?v=3');
    });

    it('bumped CACHE_VERSION past v7, evicting the copies already piled up since 2.56.61', () => {
        const v = Number(src.match(/CACHE_VERSION = 'buenaadoptante-v(\d+)'/)?.[1]);
        expect(v).toBeGreaterThanOrEqual(8);
    });
});
