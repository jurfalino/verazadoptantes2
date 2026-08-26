import { describe, it, expect } from 'vitest';
import { normalizeRating, normalizeImportDate, inferDateOrder, normalizeSpecies, normalizeRecordType, normalizeNeutered, validateMappedRow, rowWarnings } from './importRow';
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
    it('extracts the FIRST valid date from a range or prose', () => {
        expect(normalizeImportDate('14/03/2009 - 20/06/2009')).toBe('2009-03-14');
        expect(normalizeImportDate('4/07/2009 - diciembre 2009')).toBe('2009-07-04');
        expect(normalizeImportDate('adoptado el 2/05/2009, devuelto el 4/05/2009')).toBe('2009-05-02');
    });
    it('accepts month + year → the 1st of that month (numeric and named, es/en/pt)', () => {
        expect(normalizeImportDate('06/2009')).toBe('2009-06-01');
        expect(normalizeImportDate('6-2009')).toBe('2009-06-01');
        expect(normalizeImportDate('2009-06')).toBe('2009-06-01');
        expect(normalizeImportDate('2009/6')).toBe('2009-06-01');
        expect(normalizeImportDate('diciembre 2009')).toBe('2009-12-01');
        expect(normalizeImportDate('dic de 2009')).toBe('2009-12-01');
        expect(normalizeImportDate('December 2009')).toBe('2009-12-01');
        expect(normalizeImportDate('março 2009')).toBe('2009-03-01'); // accented pt
        expect(normalizeImportDate('junio de 2015')).toBe('2015-06-01');
        expect(normalizeImportDate('13/2009')).toBeNull(); // invalid month
        expect(normalizeImportDate('12/09')).toBeNull(); // ambiguous, no 4-digit year
        expect(normalizeImportDate('14/03/2009')).toBe('2009-03-14'); // full date still wins
    });
    it('accepts a whole-cell year → Jan 1 of that year (imprecise legacy data)', () => {
        expect(normalizeImportDate('2015')).toBe('2015-01-01');
        expect(normalizeImportDate('  2009  ')).toBe('2009-01-01');
        expect(normalizeImportDate('1998')).toBe('1998-01-01');
        expect(normalizeImportDate('1800')).toBeNull(); // out of 1900–2100 range
        expect(normalizeImportDate('12345')).toBeNull(); // not a 4-digit year
        expect(normalizeImportDate('14/03/2009')).toBe('2009-03-14'); // full date still wins, not year-only
    });
    it('returns null for a range with no complete date (bare years, relative, month-day)', () => {
        expect(normalizeImportDate('2014-2015')).toBeNull();
        expect(normalizeImportDate('2015 y 2016')).toBeNull();
        expect(normalizeImportDate('hace un mes')).toBeNull();
        expect(normalizeImportDate('Feb 23rd')).toBeNull();
        expect(normalizeImportDate('adoptado 30/3, devuelto 09/06')).toBeNull(); // no year on either
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
    it('does NOT block on an unparseable rating or date (those are warnings)', () => {
        expect(validateMappedRow(row({ rating: '9' }))).toEqual([]);
        expect(validateMappedRow(row({ date: 'ayer' }))).toEqual([]);
        expect(validateMappedRow(row({ rating: '4', date: '2024-06-15' }))).toEqual([]);
    });
});

describe('rowWarnings', () => {
    it('warns (non-blocking) on a present-but-unparseable rating or date', () => {
        expect(rowWarnings(row({ rating: '9' })).some(w => w.includes('Rating'))).toBe(true);
        expect(rowWarnings(row({ date: '2014-2015' })).some(w => w.includes('Fecha'))).toBe(true);
    });
    it('is silent when rating/date are valid, absent, or a salvageable range', () => {
        expect(rowWarnings(row({ rating: '4', date: '2024-06-15' }))).toEqual([]);
        expect(rowWarnings(row({}))).toEqual([]);
        // A range whose first date parses is NOT a warning — it's salvaged.
        expect(rowWarnings(row({ date: '14/03/2009 - 20/06/2009' }))).toEqual([]);
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


describe('normalizeImportDate — US MM/DD/YYYY (audit E16)', () => {
    it('recovers a US month-first date that day-first used to DROP', () => {
        // 03/14/2009: 14 cannot be a month → must be day → month-first. Was null.
        expect(normalizeImportDate('03/14/2009')).toBe('2009-03-14');
        expect(normalizeImportDate('12/25/2020')).toBe('2020-12-25');
    });
    it('keeps day-first for the ambiguous ≤12/≤12 case by default (es locale)', () => {
        expect(normalizeImportDate('12/05/2009')).toBe('2009-05-12'); // day-first default
    });
    it('honors an explicit month-first order for the ambiguous case', () => {
        expect(normalizeImportDate('12/05/2009', 'mdy')).toBe('2009-12-05');
        expect(normalizeImportDate('01/02/2009', 'mdy')).toBe('2009-01-02');
        expect(normalizeImportDate('01/02/2009', 'dmy')).toBe('2009-02-01');
    });
    it('unambiguous day-first (day>12) ignores an mdy hint', () => {
        expect(normalizeImportDate('25/12/2020', 'mdy')).toBe('2020-12-25');
    });
    it('still returns null for a genuinely impossible date', () => {
        expect(normalizeImportDate('45/13/2024', 'mdy')).toBeNull();
    });
});

describe('inferDateOrder (audit E16)', () => {
    it('infers month-first when a cell has day>12 in the second position', () => {
        expect(inferDateOrder(['03/14/2009', '12/05/2009', '01/02/2010'])).toBe('mdy');
    });
    it('infers day-first when a cell has day>12 in the first position', () => {
        expect(inferDateOrder(['14/03/2009', '12/05/2009'])).toBe('dmy');
    });
    it('returns ambiguous when no cell proves a layout', () => {
        expect(inferDateOrder(['12/05/2009', '01/02/2010', undefined, 'ayer'])).toBe('ambiguous');
    });
    it('takes the majority under conflicting evidence', () => {
        expect(inferDateOrder(['14/03/2009', '15/03/2009', '03/14/2009'])).toBe('dmy'); // 2 dmy vs 1 mdy
    });
});
