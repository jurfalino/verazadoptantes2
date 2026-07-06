/**
 * Client-side spreadsheet parsing. Runs in the browser so the raw file (PII)
 * never leaves the user's machine until they explicitly confirm an import.
 *
 * v1: CSV via papaparse. Excel (.xlsx) is a fast-follow — the npm `xlsx`
 * (SheetJS) package is frozen at an old version with advisories, so adding it
 * is a deliberate dependency decision (prefer the SheetJS CDN build or a
 * maintained alternative).
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

/** Route a file to the right parser by extension. CSV today; throws for others. */
export function parseSpreadsheetFile(file: File): Promise<ParsedSheet> {
    const name = file.name.toLowerCase();
    if (name.endsWith('.csv') || file.type === 'text/csv') return parseCsvFile(file);
    return Promise.reject(new Error('Only CSV files are supported for now (.xlsx coming soon).'));
}
