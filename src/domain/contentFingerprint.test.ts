import { describe, it, expect } from 'vitest';
import { computeContentFingerprint } from './contentFingerprint';

describe('computeContentFingerprint', () => {
    it('is identical across formatting, case, accents, and order', () => {
        // Same person, different phone formatting + case + accents:
        expect(computeContentFingerprint({ name: 'jose perez ', emails: ['a@b.com'], phones: ['0114796-3445'] }))
            .toBe(computeContentFingerprint({ name: 'José  Pérez', phones: ['011 4796 3445'], emails: ['A@B.COM'] }));
        // order-independent contacts:
        expect(computeContentFingerprint({ phones: ['111', '222'] })).toBe(computeContentFingerprint({ phones: ['222', '111'] }));
    });
    it('same person + only an address (no name/phone) still matches', () => {
        expect(computeContentFingerprint({ addresses: ['Independencia 2942, Dto 4'] }))
            .toBe(computeContentFingerprint({ addresses: ['independencia 2942, dto 4'] }));
    });
    it('two name-only records with the same name both return empty (no contact → no auto-match, not even to each other)', () => {
        expect(computeContentFingerprint({ name: 'Ana Gómez' })).toBe('');
        expect(computeContentFingerprint({ name: 'ana gomez' })).toBe('');
    });
    it('differs when content differs (different DNI)', () => {
        expect(computeContentFingerprint({ name: 'Ana', ids: ['111'] }))
            .not.toBe(computeContentFingerprint({ name: 'Ana', ids: ['222'] }));
    });
    it('empty fingerprint for content-less input (never a match)', () => {
        expect(computeContentFingerprint({})).toBe('');
        expect(computeContentFingerprint({ name: '  ', phones: [''] })).toBe('');
    });
    it('returns empty for a name-only record (no contact) — homonyms must not auto-merge', () => {
        expect(computeContentFingerprint({ name: 'Juan Pérez' })).toBe('');
        expect(computeContentFingerprint({ name: 'Juan Perez', phones: [], emails: [] })).toBe('');
    });
    it('still fingerprints a record that has a name AND at least one contact', () => {
        expect(computeContentFingerprint({ name: 'Juan', phones: ['11-4796-3445'] })).not.toBe('');
        expect(computeContentFingerprint({ emails: ['a@b.com'] })).not.toBe('');
    });
});
