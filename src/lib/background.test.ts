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
import ts from 'typescript';
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
 * Regression guard.
 *
 * The bug was not one bad line but a pattern: a notification or access request
 * started and never awaited, so the worker was torn down before it finished.
 * Eight call sites had it.
 *
 * The first version of this guard matched the TEXT of the shape that happened to
 * be in the files — a call whose first line carried no semicolon. It therefore
 * passed with the same bug written on one line, with `.catch(...)`, behind
 * `void`, or under the new function's name: four of five ways it could come
 * back. Encoding the spelling of a bug is not guarding against the bug.
 *
 * This version asks the compiler instead. Every statement whose value is thrown
 * away is a floating promise if it starts background work, whatever it looks
 * like, so we parse each file and look at what the statement DOES. `await`,
 * `return`, `runAfterResponse(...)`, a `.map()` inside an awaited `Promise.all`
 * — all of those use the value and are fine.
 */
describe('no un-awaited notifications in server code', () => {
    const roots = ['src/app/actions', 'src/app/api', 'src/lib'];
    const files: string[] = [];
    const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
            const p = join(dir, name);
            if (statSync(p).isDirectory()) walk(p);
            else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) files.push(p);
        }
    };
    for (const r of roots) walk(join(process.cwd(), r));

    /** Work that must never be started and forgotten. */
    const BACKGROUND_WORK = [
        'createNotification', 'notifyAdmins', 'notifyOrgMembers', 'notifyApprovers',
        'requestPiiAccess', 'fileAccessRequestFor',
    ];
    const MODULE_IMPORTS = ['@/app/actions/notifications', '@/lib/piiAccessRequest'];

    /** True when this statement starts background work of the kind above. */
    const startsBackgroundWork = (text: string): boolean =>
        BACKGROUND_WORK.some(name => new RegExp(`\\b${name}\\s*\\(`).test(text))
        || MODULE_IMPORTS.some(mod => text.includes(mod));

    const offendersIn = (source: string, fileName: string): string[] => {
        const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
        const found: string[] = [];
        const visit = (node: ts.Node) => {
            if (ts.isExpressionStatement(node)) {
                // An expression statement discards the value. `await x` and
                // `yield x` do not, and an assignment keeps it.
                const e = node.expression;
                const kept = ts.isAwaitExpression(e) || ts.isYieldExpression(e)
                    || ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.EqualsToken;
                if (!kept && startsBackgroundWork(node.getText(sf))) {
                    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
                    found.push(`${fileName}:${line + 1}`);
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sf);
        return found;
    };

    it('every notification / access-request call is awaited or handed to runAfterResponse', () => {
        const offenders = files.flatMap(f =>
            offendersIn(readFileSync(f, 'utf8'), f.replace(process.cwd() + '/', '')));
        expect(offenders).toEqual([]);
    });

    it('catches every shape the bug can come back in', () => {
        const shapes: Record<string, string> = {
            'bare one-liner': 'notifyApprovers(a, b);',
            'one-line .catch': "notifyAdmins({ x: 1 }).catch(e => logger.warn('x', e));",
            'void-prefixed': 'void notifyOrgMembers({ x: 1 });',
            'the new function name': "fileAccessRequestFor(actor, id, { justification: 'auto' });",
            'the original dynamic import': "import('@/app/actions/notifications').then(async ({ createNotification }) => {\n  await createNotification({});\n});",
            'multi-line .catch': 'notifyApprovers(a, b).catch(e => {\n  logger.error("x", e);\n});',
        };
        for (const [name, code] of Object.entries(shapes)) {
            expect(offendersIn(`async function f() {\n${code}\n}`, name), name).toHaveLength(1);
        }
    });

    it('does not flag work whose value is used', () => {
        const fine = [
            'await notifyApprovers(a, b);',
            "await runAfterResponse('x', () => notifyApprovers(a, b), {});",
            'return createNotification({});',
            'await Promise.all(list.map(e => createNotification({ userId: e })));',
            'const p = notifyAdmins({});',
        ];
        for (const code of fine) {
            expect(offendersIn(`async function f() {\n${code}\n}`, code), code).toEqual([]);
        }
    });
});
