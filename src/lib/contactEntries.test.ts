import { describe, it, expect } from 'vitest';
import {
    categorizeContactText,
    contactEntriesToBlob,
    parseBlobToContactEntries,
    buildContactEntries,
    deserializeContactEntries,
    mergeContactEntries,
    type ContactEntry,
} from './contactEntries';

function valuesOf(entries: ContactEntry[], type: ContactEntry['type']): string[] {
    return entries.filter(e => e.type === type).map(e => e.value);
}

describe('categorizeContactText', () => {
    it('categorizes a mixed multi-line paste into typed entries', () => {
        const entries = categorizeContactText(
            'Tel: 11 2345-6789\njuan@gmail.com\nIG @juanp\nDNI 30123456',
        );
        expect(valuesOf(entries, 'phone')).toEqual(['11 2345-6789']);
        expect(valuesOf(entries, 'email')).toEqual(['juan@gmail.com']);
        expect(valuesOf(entries, 'social')).toEqual(['@juanp']);
        expect(valuesOf(entries, 'id')).toEqual(['30123456']);
        expect(valuesOf(entries, 'other')).toEqual([]);
    });

    it('classifies an unlabeled number as phone (UI lets the user reclassify to id)', () => {
        const entries = categorizeContactText('Juan Perez 1123456789');
        expect(valuesOf(entries, 'phone')).toEqual(['1123456789']);
        expect(valuesOf(entries, 'id')).toEqual([]);
    });

    it('keeps a note that shares a line with a phone as leftover prose', () => {
        const entries = categorizeContactText('11234567 hermano de Maria');
        expect(valuesOf(entries, 'phone')).toEqual(['11234567']);
        const other = valuesOf(entries, 'other');
        expect(other).toHaveLength(1);
        expect(other[0]).toContain('hermano de Maria');
    });

    it('keeps a pure-prose line verbatim', () => {
        const entries = categorizeContactText('preguntar por el en el kiosco');
        expect(valuesOf(entries, 'other')).toEqual(['preguntar por el en el kiosco']);
    });

    it('de-duplicates the same phone written with different separators', () => {
        const entries = categorizeContactText('11 2345-6789\n1123456789');
        expect(valuesOf(entries, 'phone')).toEqual(['11 2345-6789']);
    });

    it('preserves the phone formatting the user entered', () => {
        expect(valuesOf(categorizeContactText('+54 11 2345-6789'), 'phone')).toEqual(['+54 11 2345-6789']);
        expect(valuesOf(categorizeContactText('Tel: (011) 4567-8900'), 'phone')).toEqual(['(011) 4567-8900']);
    });

    it('returns an empty array for blank input', () => {
        expect(categorizeContactText('')).toEqual([]);
        expect(categorizeContactText(null)).toEqual([]);
        expect(categorizeContactText('   ')).toEqual([]);
    });
});

describe('contactEntriesToBlob', () => {
    it('writes one labeled line per typed entry', () => {
        const blob = contactEntriesToBlob([
            { type: 'phone', value: '1123456789' },
            { type: 'email', value: 'juan@gmail.com' },
            { type: 'id', value: '30123456', label: 'DNI' },
        ]);
        expect(blob).toContain('Tel: 1123456789');
        expect(blob).toContain('Email: juan@gmail.com');
        expect(blob).toContain('DNI: 30123456');
    });

    it('writes other entries verbatim with no prefix', () => {
        const blob = contactEntriesToBlob([{ type: 'other', value: 'ask at the kiosk' }]);
        expect(blob).toBe('ask at the kiosk');
    });

    it('returns an empty string for no entries', () => {
        expect(contactEntriesToBlob([])).toBe('');
    });
});

