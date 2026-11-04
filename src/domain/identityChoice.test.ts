import { describe, it, expect } from 'vitest';
import { needsIdentityChoice } from './identityChoice';

describe('needsIdentityChoice («¿Es la misma persona?», D35)', () => {
    it('different names matched only on a contact: ask', () => {
        expect(needsIdentityChoice({ matchTypes: ['phone'], nameA: 'Ana Pérez', nameB: 'Lucía Pérez' })).toBe(true);
        expect(needsIdentityChoice({ matchTypes: ['email', 'address_word'], nameA: 'Ana Pérez', nameB: 'Lucía Pérez' })).toBe(true);
    });
    it('matched on the name: no question', () => {
        expect(needsIdentityChoice({ matchTypes: ['name_full'], nameA: 'Ana Pérez', nameB: 'Lucía Pérez' })).toBe(false);
        expect(needsIdentityChoice({ matchTypes: ['phone', 'name_word'], nameA: 'Ana Pérez', nameB: 'Lucía Pérez' })).toBe(false);
    });
    it('the same name (accents, case, spaces aside): no question', () => {
        expect(needsIdentityChoice({ matchTypes: ['phone'], nameA: 'Ana  Pérez', nameB: 'ana perez' })).toBe(false);
    });
    it('a side without a name: no question', () => {
        expect(needsIdentityChoice({ matchTypes: ['phone'], nameA: '', nameB: 'Lucía Pérez' })).toBe(false);
        expect(needsIdentityChoice({ matchTypes: ['phone'], nameA: '   ', nameB: 'Lucía Pérez' })).toBe(false);
    });
});
