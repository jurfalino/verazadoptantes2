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
    { key: 'age', label: 'Animal age', kind: 'animal', hint: 'The ANIMAL\'s age (free text like "2 años") — never the adopter\'s age.' },
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

/** Accent- and case-insensitive header normalization for heuristic matching. */
function normHeader(h: string): string {
    return h.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/** Ordered header-name heuristics (most specific first). First match wins. */
const GUESS_RULES: { field: string; test: RegExp }[] = [
    { field: 'phone', test: /(^|[^a-z])(tel|phone|celular|cel|whatsapp|wsp|movil)/ },
    { field: 'email', test: /(e-?mail|correo)/ },
    { field: 'social', test: /(facebook|instagram|\bfb\b|\big\b|social|perfil)/ },
    { field: 'dni', test: /(dni|documento|cedula|pasaporte)/ },
    { field: 'address', test: /(direcc|domicilio|address|localidad|barrio|ciudad|provincia|partido|municipio|comuna)/ },
    // "a nombre de" as words: after accent stripping, "mencioná nombre" contains "a nombre".
    { field: 'onBehalfOf', test: /(aportante|\ba nombre de\b|reportad|on behalf)/ },
    { field: 'rating', test: /(rating|puntaje|score|calificaci)/ },
    { field: 'date', test: /(fecha|date)/ },
    // The animal's type is its species ("animal_tipo", "tipo de animal"), not a record type.
    { field: 'species', test: /(especie|species|(animal|mascota)[\s_]*(tipo|type)|(tipo|type)[\s_]*(de[\s_]*)?(animal|mascota))/ },
    { field: 'recordType', test: /(tipo|type|record)/ },
    { field: 'animalName', test: /(animal|mascota)/ },
    { field: 'details', test: /(motivo|detalle|nota|observaci|coment|descripci|details)/ },
    { field: 'name', test: /(nombre|name|adoptante)/ },
];

/** A form QUESTION, not a field label ("12. ¿Qué harías con el gato…?"): numbered,
 *  asks something, or too long to be a label. Keywords inside a question say
 *  nothing about the column ("tipo de vivienda" is not a record type). */
function isQuestionHeader(norm: string): boolean {
    return /^\d+(\.\d+)*\s*[.)-]/.test(norm) || /[¿?]/.test(norm) || norm.split(/\s+/).length > 8;
}

/** An identifier or status code column ("animal_id", "animal_estado", "entry_id"). */
function isCodeHeader(norm: string): boolean {
    return /(^|[\s_-])(id|estado|status|codigo)($|[\s_-])/.test(norm);
}

/** Fields that take ONE value per row (first non-empty wins in applyColumnMap). */
function isSingleValueField(field: string): boolean {
    return field !== IGNORE && field !== COMBINED_CONTACT && !(field in MULTI_CONTACT);
}

/**
 * Deterministic, OFFLINE column-map guess from header names (no AI). Used as the
 * instant default when a sheet is opened, so a well-structured sheet is ready to
 * import immediately without waiting for AI. The user can correct any field in
 * the UI, or opt into AI interpretation for genuinely messy sheets. Unmatched
 * headers → `ignore`, and so are form questions and id/status columns. A
 * single-value field goes to the FIRST column that matches only, so the mapping
 * screen shows exactly which column is used.
 */
export function guessColumnMap(headers: string[]): ColumnMap {
    const taken = new Set<string>();
    const columns: ColumnAssignment[] = headers.map(h => {
        const norm = normHeader(h);
        const rule = isQuestionHeader(norm) || isCodeHeader(norm) ? undefined : GUESS_RULES.find(r => r.test.test(norm));
        if (!rule || (isSingleValueField(rule.field) && taken.has(rule.field))) return { column: h, field: IGNORE, confidence: 'low' as const };
        taken.add(rule.field);
        return { column: h, field: rule.field, confidence: 'medium' as const };
    });
    return { columns };
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
    /** Contact cells dropped as placeholders ("no", "si", "-"), counted for the review notice. */
    droppedPlaceholders?: number;
}

const MULTI_CONTACT: Record<string, keyof Pick<MappedRow, 'phones' | 'emails' | 'socials' | 'addresses' | 'dnis'>> = {
    phone: 'phones', email: 'emails', social: 'socials', address: 'addresses', dni: 'dnis',
};

/** An empty MappedRow (used to pad AI output back to the input row count). */
export function emptyMappedRow(): MappedRow {
    return { name: '', phones: [], emails: [], socials: [], addresses: [], dnis: [], combinedContacts: [] };
}

/** Split a cell that packs several contact values into one, separated by ';' or
 *  newlines. NOT commas — addresses legitimately contain commas ("Calle 1234,
 *  Piso 2, Ciudad"). "a@x.com; b@y.com" → ['a@x.com', 'b@y.com']. */
