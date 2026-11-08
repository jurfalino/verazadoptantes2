import { describe, it, expect } from 'vitest';
import { keepNumberWithUnit } from './keepNumberWithUnit';

const NB = ' ';

describe('keepNumberWithUnit', () => {
    it('«venció hace 39 días» never breaks between «hace», «39» and «días»', () => {
        expect(keepNumberWithUnit('Control del primer mes · venció hace 39 días'))
            .toBe(`Control del primer mes · venció hace${NB}39${NB}días`);
    });
    it('«vence en 3 días» too', () => {
        expect(keepNumberWithUnit('vence en 3 días')).toBe(`vence en${NB}3${NB}días`);
    });
    it('leaves text without a number alone', () => {
        expect(keepNumberWithUnit('Control de la primera semana · vence hoy')).toBe('Control de la primera semana · vence hoy');
    });
});
