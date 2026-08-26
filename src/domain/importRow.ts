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
 *  ISO, D/M/Y and D-M-Y (day-first, matching the es locale). Extracts the FIRST
 *  valid date found ANYWHERE in the cell: legacy rows often carry a range
 *  ("14/03/2009 - 20/06/2009") or extra prose ("adoptado 4/07/2009"), and taking
 *  the first date beats rejecting the whole row.
 *
 *  Imprecise legacy data is accepted at the coarsest precision present, since the
 *  stored `date` is a timestamp with no partial-date type: a month + year
 *  ("06/2009", "2009-06", "diciembre 2009") maps to the 1st of that month, and a
 *  bare 4-digit year ("2015") maps to Jan 1 — the review's date picker shows the
 *  resolved date so the coercion is visible. Both are fallbacks: a complete date
 *  anywhere in the cell always wins. Returns null when no date is present ("hace un
 *  mes", "Feb 23rd", …). */
export function normalizeImportDate(raw: string | undefined, order: 'dmy' | 'mdy' = 'dmy'): string | null {
    if (!raw) return null;
    const s = String(raw).trim();
    const candidates: { idx: number; val: string | null }[] = [];
    const iso = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) candidates.push({ idx: iso.index ?? Infinity, val: ymd(+iso[1], +iso[2], +iso[3]) });
    const dmy = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (dmy) {
        let year = +dmy[3];
        if (year < 100) year += year < 50 ? 2000 : 1900;
        const a = +dmy[1], b = +dmy[2];
        const dayFirst = ymd(year, b, a);   // a=day,  b=month
        const monthFirst = ymd(year, a, b); // a=month, b=day
        // Disambiguate where a component proves the layout (a value >12 can only be
        // the day); otherwise honor `order` (default day-first, es locale).
        let val: string | null;
        if (a > 12 && b <= 12) val = dayFirst;        // a can only be a day
        else if (b > 12 && a <= 12) val = monthFirst; // b can only be a day → month-first
        else val = order === 'mdy' ? monthFirst : dayFirst;
        // Impossibility floor: never DROP a recoverable date — if the chosen reading
        // is invalid but the other parses, use the other. Fixes US MM/DD/YYYY dates
        // (e.g. 03/14/2009) that day-first used to turn into null. (audit E16)
        if (!val) val = dayFirst ?? monthFirst;
        candidates.push({ idx: dmy.index ?? Infinity, val });
    }
    // Earliest-positioned valid date wins (an ISO prefix beats a later dmy match).
    const valid = candidates.filter(c => c.val).sort((a, b) => a.idx - b.idx);
    if (valid.length) return valid[0].val;
    // Fallback 1: month + year → the 1st of that month.
    const my = monthYear(s);
    if (my) return my;
    // Fallback 2: the whole cell is just a 4-digit year → Jan 1 of that year.
    const yearOnly = s.match(/^(\d{4})$/);
    if (yearOnly) {
        const y = +yearOnly[1];
        if (y >= 1900 && y <= 2100) return ymd(y, 1, 1);
    }
    return null;
}
/**
 * Infer whether a sheet's numeric D/M/Y column is day-first ('dmy') or month-first
 * ('mdy') from UNAMBIGUOUS evidence: a component > 12 can only be the day. Returns
 * 'ambiguous' when no cell proves either layout (caller defaults to day-first, es);
 * mixed evidence → the majority. Pure — the wizard runs it once over the mapped
 * date column, then passes the winner into normalizeImportDate. (audit E16)
 */
export function inferDateOrder(cells: Array<string | null | undefined>): 'dmy' | 'mdy' | 'ambiguous' {
    let dmy = 0, mdy = 0;
    for (const raw of cells) {
        if (!raw) continue;
        const m = String(raw).match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
        if (!m) continue;
        const a = +m[1], b = +m[2];
        if (a > 12 && b <= 12) dmy++;
        else if (b > 12 && a <= 12) mdy++;
    }
    if (dmy === 0 && mdy === 0) return 'ambiguous';
    if (mdy === 0) return 'dmy';
    if (dmy === 0) return 'mdy';
    return dmy >= mdy ? 'dmy' : 'mdy';
}

function ymd(y: number, m: number, d: number): string | null {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
}

