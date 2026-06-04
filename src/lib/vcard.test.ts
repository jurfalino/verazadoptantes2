import { describe, it, expect } from 'vitest';
import { parseVcard } from './vcard';

describe('parseVcard', () => {
    it('parses an Android export with QP-encoded accented name and a folded ADR', () => {
        // Real-shape Android Contacts export: vCard 2.1, quoted-printable for
        // accents, a folded ADR (one space continues the previous line).
        const text =
            'BEGIN:VCARD\r\n' +
            'VERSION:2.1\r\n' +
            'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Garc=C3=ADa;Jos=C3=A9;;;\r\n' +
            'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Jos=C3=A9 Garc=C3=ADa\r\n' +
            'TEL;CELL:+54 11 2345-6789\r\n' +
            'TEL;HOME:1145-1010\r\n' +
            'EMAIL;INTERNET:jose.garcia@gmail.com\r\n' +
            'ADR;HOME;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:;;Av. Corrient\r\n' +
            ' es 1234;Ciudad Aut=C3=B3noma de Buenos Aires;CABA;C1043;Argentina\r\n' +
            'END:VCARD\r\n';

        const parsed = parseVcard(text);
        expect(parsed).not.toBeNull();
        expect(parsed!.name).toBe('José García');
        // Mobile-tagged TEL is preferred first.
        expect(parsed!.phones).toEqual(['+54 11 2345-6789', '1145-1010']);
        expect(parsed!.emails).toEqual(['jose.garcia@gmail.com']);
        expect(parsed!.addresses).toHaveLength(1);
        expect(parsed!.addresses[0].streetAndNumber).toBe('Av. Corrientes 1234');
        // Locality joins city/region/postal/country with commas.
        expect(parsed!.addresses[0].locality).toBe('Ciudad Autónoma de Buenos Aires, CABA, C1043, Argentina');
        expect(parsed!.pickedFromMultiple).toBe(false);
    });

    it('parses an iOS export (vCard 3.0) and ignores PHOTO + grouped item prefixes', () => {
        // iOS Contacts groups properties (item1.TEL, item1.X-ABLabel) and
        // embeds a base64 PHOTO. Both must be ignored, not crash the parser.
        const text =
            'BEGIN:VCARD\n' +
            'VERSION:3.0\n' +
            'N:Smith;Anna;;;\n' +
            'FN:Anna Smith\n' +
            'item1.TEL:+1-555-0100\n' +
            'item1.X-ABLabel:mobile\n' +
            'EMAIL;type=INTERNET;type=HOME;type=pref:anna@example.com\n' +
            'PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkM\n' +
            'NOTE:Met at the rescue\n' +
            'END:VCARD\n';

        const parsed = parseVcard(text);
        expect(parsed).not.toBeNull();
        expect(parsed!.name).toBe('Anna Smith');
        expect(parsed!.phones).toEqual(['+1-555-0100']);
        expect(parsed!.emails).toEqual(['anna@example.com']);
        // No ADR in this file.
        expect(parsed!.addresses).toEqual([]);
    });

    it('picks the first contact when the file holds multiple and flags pickedFromMultiple', () => {
        const text =
            'BEGIN:VCARD\nVERSION:3.0\nFN:Alpha One\nTEL:+1-111-1111\nEND:VCARD\n' +
            'BEGIN:VCARD\nVERSION:3.0\nFN:Beta Two\nTEL:+2-222-2222\nEND:VCARD\n' +
            'BEGIN:VCARD\nVERSION:3.0\nFN:Gamma Three\nTEL:+3-333-3333\nEND:VCARD\n';

        const parsed = parseVcard(text);
        expect(parsed).not.toBeNull();
        expect(parsed!.name).toBe('Alpha One');
        expect(parsed!.phones).toEqual(['+1-111-1111']);
        expect(parsed!.pickedFromMultiple).toBe(true);
    });

    it('returns null for empty / malformed input instead of throwing', () => {
        expect(parseVcard('')).toBeNull();
        expect(parseVcard('not a vcard at all')).toBeNull();
        expect(parseVcard('BEGIN:VCARD\nEND:VCARD')).toBeNull();
    });

    it('falls back to N (structured) when FN is missing', () => {
        const text =
            'BEGIN:VCARD\nVERSION:3.0\n' +
            'N:Apellido;Nombre;;;\n' +
            'TEL:+54 9 11 5555-5555\n' +
            'END:VCARD\n';
        const parsed = parseVcard(text);
        expect(parsed!.name).toBe('Nombre Apellido');
    });

    it('treats a non-structured ADR (no semicolons) as raw', () => {
        const text =
            'BEGIN:VCARD\nVERSION:3.0\nFN:Test\n' +
            'ADR:Lote 5 Manzana 12 Barrio X\n' +
            'TEL:1234567\n' +
            'END:VCARD\n';
        const parsed = parseVcard(text);
        expect(parsed!.addresses).toHaveLength(1);
        expect(parsed!.addresses[0].raw).toBe('Lote 5 Manzana 12 Barrio X');
        expect(parsed!.addresses[0].streetAndNumber).toBeUndefined();
        expect(parsed!.addresses[0].locality).toBeUndefined();
    });
});
