import { describe, it, expect } from 'vitest';
import { extractTokens } from './tokenizer';

const base = { name: 'Juan Pérez', contactInfo: null, addressInfo: null, familyMembers: null, sourceUrl: null };

describe('extractTokens — household members (household redesign v5)', () => {
    it("tokenizes a household member's name as name tokens (abuse-detection: relative's name)", () => {
        const tokens = extractTokens(base, [], [], [], [
            { name: 'María Gómez', contactEntries: [] },
        ]);
        expect(tokens.some(t => t.type === 'name_word' && t.value === 'maria')).toBe(true);
        expect(tokens.some(t => t.type === 'name_word' && t.value === 'gomez')).toBe(true);
        expect(tokens.some(t => t.type === 'name_full' && t.value.includes('maria'))).toBe(true);
    });

    it("tokenizes a household member's phone (a shared household phone links records)", () => {
        const tokens = extractTokens(base, [], [], [], [
            { name: 'María', contactEntries: [{ type: 'phone', value: '11 2345-6789' }] },
        ]);
        expect(tokens.some(t => t.type === 'phone')).toBe(true);
        expect(tokens.some(t => t.type === 'phone_suffix')).toBe(true);
    });

    it("emits dual social tokens for a household member's social (with platform)", () => {
        const tokens = extractTokens(base, [], [], [], [
            { name: 'María', contactEntries: [{ type: 'social', value: 'instagram.com/maria.g', platform: 'instagram' }] },
        ]);
        expect(tokens.some(t => t.type === 'social_handle' && t.value === 'maria.g')).toBe(true);
        expect(tokens.some(t => t.type === 'social' && t.value === 'instagram|maria.g')).toBe(true);
    });

    it("tokenizes a household member's email + id", () => {
        const tokens = extractTokens(base, [], [], [], [
            { name: '', contactEntries: [{ type: 'email', value: 'maria@example.com' }, { type: 'id', value: 'DNI 30123456' }] },
        ]);
        expect(tokens.some(t => t.type === 'email' && t.value === 'maria@example.com')).toBe(true);
        expect(tokens.some(t => t.type === 'id_number')).toBe(true);
    });

    it('no household → unchanged (no crash on omitted param)', () => {
        expect(() => extractTokens(base)).not.toThrow();
    });
});
