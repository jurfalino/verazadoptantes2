/**
 * Spreadsheet import — per-row normalization + validation (pure domain logic).
 * Turns the loosely-typed cell strings from `applyColumnMap` into validated,
 * schema-shaped values (rating 1–5, date YYYY-MM-DD, canonical recordType/species).
 * No DB/AI/lib imports. See .claude plan: spreadsheet import (P2).
 */

import type { MappedRow } from './importFields';

/** Parse a rating cell → integer 1–5, or null if absent/invalid. */
export function normalizeRating(raw: string | undefined): number | null {
    if (!raw) return null;
    const n = parseInt(String(raw).replace(/[^0-9-]/g, ''), 10);
    if (!Number.isFinite(n) || n < 1 || n > 5) return null;
    return n;
}

/** Parse a date cell → 'YYYY-MM-DD', or null if absent/unparseable. Accepts
 *  ISO, D/M/Y and D-M-Y (day-first, matching the es locale). */
export function normalizeImportDate(raw: string | undefined): string | null {
    if (!raw) return null;
    const s = String(raw).trim();
    const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return ymd(+iso[1], +iso[2], +iso[3]);
    const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (dmy) {
        let year = +dmy[3];
        if (year < 100) year += year < 50 ? 2000 : 1900;
        return ymd(year, +dmy[2], +dmy[1]); // day-first
    }
    return null;
}
function ymd(y: number, m: number, d: number): string | null {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
}

const SPECIES_MAP: Record<string, string> = {
    perro: 'dog', perra: 'dog', dog: 'dog', can: 'dog',
    gato: 'cat', gata: 'cat', cat: 'cat', michi: 'cat',
    ave: 'bird', pajaro: 'bird', bird: 'bird',
};
export function normalizeSpecies(raw: string | undefined): string | null {
    if (!raw) return null;
    const k = raw.trim().toLowerCase();
    return SPECIES_MAP[k] || raw.trim() || null;
}

const RECORD_TYPE_MAP: Record<string, string> = {
    adoption: 'adoption', adopcion: 'adoption', 'adopción': 'adoption', adoptado: 'adoption',
    foster: 'foster', transito: 'foster', 'tránsito': 'foster', acogida: 'foster', temporal: 'foster',
    observation: 'observation', observacion: 'observation', 'observación': 'observation', nota: 'observation',
    request: 'adoption_request', adoption_request: 'adoption_request', solicitud: 'adoption_request',
    follow_up: 'follow_up', followup: 'follow_up', seguimiento: 'follow_up',
    returned_pet: 'returned_pet', returned: 'returned_pet', devuelto: 'returned_pet', 'devolución': 'returned_pet', devolucion: 'returned_pet',
};
/** Canonicalize a record-type cell; defaults to 'adoption' (imports are adoptions). */
export function normalizeRecordType(raw: string | undefined): string {
    if (!raw) return 'adoption';
    return RECORD_TYPE_MAP[raw.trim().toLowerCase()] || 'adoption';
}

export function normalizeNeutered(raw: string | undefined): number | null {
    if (!raw) return null;
    const k = raw.trim().toLowerCase();
    if (['1', 'si', 'sí', 'yes', 'true', 'castrado', 'castrada', 'esterilizado', 'esterilizada'].includes(k)) return 1;
    if (['0', 'no', 'false'].includes(k)) return 0;
    return null;
}

/**
 * Validate a mapped row. Returns human-readable errors (empty = importable).
 * `name` is required; a present-but-invalid rating/date is an error (silently
 * dropping them would corrupt the record).
 */
export function validateMappedRow(row: MappedRow): string[] {
    const errors: string[] = [];
    if (!row.name || !row.name.trim()) errors.push('Falta el nombre del adoptante.');
    if (row.rating && normalizeRating(row.rating) === null) errors.push(`Rating inválido: "${row.rating}" (debe ser 1–5).`);
    if (row.date && normalizeImportDate(row.date) === null) errors.push(`Fecha inválida: "${row.date}".`);
    return errors;
}