describe('legacy blob round-trip (lossless)', () => {
    it('preserves every prose line through parse then derive', () => {
        const blob = [
            'Documento: 30123456',
            'Email: juan@gmail.com',
            'Tel: 1123456789',
            'preguntar por el en el kiosco',
        ].join('\n');
        const roundTripped = contactEntriesToBlob(parseBlobToContactEntries(blob));
        expect(roundTripped).toContain('preguntar por el en el kiosco');
        expect(roundTripped).toContain('30123456');
        expect(roundTripped).toContain('juan@gmail.com');
        expect(roundTripped).toContain('1123456789');
    });

    it('does not drop a free-text-only legacy blob', () => {
        const blob = 'llamar despues de las 6\npreferentemente fin de semana';
        const roundTripped = contactEntriesToBlob(parseBlobToContactEntries(blob));
        expect(roundTripped).toContain('llamar despues de las 6');
        expect(roundTripped).toContain('preferentemente fin de semana');
    });
});

describe('buildContactEntries', () => {
    it('builds de-duplicated typed entries from structured parts', () => {
        const entries = buildContactEntries({
            phones: ['1123456789', '1123456789', ''],
            emails: ['a@b.com'],
            socials: ['@x'],
            ids: [{ value: '30123456', label: 'DNI' }],
            addresses: ['Calle Falsa 123'],
        });
        expect(valuesOf(entries, 'phone')).toEqual(['1123456789']);
        expect(valuesOf(entries, 'email')).toEqual(['a@b.com']);
        expect(valuesOf(entries, 'social')).toEqual(['@x']);
        expect(valuesOf(entries, 'address')).toEqual(['Calle Falsa 123']);
        expect(entries.find(e => e.type === 'id')).toEqual({ type: 'id', value: '30123456', label: 'DNI' });
    });
});

describe('address entries', () => {
    it('writes an address entry to the blob under the Dirección label', () => {
        const blob = contactEntriesToBlob([{ type: 'address', value: 'Av. Siempre Viva 742' }]);
        expect(blob).toBe('Dirección: Av. Siempre Viva 742');
    });

    it('round-trips a stored address entry through deserialize', () => {
        const entries = deserializeContactEntries('[{"type":"address","value":"Av. Siempre Viva 742"}]');
        expect(entries).toMatchObject([{ type: 'address', value: 'Av. Siempre Viva 742' }]);
    });

    it('classifies a street-keyword-led line as address, keeping the street type', () => {
        const entries = categorizeContactText('Av. Corrientes 1234');
        expect(valuesOf(entries, 'address')).toEqual(['Av. Corrientes 1234']);
    });

    it('strips a leading address label from the stored value', () => {
        const entries = categorizeContactText('Dirección: Calle Falsa 123');
        expect(valuesOf(entries, 'address')).toEqual(['Calle Falsa 123']);
        expect(valuesOf(entries, 'other')).toEqual([]);
    });

    it('detects a "Dir" label written without a colon', () => {
        const entries = categorizeContactText('Dir Av Siempre Viva 742');
        expect(valuesOf(entries, 'address')).toEqual(['Av Siempre Viva 742']);
    });

    it('does not misclassify a word that merely starts with an address keyword', () => {
        const entries = categorizeContactText('Avísame cuando puedas');
        expect(valuesOf(entries, 'address')).toEqual([]);
        expect(valuesOf(entries, 'other')).toEqual(['Avísame cuando puedas']);
    });

    it('detects an address line pasted alongside a phone line', () => {
        const entries = categorizeContactText('Tel: 1123456789\nCalle Falsa 123');
        expect(valuesOf(entries, 'phone')).toEqual(['1123456789']);
        expect(valuesOf(entries, 'address')).toEqual(['Calle Falsa 123']);
    });
});

