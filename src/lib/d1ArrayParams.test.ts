import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * D1 does not expand an array bound parameter: `inArray(col, ids)` becomes
 * `IN (?)` with one value however long `ids` is, so it silently matches the
 * first element and drops the rest. No error, just quietly wrong rows. That is
 * how a user in two organizations lost the second one everywhere, including
 * from the recipient list for contract, form and member notifications.
 *
 * A ratchet, not a clean sweep: the files below still do it and are recorded so
 * the list can only shrink. Anything new fails here. Fixing one means deleting
 * its line, which this test also requires, so the list cannot drift.
 *
 * The sanctioned replacement is a per-id fan-out (see
 * `hydrateDuplicateMatches.ts:53`) or a hand-built `IN (?, ?, …)` with one bind
 * per value, chunked under D1's 100-parameter cap.
 */

const KNOWN_VIOLATIONS = [
    'src/app/actions/duplicates.ts',
    'src/app/actions/userNames.ts',
    'src/app/api/quick-counts/route.ts',
];

const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(p);
    }
    return out;
};

/**
 * Strip comments so prose about the rule is not mistaken for a breach of it.
 * `//` only starts a comment when it is not the `//` of a URL scheme.
 */
const stripComments = (source: string): string =>
    source
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** Any way of handing a whole array to the database as one bound parameter. */
export const usesArrayParam = (source: string): string | null => {
    const code = stripComments(source);

    // drizzle's helper, under its own name or an alias: `inArray as anyOf`.
    const aliased = code.match(/\binArray\s+as\s+(\w+)/);
    if (aliased && new RegExp(`\\b${aliased[1]}\\s*\\(`).test(code)) return `inArray aliased as ${aliased[1]}`;
    if (aliased) return `imports inArray as ${aliased[1]}`;
    if (/\binArray\s*\(/.test(code)) return 'inArray(';

    // A raw template that interpolates into an IN list, with or without the
    // parentheses and across however many lines: sql`… IN (${ids}) …`.
    // Interpolating a prepared FRAGMENT is the sanctioned pattern — `sql.join`
    // emits one bind per value — so only a bare array is a breach.
    for (const tpl of code.match(/sql`[^`]*`/g) || []) {
        for (const m of tpl.matchAll(/\bIN\s*\(?\s*\$\{([^}]*)\}/gi)) {
            const expr = m[1].trim();
            if (/\bsql\s*\./.test(expr)) continue;                    // sql.join(…) / sql.raw(…) inline
            if (!/^[A-Za-z_$][\w$]*$/.test(expr)) continue;             // not a bare identifier
            if (new RegExp(`\\b${expr}\\s*=\\s*sql\\s*\\.`).test(code)) continue; // const x = sql.join(…)
            return 'sql`… IN ${' + expr + '}`';
        }
    }
    return null;
};

describe('D1 array parameters', () => {
    it('only the recorded files still bind an array to IN (…)', () => {
        const offenders = walk(join(process.cwd(), 'src'))
            .map(f => [relative(process.cwd(), f), usesArrayParam(readFileSync(f, 'utf8'))] as const)
            .filter(([, hit]) => hit)
            .map(([rel]) => rel)
            .sort();
        expect(offenders).toEqual([...KNOWN_VIOLATIONS].sort());
    });

    it('recognises the shapes the first version missed', () => {
        expect(usesArrayParam('const x = sql`org_id IN (${ids})`;')).toBeTruthy();
        expect(usesArrayParam('const x = sql`org_id\n  IN (${ids})\n`;')).toBeTruthy();
        expect(usesArrayParam("import { inArray as anyOf } from 'drizzle-orm';\nanyOf(c, ids);")).toBeTruthy();
        expect(usesArrayParam("fetch('http://a').then(() => inArray(c, ids))")).toBeTruthy();
        expect(usesArrayParam('// we never use inArray here\nconst x = 1;')).toBeNull();
        expect(usesArrayParam('const x = sql`id IN (?, ?)`;')).toBeNull();
        // The sanctioned fragment pattern is not a breach.
        expect(usesArrayParam('const inList = sql.join(ids.map(i => sql`${i}`), sql`, `);\nconst q = sql`id IN (${inList})`;')).toBeNull();
        expect(usesArrayParam('const q = sql`id NOT IN (${sql.raw(LIST)})`;')).toBeNull();
    });
});
