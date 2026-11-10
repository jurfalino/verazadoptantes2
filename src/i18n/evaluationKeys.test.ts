import { describe, it, expect } from 'vitest';
import { es } from './locales/es';
import { en } from './locales/en';
import { pt } from './locales/pt';

function paths(obj: unknown, prefix = ''): string[] {
    if (typeof obj !== 'object' || obj === null) return [prefix];
    return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => paths(v, prefix ? `${prefix}.${k}` : k));
}
function get(obj: any, path: string): unknown {
    return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

const ROOTS = ['evaluation', 'common.actor_automatic', 'audit.event_application_closed'];
const locales = { es, en, pt } as const;

describe('evaluation copy', () => {
    for (const root of ROOTS) {
        it(`${root} exists with the same keys in es, en and pt, all non-empty strings`, () => {
            const base = paths(get(es, root), root).sort();
            expect(base.length).toBeGreaterThan(0);
            for (const [name, loc] of Object.entries(locales)) {
                expect(paths(get(loc, root), root).sort(), name).toEqual(base);
                for (const p of base) {
                    const v = get(loc, p);
                    expect(typeof v, `${name}:${p}`).toBe('string');
                    expect((v as string).trim().length, `${name}:${p}`).toBeGreaterThan(0);
                }
            }
        });
    }
});
