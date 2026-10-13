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
    it('half years become months', () => {
        expect(parseAgeText('1,5 años')).toEqual({ value: 18, unit: 'months' });
    });
    it('anything else is refused, not guessed', () => {
        for (const bad of ['', 'cachorro', 'dos años', '0 meses', '45 años', 'años 2', null]) expect(parseAgeText(bad)).toBeNull();
    });
});
