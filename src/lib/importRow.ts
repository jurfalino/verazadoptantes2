/**
 * Spreadsheet import — build the POST /api/adopters body from a mapped row (P2).
 * Splits `combined_contact` cells deterministically via `categorizeContactText`,
 * assembles typed `contactEntries`, and normalizes the adoption fields. Flags
 * rows whose combined cell yielded no structured contact for optional AI
 * escalation (P3). Reuses the same contact + normalization utilities the manual
 * flows use, so imported records look identical to hand-entered ones.
 */

import { categorizeContactText, buildContactEntries, type ContactEntry } from '@/lib/contactEntries';
import { normalizeRating, normalizeImportDate, normalizeSpecies, normalizeRecordType, normalizeNeutered, validateMappedRow, rowWarnings } from '@/domain/importRow';
import type { MappedRow } from '@/domain/importFields';

export interface ImportBody {
    name: string;
    contactEntries: string; // JSON ContactEntry[]; POST /api/adopters derives the contactInfo blob from this
    source: 'imported';
    adoption: {
        animalName: string | null;
        species: string | null;
        recordType: string;
        rating: number | null;
        date: string | null;
        sex: string | null;
        neutered: number | null;
        color: string | null;
        microchip: string | null;
        age: string | null;
        details: string | null;
        onBehalfOf: string | null;
    };
}

export interface BuiltRow {
    body: ImportBody | null; // null when errors present
    errors: string[];
    /** Non-blocking warnings (unparseable rating/date). The row still imports. */
    warnings: string[];
    /** A combined-contact cell produced no structured contact → AI-cleanup candidate. */
    needsAiCleanup: boolean;
}

/** Extra contacts recovered by AI escalation, merged into the deterministic result. */
export interface ExtraContacts {
    phones?: string[];
    emails?: string[];
    socials?: string[];
    addresses?: string[];
    ids?: string[];
}

export function buildImportBody(row: MappedRow, extra?: ExtraContacts): BuiltRow {
    const errors = validateMappedRow(row);
    const warnings = rowWarnings(row);

    // Deterministic split of combined cells.
    const split: ContactEntry[] = row.combinedContacts.flatMap(c => categorizeContactText(c));
    const ofType = (t: ContactEntry['type']) => split.filter(e => e.type === t).map(e => e.value);
    const hadStructured = split.some(e => e.type === 'phone' || e.type === 'email' || e.type === 'social' || e.type === 'id');
    const needsAiCleanup = row.combinedContacts.length > 0 && !hadStructured && !extra;

    const entries = buildContactEntries({
        phones: [...row.phones, ...ofType('phone'), ...(extra?.phones ?? [])],
        emails: [...row.emails, ...ofType('email'), ...(extra?.emails ?? [])],
        socials: [...row.socials, ...ofType('social'), ...(extra?.socials ?? [])],
        addresses: [...row.addresses, ...ofType('address'), ...ofType('other'), ...(extra?.addresses ?? [])],
        ids: [...row.dnis, ...ofType('id'), ...(extra?.ids ?? [])].map(value => ({ value, label: 'DNI' })),
    });

    if (errors.length) return { body: null, errors, warnings, needsAiCleanup };

    const body: ImportBody = {
        name: row.name.trim(),
        contactEntries: JSON.stringify(entries),
        source: 'imported',
        adoption: {
            animalName: row.animalName?.trim() || null,
            species: normalizeSpecies(row.species),
            recordType: normalizeRecordType(row.recordType),
            rating: normalizeRating(row.rating),
            date: normalizeImportDate(row.date),
            sex: row.sex?.trim() || null,
            neutered: normalizeNeutered(row.neutered),
            color: row.color?.trim() || null,
            microchip: row.microchip?.trim() || null,
            age: row.age?.trim() || null,
            details: row.details?.trim() || null,
            onBehalfOf: row.onBehalfOf?.trim() || null,
        },
    };
    return { body, errors: [], warnings, needsAiCleanup };
}