export function splitMultiValue(v: string): string[] {
    return v.split(/[;\n]+/).map(s => s.trim()).filter(Boolean);
}

/** Words people type in a contact field to mean "none" (or a form's yes/no answer
 *  mapped by mistake). Compared after folding accents, case, punctuation and
 *  repeated letters, so "Sí.", "sii", "NOO", "n/a" all count. */
const PLACEHOLDER_CONTACTS = new Set([
    'si', 'no', 'x', 'na', 'n/a', 'ninguno', 'ninguna', 'nada', 'sin', 'no tengo', 'no tiene', 'no uso', 'no posee', '0', 'nn',
]);

/** True for a contact value that carries no contact ("no", "si", "-", "no tengo"). Pure. */
export function isPlaceholderContact(value: string): boolean {
    const v = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    if (!v || /^[\s\-_.,;:!?¡¿*/\\]+$/.test(v)) return true; // only punctuation ("-", "--", ".")
    const bare = v.replace(/[.,;:!¡?¿*()"']/g, '').replace(/\s+/g, ' ').trim();
    return PLACEHOLDER_CONTACTS.has(bare) || PLACEHOLDER_CONTACTS.has(bare.replace(/([a-z])\1+/g, '$1')); // "sii", "noo"
}

/** Join one row's address-column values into ONE address ("Calle 123, Localidad,
 *  Partido"), in column order, skipping a part an earlier part already contains. */
export function joinAddressParts(parts: string[]): string {
    const fold = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const kept: string[] = [];
    for (const p of parts.map(x => x.trim()).filter(Boolean)) {
        if (kept.some(k => fold(k).includes(fold(p)))) continue;
        kept.push(p);
    }
    return kept.join(', ');
}

function strArray(v: unknown): string[] {
    const raw = Array.isArray(v) ? v.map(x => (x ?? '').toString()) : (typeof v === 'string' ? [v] : []);
    return raw.flatMap(splitMultiValue);
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
        let dropped = 0;
        const contacts = (v: unknown) => strArray(v).filter(x => { const p = isPlaceholderContact(x); if (p) dropped++; return !p; });
        out.push({
            name: strOrUndef(r.name) ?? '',
            phones: contacts(r.phones), emails: contacts(r.emails), socials: contacts(r.socials),
            addresses: contacts(r.addresses), dnis: contacts(r.dnis), combinedContacts: [],
            animalName: strOrUndef(r.animalName), species: strOrUndef(r.species),
            sex: strOrUndef(r.sex), neutered: strOrUndef(r.neutered), color: strOrUndef(r.color),
            microchip: strOrUndef(r.microchip), age: strOrUndef(r.age), rating: strOrUndef(r.rating),
            date: strOrUndef(r.date), recordType: strOrUndef(r.recordType), details: strOrUndef(r.details),
            onBehalfOf: strOrUndef(r.onBehalfOf),
            ...(dropped ? { droppedPlaceholders: dropped } : {}),
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
    // Each address column's values for this row: several columns that each hold one
    // value are PARTS of one address (Dirección + Localidad + Partido).
    const addressCells: string[][] = [];
    let dropped = 0;

    for (const assign of map.columns) {
        if (assign.field === IGNORE) continue;
        const idx = indexOf.get(assign.column);
        if (idx === undefined) continue;
        const value = (row[idx] ?? '').toString().trim();
        if (!value) continue;

        if (assign.field === COMBINED_CONTACT) { out.combinedContacts.push(value); continue; }
        const multi = MULTI_CONTACT[assign.field];
        // A single cell may pack several values ("a@x.com; b@y.com") — split so
        // each becomes its own contact entry (own chip in review, stored separately).
        // "no" / "si" / "-" are not contacts: dropped and counted.
        if (multi) {
            const values = splitMultiValue(value).filter(p => { const ph = isPlaceholderContact(p); if (ph) dropped++; return !ph; });
            if (multi === 'addresses') { if (values.length) addressCells.push(values); }
            else out[multi].push(...values);
            continue;
        }
        // Single-value field: first non-empty wins.
        if (assign.field === 'name') { if (!out.name) out.name = value; continue; }
        const key = assign.field as keyof MappedRow;
        if (out[key] === undefined) (out as unknown as Record<string, unknown>)[key] = value;
    }
    // One value per address column → one joined address. A cell that itself holds
    // several addresses ("a; b") keeps them separate, as before.
    if (addressCells.length > 1 && addressCells.every(c => c.length === 1)) out.addresses.push(joinAddressParts(addressCells.map(c => c[0])));
    else out.addresses.push(...addressCells.flat());
    if (dropped) out.droppedPlaceholders = dropped;
    return out;
}
