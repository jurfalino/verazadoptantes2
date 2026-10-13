import { describe, it, expect } from 'vitest';
import { contractCopyFileName } from './contractCopy';

describe('contractCopyFileName', () => {
    const day = new Date('2026-10-13T12:00:00Z');
    it('names the file after the animal and the day', () => {
        expect(contractCopyFileName('Luna', day)).toBe('contrato-luna-2026-10-13.pdf');
        expect(contractCopyFileName('Ñandú Pérez!', day)).toBe('contrato-nandu-perez-2026-10-13.pdf');
    });
    it('still works without a name', () => {
        expect(contractCopyFileName('', day)).toBe('contrato-2026-10-13.pdf');
        expect(contractCopyFileName(null, day)).toBe('contrato-2026-10-13.pdf');
    });
});
