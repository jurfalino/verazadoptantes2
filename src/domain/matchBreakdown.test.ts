import { describe, it, expect } from 'vitest';
import { matchBreakdown } from './matchBreakdown';

const has = (o: Partial<Record<'phone' | 'email' | 'id' | 'social' | 'address', boolean>> = {}) =>
    ({ phone: false, email: false, id: false, social: false, address: false, ...o });

describe('matchBreakdown', () => {
    it('a phone match with another name: same phone, different name, email only in the source', () => {
        const rows = matchBreakdown({
            matchTypes: ['phone'],
            source: { name: 'Pedro Prueba', entries: [{ type: 'phone', value: '11 2345-6789' }, { type: 'email', value: 'p@x.com' }] },
            profile: { name: 'María García', has: has({ phone: true, address: true }) },
        });
        expect(rows).toEqual([
            { field: 'phone', status: 'match', source: '11 2345-6789' },
            { field: 'name', status: 'different', source: 'Pedro Prueba', profile: 'María García' },
            { field: 'email', status: 'only_source', source: 'p@x.com' },
            { field: 'address', status: 'only_profile' },
        ]);
    });

    it('a name-only match: partial name, the phones differ', () => {
        const rows = matchBreakdown({
            matchTypes: ['name_word'],
            source: { name: 'María López', entries: [{ type: 'phone', value: '11 1111-1111' }] },
            profile: { name: 'María García López', has: has({ phone: true }) },
        });
        expect(rows.map(r => [r.field, r.status])).toEqual([['name', 'partial'], ['phone', 'different']]);
    });

    it('never puts the existing profile\'s contact values in the result', () => {
        const rows = matchBreakdown({
            matchTypes: [],
            source: { name: '', entries: [] },
            profile: { name: 'X', has: has({ phone: true, email: true }) },
        });
        expect(rows.every(r => r.field === 'name' || r.profile === undefined)).toBe(true);
        expect(rows.map(r => r.status)).toEqual(['only_profile', 'only_profile']);
    });

    it('a suffix match is partial, an exact one is a match', () => {
        const rows = matchBreakdown({
            matchTypes: ['phone_suffix'],
            source: { name: 'A', entries: [{ type: 'phone', value: '1234' }] },
            profile: { name: 'A', has: has({ phone: true }) },
        });
        expect(rows.find(r => r.field === 'phone')?.status).toBe('partial');
    });

    it('works before the profile details load (no presence info)', () => {
        const rows = matchBreakdown({
            matchTypes: ['email'],
            source: { name: 'A', entries: [{ type: 'email', value: 'a@b.c' }, { type: 'phone', value: '1' }] },
            profile: { name: 'B', has: null },
        });
        expect(rows.map(r => [r.field, r.status])).toEqual([['email', 'match'], ['name', 'different'], ['phone', 'only_source']]);
    });
});

describe('matchBreakdown: form notifications', () => {
    it('reads the legacy prefixed match types ("token:phone")', () => {
        const rows = matchBreakdown({
            matchTypes: ['token:phone', 'token:name_word'],
            source: { name: 'Ana Pérez', entries: [{ type: 'phone', value: '4555 0377' }] },
            profile: { name: 'Ana Pérez Gómez', has: { phone: true, email: false, id: false, social: false, address: false } },
        });
        expect(rows.map(r => [r.field, r.status])).toEqual([['phone', 'match'], ['name', 'partial']]);
    });
});
