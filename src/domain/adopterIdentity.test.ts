import { describe, it, expect } from 'vitest';
import { hasAnyContact, hasMinimumIdentifier } from './adopterIdentity';

const entries = (arr: unknown) => JSON.stringify(arr);

describe('hasAnyContact', () => {
    it('true when a phone/email/social/id entry exists', () => {
        expect(hasAnyContact(entries([{ type: 'phone', value: '4796-3445' }]))).toBe(true);
        expect(hasAnyContact(entries([{ type: 'email', value: 'a@b.com' }]))).toBe(true);
        expect(hasAnyContact(entries([{ type: 'id', value: '12345678' }]))).toBe(true);
    });
    it('false for empty/only-alias/only-other/null, and true for a contactInfo blob', () => {
        expect(hasAnyContact(entries([]))).toBe(false);
        expect(hasAnyContact(entries([{ type: 'alias', value: 'Lucho' }]))).toBe(false);
        expect(hasAnyContact(null)).toBe(false);
        expect(hasAnyContact('not json')).toBe(false);
        expect(hasAnyContact(null, 'Tel: 4796-3445')).toBe(true);
        expect(hasAnyContact(null, '   ')).toBe(false);
    });
});

describe('hasMinimumIdentifier', () => {
    it('true with a name and no contact', () => {
        expect(hasMinimumIdentifier({ name: 'Ana' })).toBe(true);
    });
    it('true with no name but a contact', () => {
        expect(hasMinimumIdentifier({ name: '', contactEntries: entries([{ type: 'email', value: 'a@b.com' }]) })).toBe(true);
    });
    it('false with neither name nor contact', () => {
        expect(hasMinimumIdentifier({ name: '  ', contactEntries: entries([]), contactInfo: '' })).toBe(false);
    });
});
