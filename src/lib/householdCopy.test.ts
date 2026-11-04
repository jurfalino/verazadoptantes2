import { describe, it, expect } from 'vitest';
import { householdErrorCopy, joinNames, firstName, fill } from './householdCopy';
import { es } from '@/i18n/locales/es';
import { en } from '@/i18n/locales/en';
import { pt } from '@/i18n/locales/pt';

const tFor = (dict: Record<string, unknown>) => (key: string) => {
    const v = key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), dict);
    return typeof v === 'string' ? v : key;
};

describe('householdErrorCopy (Task 8: every household / merge code has words, in es/en/pt)', () => {
    const CODES = ['identifier_required', 'household_full', 'too_many_households', 'not_authorized', 'not_found', 'conflict',
        'already_there', 'invalid', 'household_not_converted'];
    for (const [loc, dict] of [['es', es], ['en', en], ['pt', pt]] as const) {
        it(`${loc}: refusals are warnings with real copy; failures are errors`, () => {
            const t = tFor(dict as unknown as Record<string, unknown>);
            for (const code of CODES) {
                const c = householdErrorCopy(t, code);
                expect(c.refused, code).toBe(true);
                expect(c.message, code).not.toMatch(/^(adopter|errors)\./);
            }
            expect(householdErrorCopy(t, 'failed')).toEqual({ refused: false, message: t('adopter.hh_err_failed') });
            expect(householdErrorCopy(t, 'busy').refused).toBe(false);
            expect(householdErrorCopy(t, 'something new').refused).toBe(false);
        });
    }
    it('«Lo cargué por error» never promises that nothing is recorded (ledger ruling)', () => {
        for (const dict of [es, en, pt]) {
            const text = tFor(dict as unknown as Record<string, unknown>)('adopter.hh_remove_mistake_desc');
            expect(text).not.toMatch(/no queda registro|nothing is recorded|não fica registro/i);
        }
        expect(tFor(es as unknown as Record<string, unknown>)('adopter.hh_remove_mistake_desc')).toBe('Se quita sin marcarlo como corrección.');
    });
});

describe('names', () => {
    const t = tFor(es as unknown as Record<string, unknown>);
    it('joins names the Spanish way and takes first names', () => {
        expect(joinNames(t, ['Pedro Paez'])).toBe('Pedro Paez');
        expect(joinNames(t, ['Pedro Paez', 'Marta Paez'])).toBe('Pedro Paez y Marta Paez');
        expect(joinNames(t, ['A', 'B', 'C'])).toBe('A, B y C');
        expect(firstName('  Pedro Paez ')).toBe('Pedro');
        expect(fill('{a} y {a}', { a: 1 })).toBe('1 y 1');
    });
});
