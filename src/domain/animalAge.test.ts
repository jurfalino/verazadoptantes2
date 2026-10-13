import { describe, it, expect } from 'vitest';
import { parseAgeText } from './animalAge';

describe('parseAgeText', () => {
    it('reads years and months in Spanish, English and Portuguese', () => {
        expect(parseAgeText('2 años')).toEqual({ value: 2, unit: 'years' });
        expect(parseAgeText('1 año')).toEqual({ value: 1, unit: 'years' });
        expect(parseAgeText('3 meses')).toEqual({ value: 3, unit: 'months' });
        expect(parseAgeText('6m')).toEqual({ value: 6, unit: 'months' });
        expect(parseAgeText('4 years')).toEqual({ value: 4, unit: 'years' });
        expect(parseAgeText('2 anos')).toEqual({ value: 2, unit: 'years' });
        expect(parseAgeText('5 mês')).toEqual({ value: 5, unit: 'months' });
    });
    it('weeks, half years and combinations', () => {
        expect(parseAgeText('6 semanas')).toEqual({ value: 1, unit: 'months' });
        expect(parseAgeText('10 weeks')).toEqual({ value: 2, unit: 'months' });
        expect(parseAgeText('1,5 años')).toEqual({ value: 18, unit: 'months' });
        expect(parseAgeText('1 año y 3 meses')).toEqual({ value: 15, unit: 'months' });
        expect(parseAgeText('2 years and 6 months')).toEqual({ value: 30, unit: 'months' });
    });
    it('limits apply to the total, before rounding', () => {
        expect(parseAgeText('99,5 años')).toBeNull();
        expect(parseAgeText('31 años')).toBeNull();
        expect(parseAgeText('0,4 meses')).toEqual({ value: 1, unit: 'months' });
    });
    it('anything else reads as no estimate, never a guess', () => {
        for (const bad of ['', 'cachorro', 'dos años', '0 meses', 'años 2', null]) expect(parseAgeText(bad)).toBeNull();
    });
});
