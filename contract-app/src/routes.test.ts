/**
 * public/_routes.json (review M7): the canonical-host middleware (functions/_middleware.ts) runs on page
 * requests only — the hashed bundle and the root icons are served straight from the static assets. Those are
 * referenced relatively by a page that already redirected, so an old-host asset request needn't redirect.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const routes = JSON.parse(readFileSync(resolve(__dirname, '../public/_routes.json'), 'utf8')) as { version: number; include: string[]; exclude: string[] };

/** Cloudflare Pages route rules: `*` matches any run of characters (including `/`). */
const matches = (rule: string, path: string) =>
    new RegExp(`^${rule.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(path);
const runsMiddleware = (path: string) => routes.include.some(r => matches(r, path)) && !routes.exclude.some(r => matches(r, path));

describe('_routes.json: the middleware runs on pages, not on static files', () => {
    it('a valid v1 file within the 100-rule limit', () => {
        expect(routes.version).toBe(1);
        expect(routes.include.length + routes.exclude.length).toBeLessThanOrEqual(100);
    });

    it.each(['/', '/c/abc123', '/animal/luna', '/catalogo/gatitos', '/form/user-1', '/contract/abc', '/salud/tok', '/terminos'])(
        'page %s still runs it (so an old host redirects)', (path) => {
            expect(runsMiddleware(path)).toBe(true);
        });

    it.each(['/assets/index-CSvqC_6O.js', '/assets/index-xAvRPigP.css', '/icon.svg', '/vite.svg'])('static %s skips it', (path) => {
        expect(runsMiddleware(path)).toBe(false);
    });

    it('every root file in public/ (what Vite copies next to index.html) is excluded, except Pages\' own config files', () => {
        const served = readdirSync(resolve(__dirname, '../public')).filter(f => !f.startsWith('_'));
        for (const f of served) expect(runsMiddleware(`/${f}`), f).toBe(false);
    });
});
