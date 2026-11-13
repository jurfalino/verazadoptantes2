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

describe('«También pidió otro animal»: the also_applied line when the animal cannot be named', () => {
    it('reads the same in each locale\'s words', () => {
        expect(es.evaluation.status_also_applied_other).toBe('También pidió otro animal');
        expect(en.evaluation.status_also_applied_other).toBe('Also applied for another animal');
        expect(pt.evaluation.status_also_applied_other).toBe('Também pediu outro animal');
    });
});

describe('«Con solicitudes por evaluar» with nothing in it', () => {
    it('says so in each locale', () => {
        expect(es.evaluation.tab_empty).toBe('No hay solicitudes por evaluar');
        expect(en.evaluation.tab_empty).toBe('No applications to review');
        expect(pt.evaluation.tab_empty).toBe('Nenhuma candidatura para avaliar');
    });
});

describe('hidden-animal outcome lines (the animal has a name this viewer cannot see)', () => {
    it('read the same in each locale\'s words', () => {
        const want = {
            closed_other_hidden: ['el animal fue adoptado por otra persona', 'the animal was adopted by someone else', 'o animal foi adotado por outra pessoa'],
            closed_open_link_hidden: ['el animal fue adoptado', 'the animal was adopted', 'o animal foi adotado'],
            status_adopted_hidden: ['Adoptó', 'Adopted', 'Adotou'],
            status_proposed_hidden: ['En los candidatos de otro animal', 'Among another animal\'s candidates', 'Entre os candidatos de outro animal'],
        } as const;
        for (const [k, [e, n, p]] of Object.entries(want)) {
            const key = k as keyof typeof want;
            expect([es.evaluation[key], en.evaluation[key], pt.evaluation[key]]).toEqual([e, n, p]);
        }
    });
});
