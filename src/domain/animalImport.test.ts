import { describe, it, expect } from 'vitest';
import {
    parseAnimalExtraction, normalizeAge, normalizeSpecies, normalizeSex, normalizeNeutered,
    normalizePostDate, missingNiceToHave, isSameNamedAnimal, ageReferenceDate, MAX_ANIMALS_PER_POST, mergeIntoExisting, displayName, normalizePostLink,
} from './animalImport';

const NOW = new Date('2026-11-14T12:00:00Z');

describe('parseAnimalExtraction', () => {
    it('keeps what the post stated and leaves the rest empty — never guessed', () => {
        const r = parseAnimalExtraction({
            animals: [{ name: 'Rocco', species: 'perro', sex: 'male', neutered: null, ageValue: 2, ageUnit: 'years', color: 'Atigrado', details: 'Sociable', photos: [] }],
            postDate: '2026-08-12',
        }, 2, NOW);
        expect(r.animals).toEqual([{ name: 'Rocco', species: 'dog', sex: 'macho', neutered: '', ageValue: '2', ageUnit: 'years', color: 'Atigrado', details: 'Sociable', photos: [0, 1] }]);
        expect(r.postDate).toBe('2026-08-12');
    });

    it('one animal with no photos singled out takes every photo except the flyers', () => {
        const r = parseAnimalExtraction({ animals: [{ name: 'Rocco', species: 'dog' }], notAnimalPhotos: [2] }, 3, NOW);
        expect(r.animals[0].photos).toEqual([0, 1]);
    });

    it('a litter keeps each animal’s own photos, shared ones included, and drops out-of-range indexes', () => {
        const r = parseAnimalExtraction({
            animals: [
                { name: 'Mandarina', species: 'cat', photos: [0, 3] },
                { name: 'Luz', species: 'cat', photos: [2, 3, 9, -1, '1', 2] },
            ],
        }, 4, NOW);
        expect(r.animals.map(a => a.photos)).toEqual([[0, 3], [2, 3, 1]]);
    });

    it('a litter animal with no photo of its own stays without one (the rescuer picks)', () => {
        const r = parseAnimalExtraction({ animals: [{ name: 'A', species: 'cat', photos: [0] }, { name: 'B', species: 'cat' }] }, 2, NOW);
        expect(r.animals[1].photos).toEqual([]);
    });

    it('garbage in, nothing out', () => {
        expect(parseAnimalExtraction(null, 0, NOW)).toEqual({ animals: [], postDate: null });
        expect(parseAnimalExtraction({ animals: 'x' }, 0, NOW).animals).toEqual([]);
        expect(parseAnimalExtraction({ animals: [null, 3, { name: 'Ok', species: 'cat' }] }, 0, NOW).animals.map(a => a.name)).toEqual(['Ok']);
    });

    it(`caps a post at ${MAX_ANIMALS_PER_POST} animals`, () => {
        const many = Array.from({ length: 30 }, (_, i) => ({ name: `A${i}`, species: 'cat' }));
        expect(parseAnimalExtraction({ animals: many }, 0, NOW).animals).toHaveLength(MAX_ANIMALS_PER_POST);
    });
});

describe('field normalizers', () => {
    it('species: known words map to the form’s codes, others are kept as written', () => {
        expect(normalizeSpecies('Gatita')).toBe('cat');
        expect(normalizeSpecies('cachorro')).toBe('dog');
        expect(normalizeSpecies('conejo')).toBe('conejo');
        expect(normalizeSpecies(null)).toBe('');
        expect(normalizeSpecies('other')).toBe('');
    });
    it('sex and neutered: only explicit answers count', () => {
        expect(normalizeSex('hembra')).toBe('hembra');
        expect(normalizeSex('Female')).toBe('hembra');
        expect(normalizeSex('unknown')).toBe('');
        expect(normalizeNeutered(true)).toBe('1');
        expect(normalizeNeutered(false)).toBe('0');
        expect(normalizeNeutered(null)).toBe('');
        expect(normalizeNeutered('maybe')).toBe('');
    });
    it('age: plausible values only; whole years read as years, half years as months', () => {
        expect(normalizeAge(2, 'months')).toEqual({ ageValue: '2', ageUnit: 'months' });
        expect(normalizeAge(36, 'months')).toEqual({ ageValue: '3', ageUnit: 'years' });
        expect(normalizeAge(1.5, 'years')).toEqual({ ageValue: '18', ageUnit: 'months' });
        expect(normalizeAge(8.5, 'years')).toEqual({ ageValue: '9', ageUnit: 'years' });
        expect(normalizeAge(110, 'months')).toEqual({ ageValue: '9', ageUnit: 'years' });
        expect(normalizeAge('2', 'años')).toEqual({ ageValue: '2', ageUnit: 'years' });
        expect(normalizeAge(0, 'years').ageValue).toBe('');
        expect(normalizeAge(45, 'years').ageValue).toBe('');
        expect(normalizeAge(null, null).ageValue).toBe('');
    });
    it('post date: a real past calendar day or nothing', () => {
        expect(normalizePostDate('2026-08-12', NOW)).toBe('2026-08-12');
        expect(normalizePostDate('2026-02-30', NOW)).toBeNull();
        expect(normalizePostDate('2027-01-01', NOW)).toBeNull();
        expect(normalizePostDate('12/08/2026', NOW)).toBeNull();
    });
});

