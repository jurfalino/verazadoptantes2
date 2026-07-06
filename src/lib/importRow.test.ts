import { describe, it, expect } from 'vitest';
import { buildImportBody } from './importRow';
import type { MappedRow } from '@/domain/importFields';

function row(o: Partial<MappedRow>): MappedRow {
    return { name: 'María', phones: [], emails: [], socials: [], addresses: [], dnis: [], combinedContacts: [], ...o };
}

describe('buildImportBody', () => {
    it('builds a valid /api/adopters body with typed contact entries + normalized adoption', () => {
        const { body, errors, needsAiCleanup } = buildImportBody(row({
            phones: ['11 2345-6789'], emails: ['maria@x.com'], dnis: ['12345678'],
            animalName: 'Luna', species: 'Perro', recordType: 'Tránsito', rating: '4', date: '15/06/2024',
        }));
        expect(errors).toEqual([]);
        expect(needsAiCleanup).toBe(false);
        expect(body).not.toBeNull();
        expect(body!.source).toBe('imported');
        const entries = JSON.parse(body!.contactEntries) as Array<{ type: string; value: string }>;
        expect(entries.some(e => e.type === 'phone')).toBe(true);
        expect(entries.some(e => e.type === 'email')).toBe(true);
        expect(entries.some(e => e.type === 'id')).toBe(true);
        expect(entries.some(e => e.value.includes('maria@x.com'))).toBe(true);
        expect(body!.adoption).toMatchObject({ animalName: 'Luna', species: 'dog', recordType: 'foster', rating: 4, date: '2024-06-15' });
    });

    it('splits a combined-contact cell deterministically', () => {
        const { body, needsAiCleanup } = buildImportBody(row({
            combinedContacts: ['Tel 11 2345-6789 mail maria@x.com'],
        }));
        const entries = JSON.parse(body!.contactEntries) as Array<{ type: string }>;
        expect(entries.some(e => e.type === 'phone')).toBe(true);
        expect(entries.some(e => e.type === 'email')).toBe(true);
        expect(needsAiCleanup).toBe(false); // structured contacts found → no AI needed
    });

    it('flags a combined cell with no structured contact for AI cleanup', () => {
        const { needsAiCleanup } = buildImportBody(row({ combinedContacts: ['contactar por la tarde'] }));
        expect(needsAiCleanup).toBe(true);
    });

    it('merges AI-recovered extras and suppresses the cleanup flag', () => {
        const { body, needsAiCleanup } = buildImportBody(
            row({ combinedContacts: ['llamar'] }),
            { phones: ['1122223333'] },
        );
        expect(needsAiCleanup).toBe(false);
        expect(JSON.parse(body!.contactEntries).some((e: { type: string }) => e.type === 'phone')).toBe(true);
    });

    it('returns errors + null body for an invalid row (missing name)', () => {
        const { body, errors } = buildImportBody(row({ name: '' }));
        expect(body).toBeNull();
        expect(errors.length).toBeGreaterThan(0);
    });

    it('forwards the animal/record fields the API now accepts (no silent drop)', () => {
        const { body } = buildImportBody(row({
            sex: 'macho', neutered: 'sí', color: 'negro', microchip: 'ABC123', age: '2 años',
            details: 'muy buen hogar', onBehalfOf: 'Juana',
        }));
        expect(body!.adoption).toMatchObject({
            sex: 'macho', neutered: 1, color: 'negro', microchip: 'ABC123', age: '2 años',
            details: 'muy buen hogar', onBehalfOf: 'Juana',
        });
    });

    it("the body's adoption keys are exactly what POST /api/adopters accepts", () => {
        const { body } = buildImportBody(row({ animalName: 'Luna' }));
        // Must match createAdopterApiSchema.adoption (validation.ts) — guards the field contract.
        const allowed = new Set(['animalName', 'species', 'recordType', 'rating', 'date', 'sex', 'neutered', 'color', 'microchip', 'age', 'details', 'onBehalfOf']);
        expect(Object.keys(body!.adoption).every(k => allowed.has(k))).toBe(true);
        expect(new Set(Object.keys(body!))).toEqual(new Set(['name', 'contactEntries', 'source', 'adoption']));
    });
});
