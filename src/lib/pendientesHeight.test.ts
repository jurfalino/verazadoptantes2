import { describe, it, expect } from 'vitest';
import { reservedHeight } from './pendientesHeight';

describe('«Pendientes de revisar» holds last visit\'s height while it loads (UX review S5)', () => {
    it('a stored height is reserved; nothing stored, garbage or absurd → the default placeholder (null)', () => {
        expect(reservedHeight('312')).toBe(312);
        expect(reservedHeight('0')).toBe(0);
        expect(reservedHeight(null)).toBeNull();
        expect(reservedHeight('abc')).toBeNull();
        expect(reservedHeight('-5')).toBeNull();
        expect(reservedHeight('99999')).toBe(1600);
    });
});
