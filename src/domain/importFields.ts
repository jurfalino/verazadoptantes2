/**
 * Spreadsheet import — target fields + column-map parsing (pure domain logic).
 *
 * A spreadsheet import maps each SOURCE column (the user's arbitrary header) to
 * one of our target fields, or to `combined_contact` (a messy cell holding
 * several contact types, cleaned per-row later) or `ignore`. The AI proposes the
 * mapping; the user validates/corrects it before any write. No DB/AI imports here.
 */

export type ImportFieldKind = 'adopter' | 'contact' | 'animal' | 'adoption' | 'meta';

export interface ImportField {
    key: string;
    /** Human hint used in the AI prompt + as the default UI label. */
    label: string;
    kind: ImportFieldKind;
    /** Guidance shown to the AI to disambiguate this field. */
    hint: string;
}

/** The destinations a spreadsheet column can map to. `name` is the only required one. */
export const TARGET_IMPORT_FIELDS: ImportField[] = [
    { key: 'name', label: 'Adopter name', kind: 'adopter', hint: "The person's full name. REQUIRED." },
    { key: 'phone', label: 'Phone', kind: 'contact', hint: 'A phone number.' },
    { key: 'email', label: 'Email', kind: 'contact', hint: 'An email address.' },
    { key: 'social', label: 'Social handle', kind: 'contact', hint: 'A social media handle/profile (Instagram, Facebook, etc.).' },
    { key: 'address', label: 'Address', kind: 'contact', hint: 'A physical/postal address.' },
    { key: 'dni', label: 'ID / DNI', kind: 'contact', hint: 'A national ID / document number (DNI, cédula, etc.).' },
    { key: 'animalName', label: 'Animal name', kind: 'animal', hint: 'The adopted/fostered animal’s name.' },
    { key: 'species', label: 'Species', kind: 'animal', hint: 'dog / cat / bird / other.' },
    { key: 'sex', label: 'Sex', kind: 'animal', hint: 'Animal sex (macho/hembra, male/female).' },
    { key: 'neutered', label: 'Neutered', kind: 'animal', hint: 'Whether the animal is neutered/spayed (yes/no).' },
    { key: 'color', label: 'Color', kind: 'animal', hint: 'Animal color/markings.' },
    { key: 'microchip', label: 'Microchip', kind: 'animal', hint: 'Microchip number.' },
    { key: 'age', label: 'Age', kind: 'animal', hint: 'Animal age (free text like "2 años").' },
    { key: 'rating', label: 'Rating', kind: 'adoption', hint: 'A 1–5 rating/score for the adopter/adoption.' },
    { key: 'date', label: 'Date', kind: 'adoption', hint: 'The adoption/record date.' },
    { key: 'recordType', label: 'Record type', kind: 'adoption', hint: 'adoption / adoption_request / foster / observation / follow_up / returned_pet.' },
    { key: 'details', label: 'Notes / details', kind: 'adoption', hint: 'Free-text notes or details.' },
    { key: 'onBehalfOf', label: 'On behalf of', kind: 'adoption', hint: 'Name of the person this record was recorded for.' },
];

/** Special non-field destinations. */
export const COMBINED_CONTACT = 'combined_contact';
export const IGNORE = 'ignore';

export type MapDestination = string; // a TARGET_IMPORT_FIELDS key, COMBINED_CONTACT, or IGNORE

export interface ColumnAssignment {
    column: string; // source header
    field: MapDestination;
    confidence: 'high' | 'medium' | 'low';
}

export interface ColumnMap {
    columns: ColumnAssignment[];
    notes?: string;
}

const VALID_DESTINATIONS = new Set<string>([
    ...TARGET_IMPORT_FIELDS.map(f => f.key),
    COMBINED_CONTACT,
    IGNORE,
]);

/**
 * Validate + normalize a raw AI column-map response against the actual headers.
 * Every header gets exactly one assignment: unknown/invalid destinations and
 * headers the AI omitted default to `ignore` (low confidence) — never silently
 * dropped. Extra assignments for headers not in the sheet are discarded.
 */
export function parseColumnMap(raw: unknown, headers: string[]): ColumnMap {
    const headerSet = new Set(headers);
    const byColumn = new Map<string, ColumnAssignment>();

    const rawColumns = (raw && typeof raw === 'object' && Array.isArray((raw as { columns?: unknown }).columns))
        ? (raw as { columns: unknown[] }).columns
        : [];

    for (const entry of rawColumns) {
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as Record<string, unknown>;
        const column = typeof e.column === 'string' ? e.column : null;
        if (!column || !headerSet.has(column) || byColumn.has(column)) continue;
        const field = typeof e.field === 'string' && VALID_DESTINATIONS.has(e.field) ? e.field : IGNORE;
        const confidence = e.confidence === 'high' || e.confidence === 'medium' || e.confidence === 'low'
            ? e.confidence : 'low';
        byColumn.set(column, { column, field, confidence: field === IGNORE && e.field !== IGNORE ? 'low' : confidence });
    }

    // Ensure every header is represented (omitted ones → ignore).
    for (const h of headers) {
        if (!byColumn.has(h)) byColumn.set(h, { column: h, field: IGNORE, confidence: 'low' });
    }

    const notes = raw && typeof raw === 'object' && typeof (raw as { notes?: unknown }).notes === 'string'
        ? (raw as { notes: string }).notes : undefined;

    // Preserve original header order.
    return { columns: headers.map(h => byColumn.get(h)!), notes };
}

