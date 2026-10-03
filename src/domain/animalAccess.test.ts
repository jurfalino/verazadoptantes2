import { describe, it, expect } from 'vitest';
import { decideAnimalAccess, illustrationForSpecies, tagLabel, isPubliclyListed, showableCount } from './animalAccess';

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

describe('isPubliclyListed — foster and the rescuer\'s switch (v2.56.128)', () => {
    const foster = { recordType: 'foster', adopterId: 'a1' };

    it('lists an animal in a foster home — it is still looking for a permanent one', () => {
        // Its record type is 'foster' and it DOES carry an adopter (the foster
        // home), which is exactly why the old rule dropped it.
        expect(isPubliclyListed(foster, 1)).toBe(true);
    });

    it('still needs something to show', () => {
        expect(isPubliclyListed(foster, 0)).toBe(false);
    });

    it('honours the rescuer taking it out, foster or available', () => {
        expect(isPubliclyListed({ ...foster, listed: 0 }, 3)).toBe(false);
        expect(isPubliclyListed({ recordType: 'available', adopterId: null, listed: 0 }, 3)).toBe(false);
    });

    it('treats an unset switch as listed — nothing changes for animals that predate it', () => {
        expect(isPubliclyListed({ recordType: 'available', adopterId: null }, 1)).toBe(true);
        expect(isPubliclyListed({ recordType: 'available', adopterId: null, listed: null }, 1)).toBe(true);
        expect(isPubliclyListed({ recordType: 'available', adopterId: null, listed: 1 }, 1)).toBe(true);
    });

    it('never lists an animal that already has a home', () => {
        expect(isPubliclyListed({ recordType: 'adoption', adopterId: 'a1', listed: 1 }, 3)).toBe(false);
    });
});

describe('showableCount', () => {
    // The catalog is a grid of stills. An animal whose only media is a video
    // with no poster would be published as a blank tile — worse than being
    // left out, because the rescuer believes people can see the animal.
    it('counts photos', () => {
        expect(showableCount([{ mediaType: 'image' }, { mediaType: 'image' }])).toBe(2);
    });

    it('counts a video only when it has a poster', () => {
        expect(showableCount([{ mediaType: 'video', thumbnailUrl: 'p.jpg' }])).toBe(1);
        expect(showableCount([{ mediaType: 'video', thumbnailUrl: null }])).toBe(0);
    });

    it('treats a missing mediaType as a photo — rows predating the column', () => {
        expect(showableCount([{}, { mediaType: null }])).toBe(2);
    });

    it('is what keeps a video-only animal out of the catalog', () => {
        const videoOnly = [{ mediaType: 'video', thumbnailUrl: null }];
        expect(isPubliclyListed({ recordType: 'available', adopterId: null }, showableCount(videoOnly))).toBe(false);
    });
});
