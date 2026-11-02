import { describe, it, expect } from 'vitest';
import { extractQueryIdentifiers } from './queryIdentifiers';

describe('extractQueryIdentifiers', () => {
    it('reads an email and leaves the rest', () => {
        expect(extractQueryIdentifiers('Maria Peres maria.perez@gmail.com')).toEqual({
            emails: ['maria.perez@gmail.com'], documentIds: [], handles: [], rest: 'Maria Peres',
        });
    });
    it('reads a dotted DNI', () => {
        expect(extractQueryIdentifiers('Majo Pérez 30.123.456')).toMatchObject({ documentIds: ['30.123.456'], rest: 'Majo Pérez' });
        expect(extractQueryIdentifiers('1.234.567')).toMatchObject({ documentIds: ['1.234.567'], rest: '' });
    });
    it('reads a plain 7-8 digit run as a DNI', () => {
        expect(extractQueryIdentifiers('30123456')).toMatchObject({ documentIds: ['30123456'] });
        expect(extractQueryIdentifiers('perez 3012345')).toMatchObject({ documentIds: ['3012345'], rest: 'perez' });
    });
    it('reads an @handle, without the @, and does not take an email for one', () => {
        expect(extractQueryIdentifiers('@mariajose.p')).toMatchObject({ handles: ['mariajose.p'], emails: [], rest: '' });
        expect(extractQueryIdentifiers('a@b.com')).toMatchObject({ handles: [], emails: ['a@b.com'] });
    });
    it('never reads a phone as a DNI', () => {
        for (const q of ['11 6585-1333', '+54 9 11 6585 1333', '1165851333', '(011) 4444-5555', 'Ana 11 6585 1333'])
            expect(extractQueryIdentifiers(q).documentIds).toEqual([]);
    });
    it('a plain name has no identifiers', () => {
        expect(extractQueryIdentifiers('María José Pérez')).toEqual({ emails: [], documentIds: [], handles: [], rest: 'María José Pérez' });
        expect(extractQueryIdentifiers('')).toEqual({ emails: [], documentIds: [], handles: [], rest: '' });
    });
});
