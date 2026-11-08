import { describe, it, expect } from 'vitest';
import { extractTokens, computeTokenHash, extractLabeledIdQuery } from './tokenizer';
import { tokenInputsFor } from './adopterTokenize';

const base = { name: 'Juan Pérez', contactInfo: null, addressInfo: null, familyMembers: null, sourceUrl: null };

describe('a profile tokenizes only itself (households as profiles, v8)', () => {
    // A housemate is a profile of its own; the host's legacy inline JSON adds no tokens.
    const legacyHousehold = JSON.stringify([{ id: 'm1', name: 'María Gómez', relationship: 'partner', contactEntries: [
        { id: 'c1', type: 'phone', value: '11 2345-6789' },
        { id: 'c2', type: 'social', value: 'instagram.com/maria.g', platform: 'instagram' },
        { id: 'c3', type: 'email', value: 'maria@example.com' },
        { id: 'c4', type: 'id', value: 'DNI 30123456' },
    ] }]);
    const own = [{ type: 'phone', value: '11 9999-0000' }];
    const { entries } = tokenInputsFor({ contactEntries: JSON.stringify(own.map((e, i) => ({ id: `o${i}`, ...e }))), householdMembers: legacyHousehold } as Parameters<typeof tokenInputsFor>[0]);
    const tokens = extractTokens(base, [], entries);

    it("no household member's name", () => {
        expect(tokens.some(t => t.value.includes('maria') || t.value.includes('gomez'))).toBe(false);
    });
    it("no household member's phone, social, email or id", () => {
        expect(tokens.some(t => t.value.includes('23456789'))).toBe(false);
        expect(tokens.some(t => t.value.includes('maria.g') || t.value === 'maria@example.com' || t.type === 'id_number')).toBe(false);
    });
    it('its own entries still are', () => {
        expect(tokens.some(t => t.type === 'phone' && t.value.endsWith('99990000'))).toBe(true);
    });
    it('gift recipients\' phones (form data kept with the giver) are still the giver\'s own entries', () => {
        const gift = tokenInputsFor({ contactEntries: null }, [{ type: 'phone', value: '11 5555-0101' }]);
        expect(extractTokens(base, [], gift.entries).some(t => t.type === 'phone' && t.value.endsWith('55550101'))).toBe(true);
    });
    it('the legacy familyMembers free text stays a name source', () => {
        expect(extractTokens({ ...base, familyMembers: 'Tía Clara Sosa' }, [], []).some(t => t.type === 'name_word' && t.value === 'clara')).toBe(true);
    });
    it('the hash ignores the legacy household JSON (it no longer changes the tokens)', () => {
        const a = { ...base, name: 'Juan Pérez' };
        expect(computeTokenHash({ ...a, householdMembers: legacyHousehold } as Parameters<typeof computeTokenHash>[0])).toBe(computeTokenHash(a));
    });
    it('no entries → no crash', () => {
        expect(() => extractTokens(base)).not.toThrow();
    });
});

describe('name_full weighting (v6) — a shared first name is not a full-name match', () => {
    const of = (name: string) => extractTokens({ ...base, name }, [], []);

    it('does NOT emit name_full for a one-word name', () => {
        // Two records both called "Cristina" scored name_full(2) + name_word(1)
        // = 25%, landing in `medium` and surfacing to rescuers on a signal that
        // says almost nothing. 99 such pairs were pending in production.
        const tokens = of('Cristina');
        expect(tokens.some(t => t.type === 'name_full')).toBe(false);
        expect(tokens.some(t => t.type === 'name_word' && t.value === 'cristina')).toBe(true);
    });

    it('still emits name_full for a real full name', () => {
        const tokens = of('Cristina Fernández');
        expect(tokens.some(t => t.type === 'name_full' && t.value === 'cristina fernandez')).toBe(true);
    });

    it('keeps recall: the pair still matches on the shared word', () => {
        // Suppressing name_full must not make the records invisible to each
        // other — only less confident.
        const a = of('Cristina');
        const b = of('Cristina Gómez');
        const aWords = a.filter(t => t.type === 'name_word').map(t => t.value);
        const bWords = b.filter(t => t.type === 'name_word').map(t => t.value);
        expect(aWords.some(w => bWords.includes(w))).toBe(true);
    });

    it('is not fooled by padding around a single word', () => {
        expect(of('  Cristina  ').some(t => t.type === 'name_full')).toBe(false);
    });
});

describe('extractLabeledIdQuery — a documento typed as on the card (S3)', () => {
    it.each([
        ['DNI 25 999 890', '25999890'],
        ['Documento 25 999 890', '25999890'],
        ['documento 25.999.890', '25999890'],
        ['DNI25999890', '25999890'],
        ['DNI: 25.999.890', '25999890'],
        ['dni n° 25.999.890', '25999890'],
        ['Cédula 1.234.567-8', '12345678'],
        ['CI V-12345678', 'v12345678'],
        ['  doc 25-999-890 ', '25999890'],
    ])('%s → %s', (q, id) => {
        expect(extractLabeledIdQuery(q)).toBe(id);
    });

    it.each([
        'Juan Pérez',
        '25999890',                     // no label: the existing fallback reads it
        'DNI 25 999 890 Juan Pérez',    // more than a documento
        'Ceci 12345678',                // a name that starts like a label
        'documentos 2024',
        'DNI 12',                       // too short
        'dni ok',
    ])('%s → null', q => {
        expect(extractLabeledIdQuery(q)).toBeNull();
    });
});
