import { describe, it, expect } from 'vitest';
import { decideAnimalAccess, illustrationForSpecies, tagLabel, isPubliclyListed } from './animalAccess';

describe('decideAnimalAccess', () => {
    it('is missing when the row does not exist', () => {
        expect(decideAnimalAccess({ exists: false, deleted: false, viewerCanSee: false })).toBe('missing');
    });
    it('is missing when the row is soft-deleted, even for the owner', () => {
        expect(decideAnimalAccess({ exists: true, deleted: true, viewerCanSee: true })).toBe('missing');
        expect(decideAnimalAccess({ exists: true, deleted: true, viewerCanSee: false })).toBe('missing');
    });
    it('is allowed for owner / org-mate / admin', () => {
        expect(decideAnimalAccess({ exists: true, deleted: false, viewerCanSee: true })).toBe('allowed');
    });
    it('is not_yours for anyone else', () => {
        expect(decideAnimalAccess({ exists: true, deleted: false, viewerCanSee: false })).toBe('not_yours');
    });
});

describe('illustrationForSpecies', () => {
    it.each([
        ['cat', 'cat'], ['dog', 'dog'], ['bird', 'bird'],
        ['Gato', 'cat'], [' DOG ', 'dog'], ['perra', 'dog'], ['ave', 'bird'], ['michi', 'cat'],
        ['other', 'tag'], ['conejo', 'tag'], ['', 'tag'], [null, 'tag'], [undefined, 'tag'],
    ])('%j → %s', (input, expected) => {
        expect(illustrationForSpecies(input as string | null | undefined)).toBe(expected);
    });
});

describe('tagLabel', () => {
    it('keeps short names', () => expect(tagLabel('Luna')).toBe('Luna'));
    it('trims whitespace', () => expect(tagLabel('  Luna ')).toBe('Luna'));
    it('truncates long names with an ellipsis within max', () => {
        const out = tagLabel('Bartolomeo Segundo');
        expect(out).toBe('Bartolome…');
        expect([...out].length).toBe(10);
    });
    it('is empty for null/blank names', () => {
        expect(tagLabel(null)).toBe('');
        expect(tagLabel('   ')).toBe('');
    });
});

describe('isPubliclyListed', () => {
    const available = { recordType: 'available', adopterId: null };
    it('requires available + no adopter + at least one photo', () => {
        expect(isPubliclyListed(available, 1)).toBe(true);
    });
    it('is false without photos', () => expect(isPubliclyListed(available, 0)).toBe(false));
    it('is false once adopted', () => expect(isPubliclyListed({ recordType: 'available', adopterId: 'a1' }, 3)).toBe(false));
    it('is false for other record types', () => expect(isPubliclyListed({ recordType: 'adoption', adopterId: null }, 3)).toBe(false));
    it('is false with no row', () => expect(isPubliclyListed(null, 3)).toBe(false));
});
