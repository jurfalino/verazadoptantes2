import { describe, it, expect } from 'vitest';
import { buildCreatePrefill, looksLikeName, parseContactsParam, appendCreatePrefill } from './createPrefill';

describe('buildCreatePrefill', () => {
    it('uses a plain name as the name', () => {
        expect(buildCreatePrefill('María González')).toEqual({ name: 'María González', contacts: [] });
    });

    // The reported defect: the search box invites an address, and every "create
    // new" path wrote it into the name field.
    it('never puts an address in the name', () => {
        const out = buildCreatePrefill('Av. Rivadavia 4820, Caballito');
        expect(out.name).toBeUndefined();
        expect(out.contacts.some(c => c.type === 'address')).toBe(true);
    });

    it('never puts a bare phone in the name', () => {
        const out = buildCreatePrefill('11 3318-6767');
        expect(out.name).toBeUndefined();
        expect(out.contacts).toHaveLength(1);
        expect(out.contacts[0].type).toBe('phone');
    });

    it('never puts an email in the name', () => {
        const out = buildCreatePrefill('ana.martinez@gmail.com');
        expect(out.name).toBeUndefined();
        expect(out.contacts[0].type).toBe('email');
    });

    // The behaviour v2.19.35 added, which must survive the rewrite.
    it('still splits a mixed name-and-phone query', () => {
        const out = buildCreatePrefill('Susana 11-2345-6789');
        expect(out.name).toBe('Susana');
        expect(out.contacts.some(c => c.type === 'phone')).toBe(true);
    });

    it('keeps a long multi-part name intact', () => {
        expect(buildCreatePrefill('María Fernanda Gutiérrez de Rodríguez').name)
            .toBe('María Fernanda Gutiérrez de Rodríguez');
    });

    it('returns nothing for an empty query', () => {
        expect(buildCreatePrefill('')).toEqual({ contacts: [] });
        expect(buildCreatePrefill(null)).toEqual({ contacts: [] });
        expect(buildCreatePrefill('   ')).toEqual({ contacts: [] });
    });
});

describe('looksLikeName', () => {
    it('accepts names with accents and several words', () => {
        expect(looksLikeName('María Fernanda Gutiérrez')).toBe(true);
    });

    it('rejects anything carrying digits, an @ or a URL', () => {
        expect(looksLikeName('Rivadavia 4820')).toBe(false);
        expect(looksLikeName('ana@mail.com')).toBe(false);
        expect(looksLikeName('https://instagram.com/ana')).toBe(false);
    });

    it('rejects prose too long to be a name', () => {
        expect(looksLikeName('x'.repeat(61))).toBe(false);
    });

    it('rejects empty values', () => {
        expect(looksLikeName('')).toBe(false);
        expect(looksLikeName(null)).toBe(false);
    });
});

describe('appendCreatePrefill / parseContactsParam', () => {
    it('round-trips a mixed query through URL params', () => {
        const params = new URLSearchParams();
        appendCreatePrefill(params, 'Susana 11-2345-6789');
        expect(params.get('name')).toBe('Susana');
        const back = parseContactsParam(params.get('contacts'));
        expect(back.some(c => c.type === 'phone')).toBe(true);
    });

    it('writes no params for an empty query', () => {
        const params = new URLSearchParams();
        appendCreatePrefill(params, '');
        expect(params.toString()).toBe('');
    });

    // The value comes off a URL, so it is untrusted input.
    it('survives malformed or hostile param values', () => {
        expect(parseContactsParam('not json')).toEqual([]);
        expect(parseContactsParam('{"not":"an array"}')).toEqual([]);
        expect(parseContactsParam(null)).toEqual([]);
        expect(parseContactsParam('[{"type":"__proto__","value":"x"}]')).toEqual([]);
        expect(parseContactsParam('[{"type":"phone"}]')).toEqual([]);
    });

    it('bounds how much a URL can seed', () => {
        const many = JSON.stringify(Array.from({ length: 40 }, () => ({ type: 'phone', value: '1123456789' })));
        expect(parseContactsParam(many)).toHaveLength(10);
        const long = JSON.stringify([{ type: 'other', value: 'x'.repeat(5000) }]);
        expect(parseContactsParam(long)[0].value.length).toBe(300);
    });
});
