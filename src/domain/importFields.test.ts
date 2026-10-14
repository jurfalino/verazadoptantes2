import { describe, it, expect } from 'vitest';
import { parseColumnMap, hasNameMapping, applyColumnMap, parseAiRows, guessColumnMap, splitMultiValue, isPlaceholderContact, joinAddressParts, COMBINED_CONTACT, IGNORE } from './importFields';

describe('splitMultiValue', () => {
    it("splits on ';' and newlines, trims, drops empties", () => {
        expect(splitMultiValue('a@x.com; b@y.com')).toEqual(['a@x.com', 'b@y.com']);
        expect(splitMultiValue('11-1111\n22-2222 ; 33-3333')).toEqual(['11-1111', '22-2222', '33-3333']);
        expect(splitMultiValue('solo@uno.com')).toEqual(['solo@uno.com']);
    });
    it('does NOT split on commas (addresses contain them)', () => {
        expect(splitMultiValue('Calle 1234, Piso 2, Ciudad')).toEqual(['Calle 1234, Piso 2, Ciudad']);
    });
});

describe('applyColumnMap — multi-value cells', () => {
    it('splits a cell packing several values into separate entries', () => {
        const map = { columns: [{ column: 'Tels', field: 'phone', confidence: 'high' as const }, { column: 'Dir', field: 'address', confidence: 'high' as const }] };
        const row = applyColumnMap(map, ['Tels', 'Dir'], ['11-1; 11-2 ; 11-3', 'Av. Siempreviva 742, Springfield']);
        expect(row.phones).toEqual(['11-1', '11-2', '11-3']);
        expect(row.addresses).toEqual(['Av. Siempreviva 742, Springfield']); // comma NOT split
    });
});

const headers = ['Nombre', 'Tel', 'Mail', 'Contacto', 'Mascota', 'Basura'];

describe('guessColumnMap', () => {
    const field = (m: ReturnType<typeof guessColumnMap>, col: string) => m.columns.find(c => c.column === col)?.field;
    it('maps the real VANA headers offline (accent/case-insensitive), unknowns → ignore', () => {
        const m = guessColumnMap(['row_id', 'numero', 'tramo', 'nombre', 'aportante', 'telefonos', 'emails', 'dni', 'facebook', 'direccion', 'fecha', 'tipo', 'rating', 'motivo']);
        expect(field(m, 'nombre')).toBe('name');
        expect(field(m, 'telefonos')).toBe('phone');
        expect(field(m, 'emails')).toBe('email');
        expect(field(m, 'dni')).toBe('dni');
        expect(field(m, 'facebook')).toBe('social');
        expect(field(m, 'direccion')).toBe('address');
        expect(field(m, 'fecha')).toBe('date');
        expect(field(m, 'tipo')).toBe('recordType');
        expect(field(m, 'rating')).toBe('rating');
        expect(field(m, 'motivo')).toBe('details');
        expect(field(m, 'aportante')).toBe('onBehalfOf');
        // Non-field headers are ignored, never misassigned.
        expect(field(m, 'row_id')).toBe(IGNORE);
        expect(field(m, 'numero')).toBe(IGNORE);
        expect(field(m, 'tramo')).toBe(IGNORE);
    });
    it('handles accents/case (Teléfono, Correo, Dirección)', () => {
        const m = guessColumnMap(['Teléfono', 'Correo electrónico', 'Dirección']);
        expect(field(m, 'Teléfono')).toBe('phone');
        expect(field(m, 'Correo electrónico')).toBe('email');
        expect(field(m, 'Dirección')).toBe('address');
    });
});

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

describe('guessColumnMap — a form export (one column per question)', () => {
    // Headers of a real rescue's adoption-form export (2026-10), no data.
    const headers = [
        'entry_id', 'formulario', 'fecha', 'estado', 'tipo', 'animal_id', 'animal_nombre', 'animal_tipo', 'animal_estado',
        'Nombre y Apellido', 'Edad', 'Profesión', 'Celular', 'Email', 'Direccion', 'Partido', 'Localidad', 'Facebook', 'Instagram',
        '2. ¿Qué tipo de vivienda tenés?',
        '13. ¿Qué harías con el gato si en la nueva vivienda no aceptan animales?',
        '16.5. ¿Qué alimento le das? Por favor mencioná nombre y marca.',
        '22. ¿Estás dispuesto a realizar el trabajo de acercamiento y socialización?',
        '1. ¿Por qué motivo querés adoptar un gato?',
    ];
    const m = guessColumnMap(headers);
    const field = (col: string) => m.columns.find(c => c.column === col)?.field;
    it('maps the person, the animal and the date', () => {
        expect(field('Nombre y Apellido')).toBe('name');
        expect(field('Celular')).toBe('phone');
        expect(field('Email')).toBe('email');
        expect(field('Facebook')).toBe('social');
        expect(field('Instagram')).toBe('social');
        expect(field('Direccion')).toBe('address');
        expect(field('Partido')).toBe('address');
        expect(field('Localidad')).toBe('address');
        expect(field('fecha')).toBe('date');
        expect(field('animal_nombre')).toBe('animalName');
        expect(field('animal_tipo')).toBe('species');
    });
    it('never guesses a question, an id or a status column', () => {
        for (const h of headers.filter(x => /^\d/.test(x))) expect(field(h)).toBe(IGNORE);
        expect(field('animal_id')).toBe(IGNORE);
        expect(field('animal_estado')).toBe(IGNORE);
        expect(field('estado')).toBe(IGNORE);
        expect(field('entry_id')).toBe(IGNORE);
    });
    it("leaves the applicant's age unmapped (the import's age is the animal's)", () => {
        expect(field('Edad')).toBe(IGNORE);
    });
    it('gives a single-value field to the first matching column only', () => {
        const mm = guessColumnMap(['Nombre', 'Nombre del contacto', 'Mascota', 'Mascota anterior']);
        expect(mm.columns.map(c => c.field)).toEqual(['name', IGNORE, 'animalName', IGNORE]);
    });
    it('still reads "a nombre de" as on-behalf-of', () => {
        expect(guessColumnMap(['A nombre de']).columns[0].field).toBe('onBehalfOf');
    });
});

