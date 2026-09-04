import { describe, it, expect } from 'vitest';
import { detectEntryType } from './contactEntries';

/**
 * Backs the contact rows that type themselves as you write. The risk this
 * guards is not a missed detection — it is an unwanted one: a row that
 * reclassifies itself while someone is halfway through typing a name.
 */
describe('detectEntryType', () => {
    it('recognises a phone number as typed, formatting and all', () => {
        expect(detectEntryType('11 3318-6767')).toBe('phone');
        expect(detectEntryType('+54 9 11 3318 6767')).toBe('phone');
    });

    it('recognises an email', () => {
        expect(detectEntryType('ana.martinez@gmail.com')).toBe('email');
    });

    it('recognises a social profile', () => {
        expect(detectEntryType('instagram.com/ana.martinez.ok')).toBe('social');
    });

    it('recognises a document number', () => {
        expect(detectEntryType('DNI 30.123.456')).toBe('id');
    });

    // The important half. Anything the classifier only reaches by falling back
    // to address/other must leave the row's existing type alone.
    it('declines a name being typed', () => {
        for (const partial of ['A', 'An', 'Ana', 'Ana M', 'Ana Martínez']) {
            expect(detectEntryType(partial), partial).toBeNull();
        }
    });

    it('declines prose and street addresses', () => {
        expect(detectEntryType('Av. Rivadavia 4820')).toBeNull();
        expect(detectEntryType('vive con la madre')).toBeNull();
    });

    it('declines empty and whitespace', () => {
        expect(detectEntryType('')).toBeNull();
        expect(detectEntryType('   ')).toBeNull();
        expect(detectEntryType(null)).toBeNull();
        expect(detectEntryType(undefined)).toBeNull();
    });

    // Two identifiers in one field is a paste, not a single row's type;
    // picking one of them would be arbitrary.
    it('declines multi-token input', () => {
        expect(detectEntryType('11 3318-6767 ana@mail.com')).toBeNull();
    });
});
