import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const current = vi.hoisted(() => ({ context: null as unknown }));
vi.mock('@cloudflare/next-on-pages', () => ({ getRequestContext: () => current.context }));

import { getRequestContext } from './requestContext';
import { setRequestReadOnly, ViewAsReadOnlyError } from './readOnlyGuard';

function fakeRequest() {
    const ran: string[] = [];
    const DB = {
        prepare: (sql: string) => {
            const s = { bind: () => s, run: async () => { ran.push(sql); return { success: true }; } };
            return s;
        },
    };
    return { context: { env: { DB, OTHER: 'kept' }, ctx: { waitUntil: () => {} }, cf: {} }, ran };
}

describe('getRequestContext (guarded)', () => {
    beforeEach(() => { current.context = null; });

    it('refuses writes only for the request that was marked read-only', async () => {
        const viewing = fakeRequest();
        current.context = viewing.context;
        await setRequestReadOnly(true);
        await expect(getRequestContext().env.DB.prepare('INSERT INTO t VALUES (1)').run()).rejects.toBeInstanceOf(ViewAsReadOnlyError);
        expect(viewing.ran).toEqual([]);

        // A different request in the same isolate is untouched.
        const other = fakeRequest();
        current.context = other.context;
        await getRequestContext().env.DB.prepare('INSERT INTO t VALUES (2)').run();
        expect(other.ran).toEqual(['INSERT INTO t VALUES (2)']);

        // And the marked request can write again once the mark is cleared (stopping "view as").
        current.context = viewing.context;
        await setRequestReadOnly(false);
        await getRequestContext().env.DB.prepare('INSERT INTO t VALUES (3)').run();
        expect(viewing.ran).toEqual(['INSERT INTO t VALUES (3)']);
    });

    it('passes every other binding and the ctx through unchanged', () => {
        const req = fakeRequest();
        current.context = req.context;
        const ctx = getRequestContext();
        expect((ctx.env as unknown as { OTHER: string }).OTHER).toBe('kept');
        expect(ctx.ctx).toBe(req.context.ctx);
    });
});

/**
 * Importing '@cloudflare/next-on-pages' directly hands out the raw D1 binding,
 * which would let a save through while an admin is viewing as someone else.
 */
describe('no direct @cloudflare/next-on-pages imports', () => {
    const ALLOWED = new Set(['src/lib/requestContext.ts', 'src/lib/readOnlyGuard.ts']);
    const root = join(__dirname, '..', '..');

    function walk(dir: string): string[] {
        return readdirSync(dir).flatMap(name => {
            const p = join(dir, name);
            if (statSync(p).isDirectory()) return walk(p);
            return /\.(ts|tsx|js|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
        });
    }

    it('only the guard and its wrapper import it', () => {
        const pattern = /(from\s+|import\s*\(\s*|require\s*\(\s*)['"]@cloudflare\/next-on-pages['"]/;
        const offenders = walk(join(root, 'src'))
            .map(p => relative(root, p))
            .filter(p => !ALLOWED.has(p) && pattern.test(readFileSync(join(root, p), 'utf8')));
        expect(offenders).toEqual([]);
    });
});
