import { describe, it, expect } from 'vitest';
import { keepNumberWithUnit, keepCountsTogether } from './keepNumberWithUnit';

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

describe('keepCountsTogether — a home card summary breaks only after «·» (Jon 2026-11-09)', () => {
    const NB = ' ';
    it('each count stays with its word, and «·» stays at the end of the first line', () => {
        expect(keepCountsTogether('5 disponibles · 278 adoptados')).toBe(`5${NB}disponibles${NB}· 278${NB}adoptados`);
    });
    it('the only break left is the one after «·»', () => {
        expect(keepCountsTogether('5 disponibles · 278 adoptados').split(' ')).toEqual([`5${NB}disponibles${NB}·`, `278${NB}adoptados`]);
    });
    it('«278 adoptados · ninguno disponible»: the words after «·» may still wrap among themselves', () => {
        expect(keepCountsTogether('278 adoptados · ninguno disponible')).toBe(`278${NB}adoptados${NB}· ninguno disponible`);
    });
    it('a single count', () => {
        expect(keepCountsTogether('1259 adoptantes')).toBe(`1259${NB}adoptantes`);
    });
});
