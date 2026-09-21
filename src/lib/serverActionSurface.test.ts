import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * A `'use server'` module's every export is a POST endpoint the browser can
 * call, with arguments the browser chooses. `src/app/actions/notifications.ts`
 * was one, so all thirteen of its exports were on the wire:
 * `createNotification` took the recipient, title, body and click-through URL and
 * checked none of them, and the read side let any caller page through anyone's
 * bell, whose `metadata` carries adopter name, phone, address and DNI.
 *
 * This guard keeps the module off the wire. It deliberately does NOT rely on
 * where the directive sits: ECMAScript ignores leading comments when looking for
 * a directive prologue, so `'use server'` placed below a doc comment is just as
 * live as one on line 1. The first version of this test only read the first ten
 * lines, and the module's own twenty-line header was enough to hide it — the
 * build registered all thirteen actions again with both tests green.
 *
 * What it cannot see is a differently-named wrapper in some other action module
 * (`export async function push(d) { return createNotification(d) }`), because
 * that is indistinguishable from an ordinary action that happens to notify
 * someone. The CI step `Assert notifications are not server actions` reads the
 * compiled server-reference manifest after the build and covers that case.
 */

const SRC = join(process.cwd(), 'src');

const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(p);
    }
    return out;
};

/**
 * True when the module is a server-action module, by the language's own rule:
 * a directive prologue may sit under any number of comments and blank lines.
 */
export const isUseServerModule = (source: string): boolean => {
    let rest = source;
    for (;;) {
        const before = rest;
        rest = rest.replace(/^\s+/, '')
            .replace(/^\/\*[\s\S]*?\*\//, '')
            .replace(/^\/\/[^\n]*\n?/, '');
        if (rest === before) break;
    }
    return /^(['"])use server\1\s*;?/.test(rest);
};

/** Symbols that must never be reachable from a browser, whatever file they live in. */
const MUST_NOT_BE_ACTIONS = [
    // Write side: attacker-chosen recipient, title, body and link.
    'createNotification',
    'notifyAdmins',
    'notifyOrgMembers',
    // Read side: another user's bell, including adopter PII in `metadata`.
    'getNotifications',
    'getNotificationsPaginated',
    'getNotificationTypes',
    'getUnreadCount',
    // Destructive, against any named address.
    'markNotificationRead',
    'markAllNotificationsRead',
    'dismissNotification',
    'dismissAllNotifications',
    // An email-to-real-name oracle for any address.
    'resolveDisplayName',
    'resolveDisplayNames',
    // Takes the requester as an argument: reachable means forging one.
    'fileAccessRequestFor',
];

const files = walk(SRC);

describe('server-action surface', () => {
    it('no trusted helper is exported from a "use server" module', () => {
        const offenders: string[] = [];
        for (const file of files) {
            const source = readFileSync(file, 'utf8');
            if (!isUseServerModule(source)) continue;
            const rel = relative(process.cwd(), file);

            // `export * from './x'` re-exports whatever x has, so it cannot be cleared.
            if (/^\s*export\s+\*\s+from\s/m.test(source)) {
                offenders.push(`${rel}: export * makes its surface unverifiable`);
            }
            for (const symbol of MUST_NOT_BE_ACTIONS) {
                const shapes: Array<[RegExp, string]> = [
                    // export async function createNotification(
                    [new RegExp(`^\\s*export\\s+(async\\s+)?(function|const|let|var)\\s+${symbol}\\b`, 'm'), 'declares'],
                    // export { createNotification } / export { createNotification as x }
                    [new RegExp(`^\\s*export\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}`, 'm'), 're-exports'],
                    // export const notifyAnyone = createNotification
                    [new RegExp(`^\\s*export\\s+(const|let|var)\\s+\\w+\\s*=\\s*${symbol}\\s*[;\\n]`, 'm'), 'aliases'],
                ];
                for (const [re, verb] of shapes) {
                    if (re.test(source)) offenders.push(`${rel}: ${verb} ${symbol}`);
                }
            }
            // A default export in a module that touches one of these is unreviewable by name.
            if (/^\s*export\s+default\b/m.test(source) && MUST_NOT_BE_ACTIONS.some(s => new RegExp(`\\b${s}\\b`).test(source))) {
                offenders.push(`${rel}: default-exports something built on a trusted helper`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('the notifications module is not a server-action module, wherever the directive is put', () => {
        const source = readFileSync(join(SRC, 'app/actions/notifications.ts'), 'utf8');
        expect(isUseServerModule(source)).toBe(false);
    });

    it('recognises a directive that hides below a comment', () => {
        expect(isUseServerModule("/**\n * a long header\n */\n'use server';\n")).toBe(true);
        expect(isUseServerModule("// a note\n\n'use server'\n")).toBe(true);
        expect(isUseServerModule("/* x */ import a from 'b';\n'use server';\n")).toBe(false);
    });
});
