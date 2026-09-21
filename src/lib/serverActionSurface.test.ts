import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * A `'use server'` file's every export is a POST endpoint the browser can call,
 * with arguments the browser chooses. Anything in one that does not itself
 * check who is calling is an open door.
 *
 * `createNotification` was exactly that: it takes the recipient, title, body and
 * click-through URL as arguments and checks nothing, so any visitor could put a
 * message of their choosing in anyone's notification bell, wearing the product's
 * own chrome. `resolveDisplayNames` answered "what is this person's real name?"
 * for any address. Neither has ever needed to be callable from a browser — every
 * caller is server-side — so the fix is to take them off the wire rather than to
 * add a check.
 *
 * `fileAccessRequestFor` is here for the same reason: it takes the requester as
 * an argument, so reaching it from a browser would mean filing PII access
 * requests in someone else's name.
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

/** True when the module is a server-action module, i.e. its exports are reachable over HTTP. */
const isUseServerModule = (source: string): boolean =>
    /^\s*(['"])use server\1\s*;?\s*$/m.test(source.split(/\n/).slice(0, 10).join('\n'));

/** Symbols that must never be reachable from a browser, whatever file they live in. */
const MUST_NOT_BE_ACTIONS = [
    'createNotification',
    'resolveDisplayName',
    'resolveDisplayNames',
    'notifyAdmins',
    'notifyOrgMembers',
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
                // A declaration: `export async function createNotification(`
                const declared = new RegExp(`^\\s*export\\s+(async\\s+)?(function|const|let|var)\\s+${symbol}\\b`, 'm');
                // A re-export: `export { createNotification } from '…'` / `export { a, createNotification as b }`
                const reExported = new RegExp(`^\\s*export\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}`, 'm');
                if (declared.test(source) || reExported.test(source)) {
                    offenders.push(`${rel}: exports ${symbol}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it('the notifications module is not a server-action module at all', () => {
        const source = readFileSync(join(SRC, 'app/actions/notifications.ts'), 'utf8');
        expect(isUseServerModule(source)).toBe(false);
    });
});
