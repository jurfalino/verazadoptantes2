import { describe, it, expect } from 'vitest';
import { isNamelessAdopter, adopterDisplayName } from './adopterDisplay';

describe('isNamelessAdopter', () => {
    it('is true for empty / whitespace / null name', () => {
        expect(isNamelessAdopter({ name: '' })).toBe(true);
        expect(isNamelessAdopter({ name: '   ' })).toBe(true);
        expect(isNamelessAdopter({ name: null })).toBe(true);
        expect(isNamelessAdopter(null)).toBe(true);
    });
    it('is false when a real name is present', () => {
        expect(isNamelessAdopter({ name: 'Ana' })).toBe(false);
    });
});

describe('adopterDisplayName', () => {
    it('returns the trimmed name when present', () => {
        expect(adopterDisplayName({ name: '  Ana ' }, 'Sin nombre')).toBe('Ana');
    });
    it('returns the fallback when nameless', () => {
        expect(adopterDisplayName({ name: '' }, 'Sin nombre')).toBe('Sin nombre');
        expect(adopterDisplayName(null, 'Sin nombre')).toBe('Sin nombre');
    });
});