describe('deserializeContactEntries', () => {
    it('parses valid stored JSON', () => {
        const entries = deserializeContactEntries('[{"type":"phone","value":"123"}]');
        expect(entries).toMatchObject([{ type: 'phone', value: '123' }]);
    });

    it('returns an empty array for null, invalid JSON, or non-arrays', () => {
        expect(deserializeContactEntries(null)).toEqual([]);
        expect(deserializeContactEntries('not json')).toEqual([]);
        expect(deserializeContactEntries('{"type":"phone"}')).toEqual([]);
    });

    it('drops entries with an unknown type', () => {
        expect(deserializeContactEntries('[{"type":"bogus","value":"x"}]')).toEqual([]);
    });

    it('assigns an id to legacy entries that lack one', () => {
        const entries = deserializeContactEntries('[{"type":"phone","value":"123"}]');
        expect(entries[0].id).toBeDefined();
        expect(typeof entries[0].id).toBe('string');
        expect(entries[0].id!.length).toBeGreaterThan(0);
    });

    it('preserves an existing id', () => {
        const entries = deserializeContactEntries('[{"id":"abc-123","type":"phone","value":"123"}]');
        expect(entries[0].id).toBe('abc-123');
    });

    it('assigns different ids to two legacy entries', () => {
        const entries = deserializeContactEntries('[{"type":"phone","value":"1"},{"type":"phone","value":"2"}]');
        expect(entries[0].id).not.toBe(entries[1].id);
    });

    it('accepts alias type', () => {
        const entries = deserializeContactEntries('[{"type":"alias","value":"Juan Garcia"}]');
        expect(entries).toHaveLength(1);
        expect(entries[0].type).toBe('alias');
        expect(entries[0].value).toBe('Juan Garcia');
    });
});

describe('mergeContactEntries', () => {
    it('merges two lists, de-duplicating on the normalized value', () => {
        const merged = mergeContactEntries(
            [{ type: 'phone', value: '1123456789' }],
            [{ type: 'phone', value: '11 2345-6789' }, { type: 'email', value: 'a@b.com' }],
        );
        expect(valuesOf(merged, 'phone')).toEqual(['1123456789']);
        expect(valuesOf(merged, 'email')).toEqual(['a@b.com']);
    });

    it('preserves the older entry id when deduping', () => {
        const merged = mergeContactEntries(
            [{ id: 'older', type: 'phone', value: '1123456789' }],
            [{ id: 'newer', type: 'phone', value: '11 2345-6789' }],
        );
        expect(merged).toHaveLength(1);
        expect(merged[0].id).toBe('older');
    });
});

describe('alias contact entries', () => {
    it('writes an alias entry to the blob under the Conocido/a como label', () => {
        const blob = contactEntriesToBlob([{ type: 'alias', value: 'Juan Garcia' }]);
        expect(blob).toContain('Conocido/a como: Juan Garcia');
    });

    it('round-trips an alias entry through deserialize', () => {
        const entries = deserializeContactEntries('[{"type":"alias","value":"Juan Garcia"}]');
        expect(entries[0].type).toBe('alias');
        expect(entries[0].value).toBe('Juan Garcia');
    });

    it('deduplicates two aliases with the same normalized value', () => {
        const merged = mergeContactEntries(
            [{ type: 'alias', value: 'Juan Garcia' }],
            [{ type: 'alias', value: 'juan garcia' }],
        );
        expect(merged).toHaveLength(1);
    });

    it('keeps two distinct aliases as separate entries', () => {
        const merged = mergeContactEntries(
            [{ type: 'alias', value: 'Juan Garcia' }],
            [{ type: 'alias', value: 'Juan Pérez' }],
        );
        expect(merged).toHaveLength(2);
    });
});