/** Month names (es/en/pt, full + common abbreviations), accent-stripped → 1–12. */
const MONTHS: Record<string, number> = {
    enero: 1, ene: 1, january: 1, jan: 1, janeiro: 1,
    febrero: 2, feb: 2, february: 2, fevereiro: 2, fev: 2,
    marzo: 3, mar: 3, march: 3, marco: 3, // março→marco (accent-stripped)
    abril: 4, abr: 4, april: 4, apr: 4,
    mayo: 5, may: 5, maio: 5, mai: 5,
    junio: 6, jun: 6, june: 6, junho: 6,
    julio: 7, jul: 7, july: 7, julho: 7,
    agosto: 8, ago: 8, august: 8, aug: 8,
    septiembre: 9, setiembre: 9, sep: 9, sept: 9, set: 9, september: 9, setembro: 9,
    octubre: 10, oct: 10, october: 10, outubro: 10, out: 10,
    noviembre: 11, nov: 11, november: 11, novembro: 11,
    diciembre: 12, dic: 12, december: 12, dec: 12, dezembro: 12, dez: 12,
};

/** A month+year cell → 'YYYY-MM-01', or null. Handles numeric MM/YYYY & YYYY/MM
 *  (whole cell; a 4-digit year keeps it unambiguous, so "12/09" stays null) and a
 *  named month + 4-digit year anywhere ("diciembre 2009", "dic de 2009"). */
function monthYear(s: string): string | null {
    const norm = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    let m = norm.match(/^(\d{1,2})[\/\-.](\d{4})$/);
    if (m) { const mo = +m[1], y = +m[2]; if (mo >= 1 && mo <= 12 && y >= 1900 && y <= 2100) return ymd(y, mo, 1); }
    m = norm.match(/^(\d{4})[\/\-.](\d{1,2})$/);
    if (m) { const y = +m[1], mo = +m[2]; if (mo >= 1 && mo <= 12 && y >= 1900 && y <= 2100) return ymd(y, mo, 1); }
    const yearMatch = norm.match(/\b(\d{4})\b/);
    if (yearMatch) {
        const y = +yearMatch[1];
        if (y >= 1900 && y <= 2100) {
            for (const tok of norm.split(/[^a-z]+/)) {
                if (tok && MONTHS[tok] != null) return ymd(y, MONTHS[tok], 1);
            }
        }
    }
    return null;
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
 * Validate a mapped row. Returns BLOCKING errors (empty = importable). The only
 * hard rule is the minimum identifier: a row needs a name OR at least one
 * contact. A present-but-unparseable rating/date does NOT block — see
 * `rowWarnings` (the value is dropped, the record still imports).
 */
export function validateMappedRow(row: MappedRow): string[] {
    const errors: string[] = [];
    const hasContact = [row.phones, row.emails, row.socials, row.dnis, row.addresses, row.combinedContacts]
        .some((a) => a && a.length > 0);
    if (!row.name?.trim() && !hasContact) {
        errors.push('Falta el nombre y el contacto del adoptante.');
    }
    return errors;
}

/**
 * Non-blocking warnings for a mapped row: a present-but-unparseable rating or
 * date. These never block import — the value is dropped (normalizeRating /
 * normalizeImportDate return null and the record imports without it) — but the
 * reviewer sees the warning so nothing is lost silently and they can fix or
 * clear the cell first, or proceed as-is.
 */
export function rowWarnings(row: MappedRow): string[] {
    const warnings: string[] = [];
    if (row.rating && normalizeRating(row.rating) === null) {
        warnings.push(`Rating no reconocido: "${row.rating}" — se importa sin rating.`);
    }
    if (row.date && normalizeImportDate(row.date) === null) {
        warnings.push(`Fecha no reconocida: "${row.date}" — se importa sin fecha.`);
    }
    return warnings;
}

/** Parse a YYYY-MM-DD import date to NOON UTC, not `new Date(str)` (= UTC
 *  midnight). Midnight-UTC renders as the PREVIOUS day in Buenos Aires (UTC-3)
 *  via formatShortDate's local getDate() — the off-by-one on imported profiles.
 *  Noon keeps the day correct across every real timezone (matches the manual
 *  form's parseLocalDate). Falls back to plain parsing for non-ISO strings.
 *  Lives here (a pure module) — NOT in the 'use server' importBatch.ts, which may
 *  only export async server actions. */
export function importDateToNoon(s: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0));
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
}
