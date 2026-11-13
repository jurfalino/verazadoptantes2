import { describe, it, expect } from 'vitest';
import { filterShareAnimals, shareSpeciesKey, shareSpeciesPresent, sortShareAnimals, formAnimalForLink, type ShareAnimal } from './shareFormAnimals';

const a = (over: Partial<ShareAnimal>): ShareAnimal => ({
    id: 'x', name: 'X', species: 'dog', sex: null, color: null, photo: null, addedAtMs: 0, candidates: 0, ...over,
});

describe('shareSpeciesKey', () => {
    it('reads Spanish and English species words', () => {
        expect(shareSpeciesKey('Perro')).toBe('dog');
        expect(shareSpeciesKey('gato')).toBe('cat');
        expect(shareSpeciesKey('cat')).toBe('cat');
        expect(shareSpeciesKey('conejo')).toBe('other');
        expect(shareSpeciesKey(null)).toBe('other');
    });
});

describe('filterShareAnimals', () => {
    const list = [
        a({ id: '1', name: 'Mora', species: 'gato', color: 'Negra' }),
        a({ id: '2', name: 'Rayo', species: 'perro', color: 'negro con blanco' }),
        a({ id: '3', name: 'Simbá', species: 'cat', color: 'naranja' }),
        a({ id: '4', name: null, species: 'dog', color: 'marrón' }),
    ];
    const label = (k: 'dog' | 'cat' | 'other') => (k === 'dog' ? 'Perro' : k === 'cat' ? 'Gato' : 'Otro');

    it('an empty search and «all» keep every animal, in order', () => {
        expect(filterShareAnimals(list, { query: '  ', species: 'all' }, label).map(x => x.id)).toEqual(['1', '2', '3', '4']);
    });
    it('finds by colour when the name is forgotten', () => {
        expect(filterShareAnimals(list, { query: 'negr', species: 'all' }, label).map(x => x.id)).toEqual(['1', '2']);
    });
    it('ignores accents and case both ways', () => {
        expect(filterShareAnimals(list, { query: 'SIMBA', species: 'all' }, label).map(x => x.id)).toEqual(['3']);
        expect(filterShareAnimals(list, { query: 'marron', species: 'all' }, label).map(x => x.id)).toEqual(['4']);
    });
    it('matches the species word the rescuer sees', () => {
        expect(filterShareAnimals(list, { query: 'gato', species: 'all' }, label).map(x => x.id)).toEqual(['1', '3']);
    });
    it('the species buttons narrow by species', () => {
        expect(filterShareAnimals(list, { query: '', species: 'dog' }, label).map(x => x.id)).toEqual(['2', '4']);
        expect(filterShareAnimals(list, { query: 'negr', species: 'cat' }, label).map(x => x.id)).toEqual(['1']);
    });
});

describe('shareSpeciesPresent', () => {
    it('lists each species once, dogs before cats before others', () => {
        expect(shareSpeciesPresent([a({ species: 'gato' }), a({ species: 'perro' }), a({ species: 'cat' })])).toEqual(['dog', 'cat']);
        expect(shareSpeciesPresent([a({ species: 'conejo' }), a({ species: 'gato' })])).toEqual(['cat', 'other']);
    });
});

describe('sortShareAnimals', () => {
    it('newest first; equal dates keep a stable order by name', () => {
        const out = sortShareAnimals([
            a({ id: 'old', name: 'B', addedAtMs: 1 }),
            a({ id: 'new', name: 'A', addedAtMs: 3 }),
            a({ id: 'tieB', name: 'Bruno', addedAtMs: 2 }),
            a({ id: 'tieA', name: 'Ana', addedAtMs: 2 }),
        ]);
        expect(out.map(x => x.id)).toEqual(['new', 'tieA', 'tieB', 'old']);
    });
    it('an animal with no date goes last', () => {
        expect(sortShareAnimals([a({ id: 'none', addedAtMs: null }), a({ id: 'dated', addedAtMs: 5 })]).map(x => x.id)).toEqual(['dated', 'none']);
    });
});

describe('formAnimalForLink', () => {
    const team = ['ana@x.org', 'beto@x.org'];
    const row = { name: 'Juanete', addedBy: 'Beto@X.org ', recordType: 'available', adopterId: null, listed: null };

    it('names an available animal of the link owner\'s team', () => {
        expect(formAnimalForLink(row, team)).toEqual({ name: 'Juanete', publicPhoto: true });
    });
    it('a fostered animal still takes applications', () => {
        expect(formAnimalForLink({ ...row, recordType: 'foster', adopterId: 'foster-home' }, team)).toEqual({ name: 'Juanete', publicPhoto: true });
    });
    it('an animal of another team is never named (forged ?animal=)', () => {
        expect(formAnimalForLink({ ...row, addedBy: 'stranger@y.org' }, team)).toBeNull();
    });
    it('an adopted animal or an adopter event is never named', () => {
        expect(formAnimalForLink({ ...row, recordType: 'adoption', adopterId: 'p1' }, team)).toBeNull();
        expect(formAnimalForLink({ ...row, recordType: 'observation', adopterId: 'p1' }, team)).toBeNull();
    });
    it('a missing animal or a nameless one is not shown', () => {
        expect(formAnimalForLink(undefined, team)).toBeNull();
        expect(formAnimalForLink({ ...row, name: '  ' }, team)).toBeNull();
    });
    it('the photo is public only while the animal is in the public catalogue', () => {
        expect(formAnimalForLink({ ...row, listed: 0 }, team)).toEqual({ name: 'Juanete', publicPhoto: false });
        expect(formAnimalForLink({ ...row, listed: 1 }, team)).toEqual({ name: 'Juanete', publicPhoto: true });
    });
});