describe('isPlaceholderContact', () => {
    it('drops "none" answers and yes/no answers', () => {
        for (const v of ['no', 'NO', 'No.', 'si', 'Sí', 'sii', 'noo', '-', '--', '.', 'n/a', 'N/A', 'ninguno', 'No tengo', 'no posee', 'x']) {
            expect(isPlaceholderContact(v)).toBe(true);
        }
    });
    it('keeps real contacts', () => {
        for (const v of ['nora', 'simon.perez', '@no_name', 'no@mail.com', 'Calle Sin Nombre 123', 'facebook.com/sii.ana', '11 5555-1234']) {
            expect(isPlaceholderContact(v)).toBe(false);
        }
    });
});

describe('applyColumnMap — placeholders and address parts', () => {
    const map = { columns: [
        { column: 'Nombre', field: 'name', confidence: 'high' as const },
        { column: 'Dir', field: 'address', confidence: 'high' as const },
        { column: 'Localidad', field: 'address', confidence: 'high' as const },
        { column: 'Partido', field: 'address', confidence: 'high' as const },
        { column: 'IG', field: 'social', confidence: 'high' as const },
        { column: 'FB', field: 'social', confidence: 'high' as const },
    ] };
    const headers = ['Nombre', 'Dir', 'Localidad', 'Partido', 'IG', 'FB'];
    it('joins one value per address column into ONE address, skipping repeated parts', () => {
        const r = applyColumnMap(map, headers, ['Ana', 'Calle 1 123', 'Ramos Mejía', 'La Matanza', '', '']);
        expect(r.addresses).toEqual(['Calle 1 123, Ramos Mejía, La Matanza']);
        const r2 = applyColumnMap(map, headers, ['Ana', 'Calle 1 123, Ramos Mejia', 'Ramos Mejía', '', '', '']);
        expect(r2.addresses).toEqual(['Calle 1 123, Ramos Mejia']);
    });
    it('keeps several addresses in one cell apart, as before', () => {
        const r = applyColumnMap(map, headers, ['Ana', 'Calle 1; Calle 2', 'Morón', '', '', '']);
        expect(r.addresses).toEqual(['Calle 1', 'Calle 2', 'Morón']);
    });
    it('drops placeholder contacts and counts them', () => {
        const r = applyColumnMap(map, headers, ['Ana', '', '', '', 'no', '@ana.ok']);
        expect(r.socials).toEqual(['@ana.ok']);
        expect(r.droppedPlaceholders).toBe(1);
    });
    it('the AI path drops them too', () => {
        const [r] = parseAiRows([{ name: 'Ana', socials: ['si', '@ana'], phones: ['-'] }], 1);
        expect(r.socials).toEqual(['@ana']);
        expect(r.phones).toEqual([]);
        expect(r.droppedPlaceholders).toBe(2);
    });
    it('joinAddressParts ignores blanks', () => {
        expect(joinAddressParts([' Calle 9 ', '', 'CABA'])).toBe('Calle 9, CABA');
    });
});

describe('guessColumnMap — labels that must still map (review 2026-10-14)', () => {
    const f = (headers: string[]) => guessColumnMap(headers).columns.map(c => c.field);
    it('numbered labels, a short question and a long phone label', () => {
        expect(f(['1. Nombre y apellido', '2. Teléfono', '3. Email'])).toEqual(['name', 'phone', 'email']);
        expect(f(['¿Tu teléfono?'])).toEqual(['phone']);
        expect(f(['Teléfono celular de contacto con código de área sin 15'])).toEqual(['phone']);
    });
    it('id/status words do not hide their own keyword', () => {
        expect(f(['DNI / ID', 'ID Instagram', 'Estado / Calificación'])).toEqual(['dni', 'social', 'rating']);
    });
    it('the shortest label wins a single-value field', () => {
        expect(f(['Tipo de vivienda', 'Tipo'])).toEqual([IGNORE, 'recordType']);
    });
});

describe('applyColumnMap — which address columns join (review 2026-10-14)', () => {
    const cols = (hs: string[]) => ({ columns: hs.map(h => ({ column: h, field: 'address', confidence: 'high' as const })) });
    it('two addresses of their own stay two', () => {
        const hs = ['Dirección', 'Dirección laboral'];
        expect(applyColumnMap(cols(hs), hs, ['Calle 1 123', 'Av. Siempre Viva 742']).addresses).toEqual(['Calle 1 123', 'Av. Siempre Viva 742']);
    });
    it('a locality column before the street still joins it', () => {
        const hs = ['Localidad', 'Domicilio'];
        expect(applyColumnMap(cols(hs), hs, ['Morón', 'Calle 1 123']).addresses).toEqual(['Calle 1 123, Morón']);
    });
    it('a partido named like the street is kept', () => {
        const hs = ['Dirección', 'Partido'];
        expect(applyColumnMap(cols(hs), hs, ['Calle San Martín 100', 'San Martín']).addresses).toEqual(['Calle San Martín 100, San Martín']);
    });
});
