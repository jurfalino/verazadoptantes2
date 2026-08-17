import { describe, it, expect } from 'vitest';
import { xlsxCellToString } from './spreadsheetParse';

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
