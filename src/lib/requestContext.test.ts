import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const current = vi.hoisted(() => ({ context: null as unknown, headers: null as object | null }));
vi.mock('@cloudflare/next-on-pages', () => ({ getRequestContext: () => current.context }));
vi.mock('next/headers', () => ({
    headers: () => {
        if (!current.headers) throw new Error('outside a request');
        return current.headers;
    },
}));

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
    beforeEach(() => {
        current.context = null;
        current.headers = null;
        vi.unstubAllEnvs();
    });

    it('refuses writes only for the request that was marked read-only', async () => {
        const viewing = fakeRequest();
        const viewingHeaders = {};
        current.context = viewing.context;
        current.headers = viewingHeaders;
        await setRequestReadOnly(true);
        await expect(getRequestContext().env.DB.prepare('INSERT INTO t VALUES (1)').run()).rejects.toBeInstanceOf(ViewAsReadOnlyError);
        expect(viewing.ran).toEqual([]);

        // A different request in the same isolate is untouched.
        const other = fakeRequest();
        current.context = other.context;
        current.headers = {};
        await getRequestContext().env.DB.prepare('INSERT INTO t VALUES (2)').run();
        expect(other.ran).toEqual(['INSERT INTO t VALUES (2)']);

        // And the marked request can write again once the mark is cleared (stopping "view as").
        current.context = viewing.context;
        current.headers = viewingHeaders;
        await setRequestReadOnly(false);
        await getRequestContext().env.DB.prepare('INSERT INTO t VALUES (3)').run();
        expect(viewing.ran).toEqual(['INSERT INTO t VALUES (3)']);
    });

    it('on Cloudflare, still refuses in background work after the response, when headers() is gone', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        const viewing = fakeRequest();
        current.context = viewing.context;
        current.headers = {};
        await setRequestReadOnly(true);
        current.headers = null; // waitUntil: no request store any more
        await expect(getRequestContext().env.DB.prepare('INSERT INTO audit_log VALUES (1)').run()).rejects.toBeInstanceOf(ViewAsReadOnlyError);
        expect(viewing.ran).toEqual([]);
    });

    it('in next dev, never marks the ctx — the dev platform shares one across every request', async () => {
        vi.stubEnv('NODE_ENV', 'development');
        const shared = fakeRequest();
        current.context = shared.context;
        current.headers = {};
        await setRequestReadOnly(true);
        current.headers = {}; // the next request, same shared ctx
        await getRequestContext().env.DB.prepare('INSERT INTO t VALUES (1)').run();
        expect(shared.ran).toEqual(['INSERT INTO t VALUES (1)']);
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
