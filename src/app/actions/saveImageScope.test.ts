import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * v2.56.125 — every `saveImage(...)` that pins a photo to something must say
 * what the photo is OF.
 *
 * `scope` is the 7th argument and it is optional, which makes it forgettable
 * in exactly the way that matters: omit it and the photo saves, shows up
 * everywhere inside the app, and silently never reaches the animal's public
 * page or the health record a rescuer hands to the family. Nothing fails, so
 * nobody finds out until a rescuer asks why their photo "disappeared".
 *
 * Optional it stays — the safe default has to be not-public — so this guards
 * it from the other side: a call that passes an `adoptionId` (4th argument)
 * must also pass a scope. Calls with no adoptionId are adopter-gallery photos
 * and are not addressed by it at all.
 *
 * Source-scanning rather than type-level because TypeScript cannot express
 * "required only when another optional argument is present" on a positional
 * signature, and widening saveImage to an options object would touch every
 * caller for no behavioural gain.
 */

const SRC = join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
}

/** Split a call's argument list on top-level commas — template literals and
 *  nested calls in the arguments must not be mistaken for separators. */
function topLevelArgs(args: string): string[] {
    const out: string[] = [];
    let depth = 0, tick = 0, current = '';
    for (const ch of args) {
        if (ch === '`') tick ^= 1;
        else if (!tick && '([{'.includes(ch)) depth++;
        else if (!tick && ')]}'.includes(ch)) depth--;
        if (!tick && depth === 0 && ch === ',') { out.push(current.trim()); current = ''; continue; }
        current += ch;
    }
    if (current.trim()) out.push(current.trim());
    return out;
}

describe('saveImage callers declare a scope', () => {
    it('every call that pins a photo to a record says what it is a photo of', () => {
        const offenders: string[] = [];

        for (const file of walk(SRC)) {
            const text = readFileSync(file, 'utf8');
            // The definition itself, not a call.
            if (file.endsWith(join('actions', 'images.ts'))) continue;

            const re = /saveImage\(/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(text))) {
                // Walk to the matching close paren.
                let depth = 1, i = m.index + m[0].length, tick = 0;
                while (i < text.length && depth > 0) {
                    const ch = text[i];
                    if (ch === '`') tick ^= 1;
                    else if (!tick && ch === '(') depth++;
                    else if (!tick && ch === ')') depth--;
                    i++;
                }
                const args = topLevelArgs(text.slice(m.index + m[0].length, i - 1));
                const adoptionId = args[3];
                // No 4th argument, or an explicit undefined: an adopter-gallery
                // photo. It never reaches a public surface, so it needs no scope.
                if (!adoptionId || adoptionId === 'undefined') continue;
                const scope = args[6];
                if (!["'animal'", "'placement'", "'event'"].includes(scope ?? '')) {
                    offenders.push(`${file.replace(process.cwd() + '/', '')}: saveImage(…, ${adoptionId}, …) has no scope`);
                }
            }
        }

        expect(offenders, [
            'A photo pinned to a record must declare its scope as the 7th argument:',
            "  'animal'    — the animal's own gallery. Public.",
            "  'placement' — attached while recording an adoption/tránsito. Never public.",
            "  'event'     — evidence for one timeline entry; travels with it.",
            'See adopterImages.scope in src/db/schema.ts.',
            '',
            ...offenders,
        ].join('\n')).toEqual([]);
    });

    it('recognises both scopes in the calls that exist today', () => {
        // A canary on the scanner itself: if it silently stopped matching, the
        // test above would pass on an empty set and guard nothing.
        const all = walk(SRC).map(f => readFileSync(f, 'utf8')).join('\n');
        expect(all).toContain("'image', false, 'animal')");
        expect(all).toContain("'image', false, 'placement')");
    });
});
