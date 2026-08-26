/**
 * JS mirror of the SQL heuristics in `dataQuality.PII_SQL` ("Contacto en notas"
 * report). Kept here as a pure function so the admin panel can decide, right
 * after an inline edit, whether a note still qualifies for the report — and drop
 * the row locally without a page reload. **Keep in sync with PII_SQL.**
 */
export interface NotePiiFlags {
    hasPhone: boolean;
    hasSocial: boolean;
    hasAddress: boolean;
}

export function detectNotePii(note: string | null | undefined): NotePiiFlags {
    const s = note ?? '';
    const lower = s.toLowerCase();
    // Phone: a run of 7+ digits, or an NNNN-NNN pattern (mirrors the two GLOBs).
    const hasPhone = /\d{7}/.test(s) || /\d{4}-\d{3}/.test(s);
    // Social: a network name or a link.
    const hasSocial = /facebook|instagram|http|wa\.me/.test(lower);
    // Address: a street/neighborhood keyword. NOTE the trailing space in "calle "
    // matches the SQL and is the source of the "de la calle" false positive that
    // the "Falso positivo" dismiss handles.
    const hasAddress = /barrio|calle |avenida/.test(lower);
    return { hasPhone, hasSocial, hasAddress };
}

/** True when a note still matches any PII heuristic (i.e. would appear in the report). */
export function noteHasPii(note: string | null | undefined): boolean {
    const f = detectNotePii(note);
    return f.hasPhone || f.hasSocial || f.hasAddress;
}
