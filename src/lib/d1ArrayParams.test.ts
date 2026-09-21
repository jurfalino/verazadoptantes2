import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * D1 does not expand an array bound parameter: `inArray(col, ids)` becomes
 * `IN (?)` with one value however long `ids` is, so it silently matches the
 * first element and drops the rest. No error, just quietly wrong rows.
 *
 * This is a ratchet, not a clean sweep. The files below are known to still do
 * it and are recorded so the list can only shrink; anything NEW fails here.
 * Fixing one means deleting its line, which this test also requires.
 *
 * The sanctioned replacement is a per-id fan-out — see
 * `hydrateDuplicateMatches.ts:53` — or a hand-built `IN (?, ?, …)` with one
 * bind per value, chunked under D1's 100-parameter cap.
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

/** A call, not a mention: `inArray(` in code, ignoring comments that discuss it. */
const usesArrayParam = (source: string): boolean =>
    source.split(/\n/).some(line => {
        const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
        return /\binArray\s*\(/.test(code) || /sql`[^`]*\bIN\s*\$\{/.test(code);
    });

describe('D1 array parameters', () => {
    it('only the recorded files still bind an array to IN (…)', () => {
        const offenders = walk(join(process.cwd(), 'src'))
            .filter(f => usesArrayParam(readFileSync(f, 'utf8')))
            .map(f => relative(process.cwd(), f))
            .sort();
        expect(offenders).toEqual([...KNOWN_VIOLATIONS].sort());
    });
});
