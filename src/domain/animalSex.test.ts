import { describe, it, expect } from 'vitest';
import { isFemaleAnimal } from './animalSex';

describe('isFemaleAnimal', () => {
    it('recognises the form value and the import value, any case', () => {
        expect(isFemaleAnimal('hembra')).toBe(true);
        expect(isFemaleAnimal('Hembra')).toBe(true);
        expect(isFemaleAnimal('female')).toBe(true);
        expect(isFemaleAnimal(' FEMALE ')).toBe(true);
    });

    it('male and unknown fall back to the existing wording', () => {
        expect(isFemaleAnimal('macho')).toBe(false);
        expect(isFemaleAnimal('male')).toBe(false);
        expect(isFemaleAnimal('')).toBe(false);
        expect(isFemaleAnimal(null)).toBe(false);
        expect(isFemaleAnimal(undefined)).toBe(false);
    });
});
