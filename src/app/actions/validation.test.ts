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
});