describe('missingNiceToHave', () => {
    it('lists the empty desired facts; «—» is empty, «No» is an answer', () => {
        expect(missingNiceToHave({ ageValue: '', sex: '', neutered: '' })).toEqual(['age', 'sex', 'neutered']);
        expect(missingNiceToHave({ ageValue: '2', sex: 'macho', neutered: '0' })).toEqual([]);
    });
});

describe('isSameNamedAnimal', () => {
    it('same name (any case/accents) and same species', () => {
        expect(isSameNamedAnimal({ name: 'Rocco', species: 'dog' }, { name: ' rocco ', species: 'perro' })).toBe(true);
        expect(isSameNamedAnimal({ name: 'Álvaro', species: 'cat' }, { name: 'alvaro', species: 'cat' })).toBe(true);
    });
    it('different species, or a description instead of a name, never matches', () => {
        expect(isSameNamedAnimal({ name: 'Luna', species: 'cat' }, { name: 'Luna', species: 'dog' })).toBe(false);
        expect(isSameNamedAnimal({ name: 'gatito', species: 'cat' }, { name: 'Gatito', species: 'cat' })).toBe(false);
        expect(isSameNamedAnimal({ name: '', species: 'cat' }, { name: '', species: 'cat' })).toBe(false);
    });
});

describe('ageReferenceDate', () => {
    it('the post date when known and sane, today otherwise', () => {
        expect(ageReferenceDate('2026-08-12', NOW).toISOString().slice(0, 10)).toBe('2026-08-12');
        expect(ageReferenceDate(null, NOW)).toBe(NOW);
        expect(ageReferenceDate('2019-01-01', NOW)).toBe(NOW);
    });
});

describe('mergeIntoExisting', () => {
    const existing = { sex: 'macho', neutered: null, color: '', microchip: null, details: 'Ya escrito', estimatedBirthDate: null, sourceUrl: null };
    it('fills only what was empty, never overwrites', () => {
        const d = new Date('2024-08-12T00:00:00Z');
        const r = mergeIntoExisting(existing, { sex: 'hembra', neutered: '1', color: 'Atigrado', microchip: '', details: 'Del post', estimatedBirthDate: d, sourceUrl: 'https://instagram.com/p/x' });
        expect(r.patch).toEqual({ neutered: 1, color: 'Atigrado', estimatedBirthDate: d, sourceUrl: 'https://instagram.com/p/x' });
        expect(r.loaded).toEqual({ neutered: null, color: '', estimatedBirthDate: null, sourceUrl: null });
    });
    it('«No» castrado is a value too', () => {
        expect(mergeIntoExisting(existing, { sex: '', neutered: '0', color: '', microchip: '', details: '', estimatedBirthDate: null, sourceUrl: '' }).patch).toEqual({ neutered: 0 });
    });
});

describe('displayName', () => {
    it('an all-caps name reads normally; anything else is kept as written', () => {
        expect(displayName('ROCCO')).toBe('Rocco');
        expect(displayName('MARÍA JOSÉ')).toBe('María José');
        expect(displayName('LuZ')).toBe('LuZ');
        expect(displayName('mandarina')).toBe('mandarina');
        expect(displayName('')).toBe('');
    });
});

describe('normalizePostLink', () => {
    it('adds the missing https and keeps real links', () => {
        expect(normalizePostLink('instagram.com/p/abc/')).toBe('https://instagram.com/p/abc/');
        expect(normalizePostLink('  https://www.facebook.com/share/p/1x/  ')).toBe('https://www.facebook.com/share/p/1x/');
        expect(normalizePostLink('https://instagram.com/p/abc mirá este')).toBe('https://instagram.com/p/abc');
    });
    it('anything else is not a link', () => {
        expect(normalizePostLink('')).toBe('');
        expect(normalizePostLink('rocco busca familia')).toBe('');
        expect(normalizePostLink('javascript:alert(1)')).toBe('');
    });
});
