/**
 * Dark mode: a light-tint hover background (`hover:bg-stone-50`,
 * `hover:bg-teal-100`, `hover:bg-white`, …) renders Tailwind's raw near-white
 * colour under text that [data-theme="dark"] has already turned light — the
 * hovered option goes white-on-white (audit 2026-10-28, A2: the member «⋯»
 * items, «¿En qué hogar?», «Quitar del hogar» reasons, /my-adopters rows).
 *
 * Guard: every light-tint hover background used anywhere in src/ has a
 * [data-theme="dark"] remap in globals.css. Saturated hovers (300+ on a
 * coloured button, black/white overlays on photos) are not light tints and are
 * not checked.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'app/globals.css'), 'utf8');

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) sourceFiles(p, out);
        else if (/\.(tsx?|jsx?)$/.test(f) && !/\.test\./.test(f)) out.push(p);
    }
    return out;
}

/** A light tint: a 50–200 shade (any opacity) or white. */
const LIGHT_TINT = /^(?:(?:stone|teal|rose|amber|blue|green|purple|pink|red|indigo|emerald|sky|cyan|orange|yellow|violet|slate|gray|zinc|neutral)-(?:50|100|200)(?:\/\d+)?|white)$/;

type Variant = 'hover' | 'group-hover';

function usedLightHovers(): Map<string, Set<string>> {
    const used = new Map<string, Set<string>>();
    for (const f of sourceFiles(ROOT)) {
        const src = fs.readFileSync(f, 'utf8');
        for (const m of src.matchAll(/(?<![\w-])((?:group-)?hover):bg-([a-z]+(?:-\d+)?(?:\/\d+)?)(?![\w/-])/g)) {
            const [, variant, color] = m;
            if (!LIGHT_TINT.test(color)) continue;
            const key = `${variant}:${color}`;
            if (!used.has(key)) used.set(key, new Set());
            used.get(key)!.add(path.relative(ROOT, f));
        }
    }
    return used;
}

function darkSelector(variant: Variant, color: string): string {
    const cls = color.replace(/\//g, '\\/');
    return variant === 'hover'
        ? `[data-theme="dark"] .hover\\:bg-${cls}:hover`
        : `[data-theme="dark"] .group:hover .group-hover\\:bg-${cls}`;
}

describe('globals.css — dark remaps for light-tint hovers', () => {
    const used = usedLightHovers();

    it('finds the hovers the audit named (the scan works)', () => {
        expect(used.has('hover:stone-50')).toBe(true);
        expect(used.has('hover:teal-100')).toBe(true);
    });

    it('every light-tint hover background used in src/ is remapped for dark', () => {
        const missing = [...used].filter(([key]) => {
            const [variant, color] = key.split(':') as [Variant, string];
            return !css.includes(darkSelector(variant, color));
        }).map(([key, files]) => `${key}  (${[...files].slice(0, 3).join(', ')})`);
        expect(missing).toEqual([]);
    });
});

describe('globals.css — dark remaps for form-field borders (audit B18)', () => {
    it.each([
        '[data-theme="dark"] .border-stone-300',
        '[data-theme="dark"] .border-stone-400',
        '[data-theme="dark"] .focus\\:border-teal-500:focus',
    ])('%s is remapped', (selector) => {
        expect(css).toContain(selector);
    });
});
