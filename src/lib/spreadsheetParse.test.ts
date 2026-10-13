import { describe, it, expect } from 'vitest';
import { xlsxCellToString, firstSheetRows } from './spreadsheetParse';

describe('firstSheetRows (read-excel-file result → rows)', () => {
    it('takes the first sheet from the v9 shape [{ sheet, data }]', () => {
        const v9 = [{ sheet: 'Solicitudes', data: [['Nombre', 'Email'], ['Ana', 'a@x.com']] }, { sheet: 'Notas', data: [['nota']] }];
        expect(firstSheetRows(v9)).toEqual([['Nombre', 'Email'], ['Ana', 'a@x.com']]);
    });
    it('skips empty sheets to the first one with rows', () => {
        expect(firstSheetRows([{ sheet: 'Vacía', data: [] }, { sheet: 'Datos', data: [['A'], ['1']] }])).toEqual([['A'], ['1']]);
    });
    it('still accepts the older rows-of-cells shape', () => {
        expect(firstSheetRows([['A', 'B'], ['1', '2']])).toEqual([['A', 'B'], ['1', '2']]);
    });
    it('anything else is an empty sheet, never a throw', () => {
        expect(firstSheetRows([])).toEqual([]);
        expect(firstSheetRows(undefined)).toEqual([]);
        expect(firstSheetRows([{ sheet: 'x' }])).toEqual([]);
    });
});

describe('xlsxCellToString', () => {
    it('formats a Date cell as YYYY-MM-DD (day preserved, no timezone drift)', () => {
        // read-excel-file builds UTC-midnight Dates for date cells.
        expect(xlsxCellToString(new Date(Date.UTC(2024, 5, 15)))).toBe('2024-06-15');
        expect(xlsxCellToString(new Date(Date.UTC(2009, 2, 1)))).toBe('2009-03-01');
    });
    it('passes strings through unchanged', () => {
        expect(xlsxCellToString('Juan Pérez')).toBe('Juan Pérez');
        expect(xlsxCellToString('11-4796-3445')).toBe('11-4796-3445');
    });
    it('renders non-date numbers as their string form (not a date)', () => {
        expect(xlsxCellToString(5)).toBe('5');
        expect(xlsxCellToString(11479634)).toBe('11479634');
    });
    it('handles null/undefined as empty', () => {
        expect(xlsxCellToString(null)).toBe('');
        expect(xlsxCellToString(undefined)).toBe('');
    });
});
