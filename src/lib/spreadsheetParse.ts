/**
 * Client-side spreadsheet parsing. Runs in the browser so the raw file (PII)
 * never leaves the user's machine until they explicitly confirm an import.
 * CSV via papaparse; Excel (.xlsx) via read-excel-file (maintained, no SheetJS
 * advisories). AI then interprets the parsed rows into records.
 */

import Papa from 'papaparse';

export interface ParsedSheet {
    /** Header row, trimmed; blank/duplicate headers get a "Column N" fallback. */
    headers: string[];
    /** Data rows, each aligned to `headers` length (missing cells → ''). */
    rows: string[][];
    rowCount: number;
}

function normalizeHeaders(rawHeaders: unknown[]): string[] {
    const seen = new Map<string, number>();
    return rawHeaders.map((h, i) => {
        let name = (h ?? '').toString().trim() || `Column ${i + 1}`;
        // Disambiguate duplicate headers (the AI + mapping UI key on header text).
        const n = seen.get(name) ?? 0;
        seen.set(name, n + 1);
        if (n > 0) name = `${name} (${n + 1})`;
        return name;
    });
}

/** Parse a CSV File into headers + aligned rows. Resolves empty on a blank file. */
export function parseCsvFile(file: File): Promise<ParsedSheet> {
    return new Promise((resolve, reject) => {
        Papa.parse<string[]>(file, {
            skipEmptyLines: 'greedy',
            complete: (results) => {
                const data = (results.data as unknown[][]) || [];
                if (data.length === 0) {
                    resolve({ headers: [], rows: [], rowCount: 0 });
                    return;
                }
                const headers = normalizeHeaders(data[0] as unknown[]);
                const rows = data.slice(1).map(r =>
                    headers.map((_, i) => ((r as unknown[])[i] ?? '').toString()),
                );
                resolve({ headers, rows, rowCount: rows.length });
            },
            error: (err: Error) => reject(err),
        });
    });
}

/** Convert one xlsx cell (which read-excel-file may hand back as a Date, number, or
 *  string) into the string the import pipeline expects. Date cells become ISO
 *  `YYYY-MM-DD` (using UTC parts — the library builds UTC-midnight Dates, so UTC parts
 *  avoid the local-timezone day-shift), so the day of month survives instead of being
 *  coarsened to the 1st by the prose date parser. Plain numbers are NOT treated as date
 *  serials here (ambiguous with phone/DNI columns); only real Date objects convert.
 *  Bare numeric serials (e.g. "45458") are handled at the review step, not here. */
export function xlsxCellToString(cell: unknown): string {
    if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
        const y = cell.getUTCFullYear().toString().padStart(4, '0');
        const m = (cell.getUTCMonth() + 1).toString().padStart(2, '0');
        const d = cell.getUTCDate().toString().padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    return (cell ?? '').toString();
}

/** Parse an .xlsx File (first sheet) into headers + aligned rows. */
export async function parseXlsxFile(file: File): Promise<ParsedSheet> {
    const { default: readXlsxFile } = await import('read-excel-file/browser');
    const data = (await readXlsxFile(file)) as unknown as unknown[][]; // rows of cells
    if (!data.length) return { headers: [], rows: [], rowCount: 0 };
    const headers = normalizeHeaders(data[0]);
    const rows = data.slice(1).map((r) => headers.map((_, i) => xlsxCellToString(r[i])));
    return { headers, rows, rowCount: rows.length };
}

/** Route a file to the right parser by extension/type. Supports CSV and .xlsx. */
export function parseSpreadsheetFile(file: File): Promise<ParsedSheet> {
    const name = file.name.toLowerCase();
    if (name.endsWith('.xlsx') || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return parseXlsxFile(file);
    if (name.endsWith('.csv') || file.type === 'text/csv' || name.endsWith('.txt')) return parseCsvFile(file);
    // Default to CSV parsing (handles most delimited text exports).
    return parseCsvFile(file);
}
