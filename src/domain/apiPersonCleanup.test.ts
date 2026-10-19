import { describe, expect, it } from 'vitest';
import { cleanApiPerson, firstEmailIn, isSocialDisplayName, phoneNumbersIn } from './apiPersonCleanup';
import { fullNameProblem, isFullName } from './apiExactMatch';

describe('firstEmailIn', () => {
    it('keeps a valid email as sent', () => expect(firstEmailIn('ana@example.com')).toBe('ana@example.com'));
    it('takes the first valid one of several', () => expect(firstEmailIn('ana@example.com /// beto@example.com')).toBe('ana@example.com'));
    it('drops a trailing note', () => expect(firstEmailIn('ana@example.com (hija)')).toBe('ana@example.com'));
    it('closes a space around the @', () => expect(firstEmailIn('ana @example.com')).toBe('ana@example.com'));
    it('never cuts an address out of a longer one (it would be someone else\'s)', () => {
        expect(firstEmailIn('ana perez@gmail.com')).toBeNull();
        expect(firstEmailIn('juan_ perez@hotmail.com')).toBeNull();
        expect(firstEmailIn('ana perez @gmail.com')).toBeNull();
    });
    it('refuses what is not an email', () => {
        for (const v of ['@usuario', 'no se', 'ana@gmail', 'ana@gmail.c', 'ana@.com', 'Ana']) expect(firstEmailIn(v)).toBeNull();
    });
});

describe('phoneNumbersIn', () => {
    it('returns a plain phone as sent', () => expect(phoneNumbersIn('11 4455-6677')).toBe('11 4455-6677'));
    it('never makes a readable phone worse (a note, odd dashes, slashes stay as sent)', () => {
        expect(phoneNumbersIn('11 4455-6677 solo WhatsApp')).toBe('11 4455-6677 solo WhatsApp');
        expect(phoneNumbersIn('11 4455\u20136677 cel')).toBe('11 4455-6677 cel');
        expect(phoneNumbersIn('11 4455\u20116677 whatsapp')).toBe('11 4455-6677 whatsapp');
        expect(phoneNumbersIn('11/4455/6677 cel')).toBe('11/4455/6677 cel');
        expect(phoneNumbersIn('(011) 4455-6677 casa')).toBe('(011) 4455-6677 casa');
    });
    it('a number labelled as a document is not a phone', () => {
        expect(phoneNumbersIn('DNI 30123456 cel 1144556677')).toBe('1144556677');
    });
    it('keeps two numbers glued by words, each on its own', () => {
        expect(phoneNumbersIn('11 4455-6677 el de mi marido 11 5566-7788')).toBe('11 4455-6677 / 11 5566-7788');
        // With a separator the reader already finds both: kept as sent.
        expect(phoneNumbersIn('11 4455-6677 o el de mi marido 11 5566-7788')).toBe('11 4455-6677 o el de mi marido 11 5566-7788');
    });
    it('null when there is no readable number', () => {
        for (const v of ['Xiaomi', 'no te interesa', '999', 'ana@example.com']) expect(phoneNumbersIn(v)).toBeNull();
    });
});

describe('isSocialDisplayName', () => {
    it('a name with a space is a display name', () => expect(isSocialDisplayName('Ana Perez')).toBe(true));
    it('handles and links are not', () => {
        for (const v of ['@ana.perez', 'ana.perez', 'https://facebook.com/ana.perez', 'facebook.com/ana.perez']) expect(isSocialDisplayName(v)).toBe(false);
    });
});

describe('cleanApiPerson', () => {
    const base = { fullName: 'Ana Perez' };

    it('drops a bad phone when the email is usable, and says so', () => {
        const r = cleanApiPerson({ ...base, email: 'ana@example.com', phone: 'Xiaomi' });
        expect(r.person.phone).toBeUndefined();
        expect(r.person.email).toBe('ana@example.com');
        expect(r.dropped).toEqual([{ field: 'person.phone', reason: 'not_a_phone' }]);
    });

    it('drops a bad email when the phone is usable', () => {
        const r = cleanApiPerson({ ...base, email: '@anaperez', phone: '11 4455-6677' });
        expect(r.person.email).toBeUndefined();
        expect(r.dropped).toEqual([{ field: 'person.email', reason: 'not_an_email' }]);
    });

    it('keeps a bad value when nothing else identifies the person (the call is refused as before)', () => {
        const r = cleanApiPerson({ ...base, email: 'no se', phone: 'no tengo' });
        expect(r.person.email).toBe('no se');
        expect(r.person.phone).toBe('no tengo');
        expect(r.dropped).toEqual([]);
    });

    it('a usable document keeps the call alive', () => {
        const r = cleanApiPerson({ ...base, phone: 'Oppo', documentId: { value: '30.123.456' } });
        expect(r.person.phone).toBeUndefined();
    });

    it('cleans rather than drops when part of the value is usable', () => {
        const r = cleanApiPerson({ ...base, email: 'ana@example.com (hija)', phone: '11 4455-6677 el de mi marido 11 5566-7788 trabajo' });
        expect(r.person).toMatchObject({ email: 'ana@example.com' });
        expect(r.cleaned.map(c => c.reason).sort()).toEqual(['first_valid_email', 'phone_numbers_only']);
        expect(r.dropped).toEqual([]);
    });

    it('drops "no account" socials and keeps display names and handles', () => {
        const r = cleanApiPerson({ ...base, email: 'ana@example.com', socials: [
            { platform: 'facebook', handle: 'no tengo' }, { platform: 'instagram', handle: '-' },
            { platform: 'facebook', handle: 'Ana Perez' }, { platform: 'instagram', handle: '@ana.perez' },
        ] });
        expect(r.person.socials).toEqual([{ platform: 'facebook', handle: 'Ana Perez' }, { platform: 'instagram', handle: '@ana.perez' }]);
        expect(r.dropped.map(d => d.reason)).toEqual(['no_account', 'no_account']);
    });

    it('leaves a clean person untouched', () => {
        const person = { ...base, email: 'ana@example.com', phone: '+54 9 11 4455-6677' };
        const r = cleanApiPerson(person);
        expect(r.person).toEqual(person);
        expect(r.dropped).toEqual([]);
        expect(r.cleaned).toEqual([]);
    });
});

describe('fullNameProblem', () => {
    it('accepts a first name and surname, ignoring a stray digit', () => {
        for (const n of ['Ana Perez', 'María José Pérez', 'Ana Perez2', "D'Angelo Ruiz"]) expect(isFullName(n)).toBe(true);
    });
    it('refuses an email, a phone, keyboard mash and a single word', () => {
        expect(fullNameProblem('ana.perez@gmail.com')).toBe('has_email');
        expect(fullNameProblem('11 4455 6677')).toBe('looks_like_phone');
        expect(fullNameProblem('sdfg hjkl')).toBe('no_vowels');
        expect(fullNameProblem('Yamila')).toBe('one_word');
        expect(fullNameProblem('')).toBe('one_word');
    });
});
