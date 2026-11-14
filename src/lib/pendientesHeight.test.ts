import { describe, it, expect } from 'vitest';
import { APPLY_RESERVED_HEIGHT_SCRIPT, reservedHeight } from './pendientesHeight';

describe('«Pendientes de revisar» holds last visit\'s height while it loads (UX review S5)', () => {
    it('a stored height is reserved; nothing stored, garbage or absurd → the default placeholder (null)', () => {
        expect(reservedHeight('312')).toBe(312);
        expect(reservedHeight('0')).toBe(0);
        expect(reservedHeight(null)).toBeNull();
        expect(reservedHeight('abc')).toBeNull();
        expect(reservedHeight('-5')).toBeNull();
        expect(reservedHeight('99999')).toBe(1600);
    });

    // The inline script that applies it before the first paint (route skeleton + server HTML): same rules as above.
    const run = (stored: string | null, blocked = false) => {
        const el = { style: {} as Record<string, string> };
        const document = { currentScript: { previousElementSibling: el } };
        const localStorage = { getItem: (k: string) => { if (blocked) throw new Error('blocked'); return k === 'pendientes:height:v1' ? stored : null; } };
        new Function('document', 'localStorage', APPLY_RESERVED_HEIGHT_SCRIPT)(document, localStorage);
        return el.style;
    };
    it('the inline script applies the stored height, hides on 0, leaves the default otherwise, never throws', () => {
        expect(run('312')).toEqual({ height: '312px' });
        expect(run('99999')).toEqual({ height: '1600px' });
        expect(run('0')).toEqual({ display: 'none' });
        expect(run(null)).toEqual({});
        expect(run('abc')).toEqual({});
        expect(run('312', true)).toEqual({});
    });
});
