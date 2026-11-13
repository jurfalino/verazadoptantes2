import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACCENTS } from './groupBranding';

const src = readFileSync(join(__dirname, '../../contract-app/src/lib/branding.ts'), 'utf8');
const KEYS = ['d', 'dStrong', 'dHover', 'l', 'lStrong', 'lHover'] as const;

const mirrored = [...src.matchAll(/\{\s*id:\s*'([^']+)'[^}]*\}/g)].map(m => {
    const hex = (k: string) => m[0].match(new RegExp(`\\b${k}:\\s*'(#[0-9a-fA-F]{6})'`))?.[1];
    return { id: m[1], ...Object.fromEntries(KEYS.map(k => [k, hex(k)])) };
});

describe('contract-app branding mirror', () => {
    it('has the same accent ids in the same order', () =>
        expect(mirrored.map(a => a.id)).toEqual(ACCENTS.map(a => a.id)));
    for (const a of ACCENTS) {
        it(`${a.id}: all six shades match`, () => {
            const m = mirrored.find(x => x.id === a.id);
            expect(m).toBeDefined();
            for (const k of KEYS) expect(m![k]).toBe(a[k]);
        });
    }
});
