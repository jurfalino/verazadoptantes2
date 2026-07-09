import { describe, it, expect } from 'vitest';
import { parseColumnMap, hasNameMapping, applyColumnMap, parseAiRows, COMBINED_CONTACT, IGNORE } from './importFields';

const headers = ['Nombre', 'Tel', 'Mail', 'Contacto', 'Mascota', 'Basura'];

describe('parseColumnMap', () => {
    it('maps a well-formed AI response and preserves header order', () => {
        const raw = {
            columns: [
                { column: 'Nombre', field: 'name', confidence: 'high' },
                { column: 'Tel', field: 'phone', confidence: 'high' },
                { column: 'Mail', field: 'email', confidence: 'medium' },
                { column: 'Contacto', field: COMBINED_CONTACT, confidence: 'medium' },
                { column: 'Mascota', field: 'animalName', confidence: 'low' },
                { column: 'Basura', field: IGNORE, confidence: 'high' },
            ],
            notes: 'ok',
        };
        const map = parseColumnMap(raw, headers);
        expect(map.columns.map(c => c.column)).toEqual(headers); // order preserved
        expect(map.columns.map(c => c.field)).toEqual(['name', 'phone', 'email', COMBINED_CONTACT, 'animalName', IGNORE]);
        expect(map.notes).toBe('ok');
        expect(hasNameMapping(map)).toBe(true);
    });

    it('defaults omitted headers to ignore (never drops a column)', () => {
        const raw = { columns: [{ column: 'Nombre', field: 'name', confidence: 'high' }] };
        const map = parseColumnMap(raw, headers);
        expect(map.columns).toHaveLength(headers.length);
        expect(map.columns.find(c => c.column === 'Tel')?.field).toBe(IGNORE);
    });

    it('coerces an unknown/invalid destination to ignore', () => {
        const raw = { columns: [{ column: 'Tel', field: 'not_a_field', confidence: 'high' }] };
        const map = parseColumnMap(raw, headers);
        const tel = map.columns.find(c => c.column === 'Tel')!;
        expect(tel.field).toBe(IGNORE);
        expect(tel.confidence).toBe('low'); // downgraded since the AI's choice was invalid
    });

    it('discards assignments for headers not present in the sheet', () => {
        const raw = { columns: [{ column: 'Ghost', field: 'name', confidence: 'high' }, { column: 'Nombre', field: 'name', confidence: 'high' }] };
        const map = parseColumnMap(raw, headers);
        expect(map.columns.find(c => c.column === 'Ghost')).toBeUndefined();
        expect(map.columns).toHaveLength(headers.length);
    });

    it('ignores duplicate assignments for the same column (first wins)', () => {
        const raw = { columns: [{ column: 'Tel', field: 'phone', confidence: 'high' }, { column: 'Tel', field: 'email', confidence: 'high' }] };
        const map = parseColumnMap(raw, headers);
        expect(map.columns.find(c => c.column === 'Tel')?.field).toBe('phone');
    });

    it('tolerates a garbage response (returns all-ignore, no name)', () => {
        expect(hasNameMapping(parseColumnMap(null, headers))).toBe(false);
        expect(parseColumnMap({}, headers).columns.every(c => c.field === IGNORE)).toBe(true);
        expect(parseColumnMap('nonsense', headers).columns).toHaveLength(headers.length);
    });
});

describe('applyColumnMap', () => {
    const headers = ['Nombre', 'Tel', 'Tel2', 'Mail', 'Contacto', 'Mascota', 'Puntaje', 'Basura'];
    const map = parseColumnMap({
        columns: [
            { column: 'Nombre', field: 'name', confidence: 'high' },
            { column: 'Tel', field: 'phone', confidence: 'high' },
            { column: 'Tel2', field: 'phone', confidence: 'high' },
            { column: 'Mail', field: 'email', confidence: 'high' },
            { column: 'Contacto', field: COMBINED_CONTACT, confidence: 'medium' },
            { column: 'Mascota', field: 'animalName', confidence: 'high' },
            { column: 'Puntaje', field: 'rating', confidence: 'high' },
            { column: 'Basura', field: IGNORE, confidence: 'high' },
        ],
    }, headers);

    it('projects a row onto the schema (multi-value contacts as arrays)', () => {
        const row = ['María', '11-1111', '11-2222', 'm@x.com', 'insta @maria / Calle 1', 'Luna', '4', 'xx'];
        const m = applyColumnMap(map, headers, row);
        expect(m.name).toBe('María');
        expect(m.phones).toEqual(['11-1111', '11-2222']);
        expect(m.emails).toEqual(['m@x.com']);
        expect(m.combinedContacts).toEqual(['insta @maria / Calle 1']);
        expect(m.animalName).toBe('Luna');
        expect(m.rating).toBe('4');
    });

    it('skips empty cells and ignored columns', () => {
        const row = ['Ana', '', '', '', '', '', '', 'junk'];
        const m = applyColumnMap(map, headers, row);
        expect(m.name).toBe('Ana');
        expect(m.phones).toEqual([]);
        expect(m.animalName).toBeUndefined();
    });
});

describe('parseAiRows', () => {
    it('validates AI records and coerces types', () => {
        const raw = { records: [
            { name: 'María', phones: ['11-1', '11-2'], emails: 'm@x.com', animalName: 'Luna', species: 'perro', rating: 4, recordType: 'foster' },
        ] };
        const [r] = parseAiRows(raw, 1);
        expect(r.name).toBe('María');
        expect(r.phones).toEqual(['11-1', '11-2']);
        expect(r.emails).toEqual(['m@x.com']);   // string coerced to array
        expect(r.rating).toBe('4');              // kept as string (validated later)
        expect(r.combinedContacts).toEqual([]);  // AI already split
    });

    it('aligns to the input count (pads missing, truncates extra)', () => {
        expect(parseAiRows({ records: [{ name: 'A' }] }, 3)).toHaveLength(3);
        expect(parseAiRows({ records: [{ name: 'A' }] }, 3)[2].name).toBe('');
        expect(parseAiRows([{ name: 'A' }, { name: 'B' }, { name: 'C' }], 2)).toHaveLength(2);
    });

    it('tolerates garbage (bare array or nonsense)', () => {
        expect(parseAiRows([{ name: 'A' }], 1)[0].name).toBe('A'); // bare array accepted
        expect(parseAiRows(null, 2).every(r => r.name === '')).toBe(true);
        expect(parseAiRows('junk', 2)).toHaveLength(2);
    });
});
