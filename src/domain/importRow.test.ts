import { describe, it, expect } from 'vitest';
import { normalizeRating, normalizeImportDate, normalizeSpecies, normalizeRecordType, normalizeNeutered, validateMappedRow } from './importRow';
import type { MappedRow } from './importFields';

function row(o: Partial<MappedRow>): MappedRow {
    return { name: 'X', phones: [], emails: [], socials: [], addresses: [], dnis: [], combinedContacts: [], ...o };
}

describe('normalizeRating', () => {
    it('accepts 1–5, rejects out-of-range/garbage', () => {
        expect(normalizeRating('4')).toBe(4);
        expect(normalizeRating('5 estrellas')).toBe(5);
        expect(normalizeRating('0')).toBeNull();
        expect(normalizeRating('9')).toBeNull();
        expect(normalizeRating('abc')).toBeNull();
        expect(normalizeRating(undefined)).toBeNull();
    });
});

describe('normalizeImportDate', () => {
    it('parses ISO and day-first formats to YYYY-MM-DD', () => {
        expect(normalizeImportDate('2024-06-15')).toBe('2024-06-15');
        expect(normalizeImportDate('15/06/2024')).toBe('2024-06-15');
        expect(normalizeImportDate('15-6-24')).toBe('2024-06-15');
        expect(normalizeImportDate('5/3/2023')).toBe('2023-03-05');
    });
    it('rejects unparseable / out-of-range', () => {
        expect(normalizeImportDate('ayer')).toBeNull();
        expect(normalizeImportDate('45/13/2024')).toBeNull();
        expect(normalizeImportDate(undefined)).toBeNull();
    });
});

describe('normalizeSpecies / recordType / neutered', () => {
    it('maps common es/en values', () => {
        expect(normalizeSpecies('Perro')).toBe('dog');
        expect(normalizeSpecies('gata')).toBe('cat');
        expect(normalizeSpecies('conejo')).toBe('conejo'); // unknown passthrough
        expect(normalizeRecordType('Tránsito')).toBe('foster');
        expect(normalizeRecordType('adopción')).toBe('adoption');
        expect(normalizeRecordType(undefined)).toBe('adoption'); // default
        expect(normalizeRecordType('garbage')).toBe('adoption'); // default
        expect(normalizeNeutered('Sí')).toBe(1);
        expect(normalizeNeutered('no')).toBe(0);
        expect(normalizeNeutered('quizás')).toBeNull();
    });
});

describe('validateMappedRow', () => {
    it('flags missing name and contact', () => {
        expect(validateMappedRow(row({ name: '' }))).toContain('Falta el nombre y el contacto del adoptante.');
        expect(validateMappedRow(row({ name: 'Ana' }))).toEqual([]);
    });
    it('flags present-but-invalid rating and date (never silently drops)', () => {
        expect(validateMappedRow(row({ rating: '9' })).some(e => e.includes('Rating'))).toBe(true);
        expect(validateMappedRow(row({ date: 'ayer' })).some(e => e.includes('Fecha'))).toBe(true);
        expect(validateMappedRow(row({ rating: '4', date: '2024-06-15' }))).toEqual([]);
    });
});

describe('validateMappedRow — nameless', () => {
    const empty = { name: '', phones: [], emails: [], socials: [], addresses: [], dnis: [], combinedContacts: [] };
    it('accepts empty name when a phone is present', () => {
        expect(validateMappedRow({ ...empty, phones: ['4796-3445'] } as MappedRow)).toEqual([]);
    });
    it('rejects when name AND all contact are empty', () => {
        expect(validateMappedRow({ ...empty } as MappedRow)).toContain('Falta el nombre y el contacto del adoptante.');
    });
});