/** True when the map assigns at least one column to the required `name` field. */
export function hasNameMapping(map: ColumnMap): boolean {
    return map.columns.some(c => c.field === 'name');
}

/** A spreadsheet row projected onto our schema via a ColumnMap. Contact-type
 *  fields are arrays (several columns may map to the same type); single-value
 *  fields take the first non-empty. `combinedContacts` holds raw messy cells to
 *  be split per-row later (P2). */
export interface MappedRow {
    name: string;
    phones: string[];
    emails: string[];
    socials: string[];
    addresses: string[];
    dnis: string[];
    combinedContacts: string[];
    isPublic?: boolean;
    animalName?: string;
    species?: string;
    sex?: string;
    neutered?: string;
    color?: string;
    microchip?: string;
    age?: string;
    rating?: string;
    date?: string;
    recordType?: string;
    details?: string;
    onBehalfOf?: string;
}

const MULTI_CONTACT: Record<string, keyof Pick<MappedRow, 'phones' | 'emails' | 'socials' | 'addresses' | 'dnis'>> = {
    phone: 'phones', email: 'emails', social: 'socials', address: 'addresses', dni: 'dnis',
};

/** An empty MappedRow (used to pad AI output back to the input row count). */
export function emptyMappedRow(): MappedRow {
    return { name: '', phones: [], emails: [], socials: [], addresses: [], dnis: [], combinedContacts: [] };
}

function strArray(v: unknown): string[] {
    if (Array.isArray(v)) return v.map(x => (x ?? '').toString().trim()).filter(Boolean);
    if (typeof v === 'string' && v.trim()) return [v.trim()];
    return [];
}
function strOrUndef(v: unknown): string | undefined {
    const s = (v ?? '').toString().trim();
    return s || undefined;
}

/**
 * Validate a raw AI "interpret rows" response into MappedRow[], aligned to
 * `count` input rows (missing → empty row so nothing silently disappears; extras
 * truncated). Never trusts raw model output — coerces types, drops junk. Rating/
 * date stay strings (validated downstream by buildImportBody). `combinedContacts`
 * is always empty here (the AI already split contacts). Pure.
 */
export function parseAiRows(raw: unknown, count: number): MappedRow[] {
    const arr = Array.isArray(raw) ? raw
        : (raw && typeof raw === 'object' && Array.isArray((raw as { records?: unknown }).records))
            ? (raw as { records: unknown[] }).records : [];
    const out: MappedRow[] = [];
    for (let i = 0; i < count; i++) {
        const e = arr[i];
        if (!e || typeof e !== 'object') { out.push(emptyMappedRow()); continue; }
        const r = e as Record<string, unknown>;
        out.push({
            name: strOrUndef(r.name) ?? '',
            phones: strArray(r.phones), emails: strArray(r.emails), socials: strArray(r.socials),
            addresses: strArray(r.addresses), dnis: strArray(r.dnis), combinedContacts: [],
            animalName: strOrUndef(r.animalName), species: strOrUndef(r.species),
            sex: strOrUndef(r.sex), neutered: strOrUndef(r.neutered), color: strOrUndef(r.color),
            microchip: strOrUndef(r.microchip), age: strOrUndef(r.age), rating: strOrUndef(r.rating),
            date: strOrUndef(r.date), recordType: strOrUndef(r.recordType), details: strOrUndef(r.details),
            onBehalfOf: strOrUndef(r.onBehalfOf),
        });
    }
    return out;
}

/**
 * Project a single spreadsheet row onto our schema using the column map.
 * Deterministic — no AI. `combined_contact` cells are collected raw for later
 * per-row cleanup; `ignore` columns are dropped. Pure.
 */
export function applyColumnMap(map: ColumnMap, headers: string[], row: string[]): MappedRow {
    const out: MappedRow = { name: '', phones: [], emails: [], socials: [], addresses: [], dnis: [], combinedContacts: [] };
    const indexOf = new Map(headers.map((h, i) => [h, i]));

    for (const assign of map.columns) {
        if (assign.field === IGNORE) continue;
        const idx = indexOf.get(assign.column);
        if (idx === undefined) continue;
        const value = (row[idx] ?? '').toString().trim();
        if (!value) continue;

        if (assign.field === COMBINED_CONTACT) { out.combinedContacts.push(value); continue; }
        const multi = MULTI_CONTACT[assign.field];
        if (multi) { out[multi].push(value); continue; }
        // Single-value field: first non-empty wins.
        if (assign.field === 'name') { if (!out.name) out.name = value; continue; }
        const key = assign.field as keyof MappedRow;
        if (out[key] === undefined) (out as unknown as Record<string, unknown>)[key] = value;
    }
    return out;
}