// Pure-function coverage for the lazy legacy-row migration path used by
// addContactEntry, updateContactEntry, removeContactEntry, and the admin
// backfill. The server-side glue (DB read/write/auth) is exercised on
// staging; what's testable in isolation is the parse → assign IDs → merge
// chain, and that's exactly the regression class we care about (a parser
// bug here silently destroys real production data on migration).
describe('legacy contactInfo → structured contactEntries (lazy migration)', () => {
    function migrate(blob: string) {
        const parsed = parseBlobToContactEntries(blob);
        // Mirrors the id-assignment in addContactEntry's lazy branch.
        return parsed.map(e => ({ id: `id-${e.type}-${e.value}`, ...e }));
    }

    it('parses a labeled phone blob and every produced entry has an id', () => {
        const seeded = migrate('Teléfonos: +54 9 11 3161-7720');
        // At minimum one phone entry; the categorizer may also produce an
        // `other` residual from the label, which is fine — the load-bearing
        // claim is "phone is captured and id-assigned, not silently dropped."
        expect(seeded.length).toBeGreaterThan(0);
        const phones = seeded.filter(e => e.type === 'phone');
        expect(phones).toHaveLength(1);
        expect(phones[0].value).toContain('3161-7720');
        expect(seeded.every(e => !!e.id)).toBe(true);
    });

    it('parses a multi-line social+address blob into typed entries', () => {
        const seeded = migrate(
            'Redes sociales: https://www.facebook.com/Dario.Fernandez\nDirección: Jujuy 1842, Quilmes',
        );
        // Social and address both surface as their typed entries. The exact
        // value formatting (URL normalization, casing) is the categorizer's
        // call and tested elsewhere; here we just need the types present.
        expect(seeded.some(e => e.type === 'social')).toBe(true);
        expect(seeded.some(e => e.type === 'address')).toBe(true);
        expect(seeded.every(e => !!e.id)).toBe(true);
    });

    it('merging a new entry on top of the seeded legacy entries preserves both', () => {
        // The data-loss bug shape: pre-fix, the merge would have run against
        // an empty existing array (deserialize on NULL returns []) and the
        // saved row would be just the new entry, losing the legacy data.
        const seeded = migrate('Tel: 555-1234\nEmail: maria@example.com');
        const newEntry: ContactEntry = { id: 'new-1', type: 'phone', value: '555-9999' };
        const merged = mergeContactEntries(seeded, [newEntry]);
        // Original phone + email preserved, new phone added — three entries total.
        expect(merged).toHaveLength(3);
        expect(valuesOf(merged, 'phone')).toContain('555-9999');
        expect(valuesOf(merged, 'email')).toEqual(['maria@example.com']);
    });

    it('merging a duplicate of a seeded legacy entry keeps the original (dedup wins)', () => {
        const seeded = migrate('Tel: 555-1234');
        const newEntry: ContactEntry = { id: 'new-1', type: 'phone', value: '555-1234' };
        const merged = mergeContactEntries(seeded, [newEntry]);
        expect(merged).toHaveLength(1);
        // The original (seeded) entry's id wins per the older-entry-id rule.
        expect(merged[0].id).toBe('id-phone-555-1234');
    });
});

// v2.16.0-9 adds per-entry contributor attribution so a contributor can edit
// the entries they themselves added. The persistence shape and dedupe
// behavior have to honor `addedBy` symmetrically with `id`.
describe('per-entry addedBy attribution', () => {
    it('deserializeContactEntries preserves addedBy when present', () => {
        const entries = deserializeContactEntries(
            '[{"id":"a","type":"phone","value":"555-1234","addedBy":"alice@example.com"}]',
        );
        expect(entries[0].addedBy).toBe('alice@example.com');
    });

    it('deserializeContactEntries leaves addedBy undefined on legacy entries', () => {
        const entries = deserializeContactEntries('[{"type":"phone","value":"555-1234"}]');
        expect(entries[0].addedBy).toBeUndefined();
    });

    it('mergeContactEntries keeps the older entry’s addedBy on value collision', () => {
        const merged = mergeContactEntries(
            [{ id: 'older', type: 'phone', value: '1123456789', addedBy: 'first@example.com' }],
            [{ id: 'newer', type: 'phone', value: '11 2345-6789', addedBy: 'second@example.com' }],
        );
        expect(merged).toHaveLength(1);
        expect(merged[0].addedBy).toBe('first@example.com');
    });
});
