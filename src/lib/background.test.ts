import { describe, it, expect, vi, beforeEach } from 'vitest';

const waitUntil = vi.fn();
let contextAvailable = true;
vi.mock('@cloudflare/next-on-pages', () => ({
    getRequestContext: () => { if (!contextAvailable) throw new Error('no request context'); return { ctx: { waitUntil } }; },
}));
const error = vi.fn((..._args: unknown[]) => 'abc12345'); const info = vi.fn((..._args: unknown[]) => undefined);
vi.mock('./logger', () => ({ logger: { error: (...a: unknown[]) => error(...a), info: (...a: unknown[]) => info(...a), warn: vi.fn(), debug: vi.fn() } }));

import { runAfterResponse } from './background';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

beforeEach(() => { waitUntil.mockReset(); error.mockClear(); info.mockClear(); contextAvailable = true; });

/**
 * Work started after a server action has answered is not guaranteed to finish on
 * Cloudflare: the worker may be torn down once the response is sent. That is how
 * "someone added a contact detail" notifications and automatic access requests
 * never once ran in production (0 rows and 0 log lines from May to 2026-09-19).
 */
describe('runAfterResponse', () => {
    it('hands the work to waitUntil, so the platform keeps the worker alive for it', async () => {
        let ran = false;
        await runAfterResponse('notifyApprovers', async () => { ran = true; }, { adopterId: 'a1' });
        expect(waitUntil).toHaveBeenCalledTimes(1);
        await waitUntil.mock.calls[0][0];
        expect(ran).toBe(true);
    });

    it('does not make the caller wait when waitUntil is available', async () => {
        let release!: () => void;
        const slow = new Promise<void>(r => { release = r; });
        await runAfterResponse('slow', () => slow);          // resolves although `slow` has not
        expect(waitUntil).toHaveBeenCalledTimes(1);
        release();
    });

    it('waits for the work itself when there is no waitUntil, rather than hoping', async () => {
        contextAvailable = false;
        let ran = false;
        await runAfterResponse('notifyApprovers', async () => { await Promise.resolve(); ran = true; });
        expect(ran).toBe(true);
    });

    it('never throws into the caller, and logs a failure with its name and context', async () => {
        contextAvailable = false;
        await expect(runAfterResponse('autoAccessRequest', async () => { throw new Error('D1 down'); }, { adopterId: 'a1', actor: 'x@y' })).resolves.toBeUndefined();
        expect(error).toHaveBeenCalledTimes(1);
        const [message, err, data] = error.mock.calls[0] as unknown as [string, Error, Record<string, unknown>];
        expect(message).toContain('autoAccessRequest');
        expect(err.message).toBe('D1 down');
        expect(data).toMatchObject({ adopterId: 'a1', actor: 'x@y' });
    });
});

/**
 * Regression guard. The bug was not one bad line but a pattern: a notification
 * or access request started and never awaited. Eight call sites had it. This
 * fails if the pattern comes back anywhere in server code.
 */
describe('no un-awaited notifications in server code', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
            const p = join(dir, name);
            if (statSync(p).isDirectory()) walk(p);
            else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) files.push(p);
        }
    };
    walk(join(process.cwd(), 'src/app/actions'));
    walk(join(process.cwd(), 'src/app/api'));

    const BARE = [
        /^\s*import\(['"]@\/app\/actions\/notifications['"]\)\.then\(/,                 // dynamic import, then fire
        /^\s*(notify\w+|createNotification|requestPiiAccess)\([^;]*$/,                      // statement starts the call…
    ];

    it('every notification / access-request call is awaited or handed to runAfterResponse', () => {
        const offenders: string[] = [];
        for (const file of files) {
            const lines = readFileSync(file, 'utf8').split('\n');
            lines.forEach((line, i) => {
                if (BARE[0].test(line)) offenders.push(`${file}:${i + 1}`);
                // …a bare call at statement position (not `await x(`, `return x(`, `() => x(`)
                // An arrow body wrapped onto its own line (`.map(email =>\n  createNotification({`)
                // belongs to the expression above it, which is what gets awaited.
                const prev = (lines[i - 1] || '').trimEnd();
                const continuesExpression = /(=>|\(|,)$/.test(prev);
                if (BARE[1].test(line) && !/^\s*(await|return)\b/.test(line) && !continuesExpression) offenders.push(`${file}:${i + 1}`);
            });
        }
        expect(offenders.map(o => o.replace(process.cwd() + '/', ''))).toEqual([]);
    });
});
