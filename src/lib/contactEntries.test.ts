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
        expect(entries).toEqual([{ type: 'address', value: 'Av. Siempre Viva 742' }]);
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
        expect(entries).toEqual([{ type: 'phone', value: '123' }]);
    });

    it('returns an empty array for null, invalid JSON, or non-arrays', () => {
        expect(deserializeContactEntries(null)).toEqual([]);
        expect(deserializeContactEntries('not json')).toEqual([]);
        expect(deserializeContactEntries('{"type":"phone"}')).toEqual([]);
    });

    it('drops entries with an unknown type', () => {
        expect(deserializeContactEntries('[{"type":"bogus","value":"x"}]')).toEqual([]);
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
});
