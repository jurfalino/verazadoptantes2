import { describe, it, expect } from 'vitest';
import { isValidFormEmail } from './formEmail';

describe('isValidFormEmail (mirrors the public form client check)', () => {
    it('accepts ordinary addresses, trimmed', () => {
        expect(isValidFormEmail('carla.gomez@ejemplo.com.ar')).toBe(true);
        expect(isValidFormEmail('  e2e-form-1@example.com ')).toBe(true);
        expect(isValidFormEmail('a+tag@sub.domain.io')).toBe(true);
    });

    it('rejects what the client form rejects', () => {
        expect(isValidFormEmail('x')).toBe(false);
        expect(isValidFormEmail('x@y')).toBe(false);
        expect(isValidFormEmail('carla @ejemplo.com')).toBe(false);
        expect(isValidFormEmail('@ejemplo.com')).toBe(false);
        expect(isValidFormEmail('')).toBe(false);
        expect(isValidFormEmail(null)).toBe(false);
    });
});
