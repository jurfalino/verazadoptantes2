import { describe, it, expect } from 'vitest';
import { hasRemainingLinks, decideAnimalFate, NO_LINKS, type AnimalLinks } from './animalDeletion';

const links = (o: Partial<AnimalLinks> = {}): AnimalLinks => ({ ...NO_LINKS, ...o });

describe('hasRemainingLinks', () => {
    it('is false only when every category is empty', () => {
        expect(hasRemainingLinks(links())).toBe(false);
    });

    it.each([
        ['otherPlacements', 'custody by another adopter, or an earlier ended span'],
        ['adopterEvents', 'a follow-up or return carrying this animal_id'],
        ['animalEvents', 'the animal’s own care log'],
        ['formsAndContracts', 'a form submission or contract invitation'],
    ] as const)('treats %s as a link (%s)', (key, _why) => {
        expect(hasRemainingLinks(links({ [key]: 1 }))).toBe(true);
    });
});

describe('decideAnimalFate', () => {
    it('keeps an animal that is still referenced anywhere', () => {
        // The record being deleted is one of several — removing it must not
        // take the animal with it.
        expect(decideAnimalFate({ links: links({ otherPlacements: 1 }) })).toBe('keep');
        expect(decideAnimalFate({ links: links({ animalEvents: 3 }) })).toBe('keep');
    });

    it('soft-deletes an animal whose last link is being removed', () => {
        expect(decideAnimalFate({ links: links() })).toBe('soft-delete');
    });

    it('keeps it anyway when the user asked to', () => {
        // The "Conservar el animal" option: drop the adoption record, leave the
        // animal in Mis Animales as available.
        expect(decideAnimalFate({ links: links(), keepAnimal: true })).toBe('keep');
    });

    it('ignores keepAnimal when the animal was never at risk', () => {
        // Not a contradiction — just means the flag changes nothing here, so
        // the UI is free to send it unconditionally.
        expect(decideAnimalFate({ links: links({ adopterEvents: 2 }), keepAnimal: true })).toBe('keep');
    });

    it('never soft-deletes on a negative or malformed count', () => {
        // Counts come from COUNT(*) queries; a failed query must degrade to
        // "keep", never to destroying the animal.
        expect(decideAnimalFate({ links: links({ otherPlacements: -1 }) })).toBe('keep');
        expect(decideAnimalFate({ links: links({ animalEvents: NaN }) })).toBe('keep');
    });
});
