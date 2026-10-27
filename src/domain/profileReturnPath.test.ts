import { describe, it, expect } from 'vitest';
import { profileReturnPath } from './profileReturnPath';

describe('profileReturnPath', () => {
    it('keeps the query (the email «Deshacer» survives the sign-in) and drops the folded route id', () => {
        expect(profileReturnPath('pedro', { id: 'pedro', undoRename: 'h-1' })).toBe('/adopter/pedro?undoRename=h-1');
        expect(profileReturnPath('pedro', { id: 'pedro' })).toBe('/adopter/pedro');
        expect(profileReturnPath('p', { q: ['a', 'b'], x: undefined })).toBe('/adopter/p?q=a&q=b');
    });
});
