import { describe, it, expect } from 'vitest';
import { detectNotePii, noteHasPii, noteHash } from './notePii';

describe('detectNotePii', () => {
    it('flags a phone (7+ digits or NNNN-NNN)', () => {
        expect(detectNotePii('llamar al 1145678901').hasPhone).toBe(true);
        expect(detectNotePii('tel 4567-123').hasPhone).toBe(true);
        expect(detectNotePii('tiene 22 años y 3 gatos').hasPhone).toBe(false);
    });
    it('flags a social/link', () => {
        expect(detectNotePii('su facebook es Juan Perez').hasSocial).toBe(true);
        expect(detectNotePii('IG @juan en Instagram').hasSocial).toBe(true);
        expect(detectNotePii('https://fb.com/juan').hasSocial).toBe(true);
        expect(detectNotePii('una charla amena').hasSocial).toBe(false);
    });
    it('flags an address keyword (incl. the "calle " false positive)', () => {
        expect(detectNotePii('vive en calle Corrientes 1234').hasAddress).toBe(true);
        expect(detectNotePii('barrio Norte').hasAddress).toBe(true);
        // The real-world false positive: "de la calle" (off the street) still matches.
        expect(detectNotePii('tuvo un gatito de la calle pero se le murio').hasAddress).toBe(true);
    });
    it('noteHasPii is the OR of the flags; clean prose is false', () => {
        expect(noteHasPii('el hijo esta encaprichado con una gata negra')).toBe(false);
        expect(noteHasPii('quiere una gata ya castrada')).toBe(false);
        expect(noteHasPii('')).toBe(false);
        expect(noteHasPii(null)).toBe(false);
    });
});

describe('noteHash (dismissal is content-bound)', () => {
    it('is deterministic and stable for the same text', () => {
        expect(noteHash('un gatito de la calle')).toBe(noteHash('un gatito de la calle'));
        expect(noteHash(null)).toBe(noteHash(''));
    });
    it('changes when the note changes (so an edited note re-surfaces)', () => {
        const before = noteHash('un gatito de la calle');
        const after = noteHash('un gatito de la calle. tel 1145678901');
        expect(after).not.toBe(before);
    });
});
