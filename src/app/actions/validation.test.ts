import { describe, it, expect } from 'vitest';
import { createAdopterApiSchema, saveAdopterSchema } from './validation';

const base = { contactEntries: JSON.stringify([{ type: 'email', value: 'a@b.com' }]) };

describe('createAdopterApiSchema — nameless', () => {
    it('accepts an empty name when a contact is present', () => {
        expect(createAdopterApiSchema.safeParse({ name: '', ...base }).success).toBe(true);
    });
    it('rejects when name AND contact are both empty', () => {
        const r = createAdopterApiSchema.safeParse({ name: '', contactEntries: JSON.stringify([]) });
        expect(r.success).toBe(false);
    });
    it('still accepts a normal named record', () => {
        expect(createAdopterApiSchema.safeParse({ name: 'Ana' }).success).toBe(true);
    });
    it('accepts an empty name when object-form contactInfo has a contact', () => {
        expect(createAdopterApiSchema.safeParse({ name: '', contactInfo: { emails: ['x@y.com'] } }).success).toBe(true);
    });
    it('a null name (the AI found none) is an empty name, not a rejected save (errorId 803973b9)', () => {
        const r = createAdopterApiSchema.safeParse({ name: null, ...base });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.name).toBe('');
    });
    it('a null name with no contact is still rejected', () => {
        expect(createAdopterApiSchema.safeParse({ name: null, contactEntries: JSON.stringify([]) }).success).toBe(false);
    });
});

describe('saveAdopterSchema — nameless', () => {
    it('accepts an empty name when a contact is present', () => {
        expect(saveAdopterSchema.safeParse({ name: '', ...base }).success).toBe(true);
    });
    it('rejects when name AND contact are both empty', () => {
        const r = saveAdopterSchema.safeParse({ name: '', contactEntries: JSON.stringify([]) });
        expect(r.success).toBe(false);
    });
    it('still accepts a normal named record', () => {
        expect(saveAdopterSchema.safeParse({ name: 'Ana' }).success).toBe(true);
    });
    it('accepts an optional isPublic flag for anonymous records', () => {
        expect(saveAdopterSchema.safeParse({ name: '', ...base, isPublic: true }).success).toBe(true);
    });
});
