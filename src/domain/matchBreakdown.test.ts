import { describe, it, expect } from 'vitest';
import { matchBreakdown, otherSignals, summarizeBreakdown } from './matchBreakdown';

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

describe('matchBreakdown: names on screen', () => {
    it('a "full name" hit on a longer name is shown as similar, with both names', () => {
        const rows = matchBreakdown({
            matchTypes: ['name_full', 'phone'],
            source: { name: 'María García', entries: [{ type: 'phone', value: '555-1234' }] },
            profile: { name: 'María García López', has: has({ phone: true }) },
        });
        expect(rows.find(r => r.field === 'name')).toEqual({ field: 'name', status: 'partial', source: 'María García', profile: 'María García López' });
    });
    it('accents and case alone do not make names different', () => {
        const rows = matchBreakdown({
            matchTypes: ['name_full'],
            source: { name: 'maria garcia', entries: [] },
            profile: { name: 'María García', has: has() },
        });
        expect(rows[0].status).toBe('match');
    });
});

describe('matchBreakdown: pairs the engine did not match on name', () => {
    it('equal names are «coincide» even with no name signal (phone-only or flagged pair)', () => {
        const rows = matchBreakdown({
            matchTypes: ['flagged_by_user'],
            source: { name: 'Lucía Fernández', entries: [] },
            profile: { name: 'Lucia Fernandez', has: has() },
        });
        expect(rows).toEqual([{ field: 'name', status: 'match', source: 'Lucía Fernández', profile: 'Lucia Fernandez' }]);
    });
    it('lists the signals no field row can show', () => {
        expect(otherSignals(['flagged_by_user', 'phone', 'token:source_url', 'like_fallback'])).toEqual(['flagged_by_user', 'source_url', 'like_fallback']);
    });
});

describe('matchBreakdown: the profile\'s values, where the screen shows them', () => {
    it('puts both values on each row; equal values match even without an engine signal', () => {
        const rows = matchBreakdown({
            matchTypes: ['phone'],
            source: { name: 'Ana', entries: [{ type: 'phone', value: '4555 0377' }, { type: 'email', value: 'ana@x.com' }] },
            profile: { name: 'Ana', has: has({ phone: true, email: true, address: true }), entries: [
                { type: 'phone', value: '4555-0377' }, { type: 'email', value: 'ANA@x.com' }, { type: 'address', value: 'Calle 1' },
            ] },
        });
        expect(rows).toEqual([
            { field: 'name', status: 'match', source: 'Ana', profile: 'Ana' },
            { field: 'phone', status: 'match', source: '4555 0377', profile: '4555-0377' },
            { field: 'email', status: 'match', source: 'ana@x.com', profile: 'ANA@x.com' },
            { field: 'address', status: 'only_profile', profile: 'Calle 1' },
        ]);
    });
    it('a masked value is shown as masked and never counts as equal', () => {
        const rows = matchBreakdown({
            matchTypes: [],
            source: { name: 'A', entries: [{ type: 'email', value: 'a@b.c' }] },
            profile: { name: 'B', has: has({ email: true }), entries: [{ type: 'email', value: '•••••@•••' }] },
        });
        expect(rows.find(r => r.field === 'email')).toEqual({ field: 'email', status: 'different', source: 'a@b.c', profile: '•••••@•••' });
    });
});

describe('summarizeBreakdown («Coinciden: … · Distinto: …»)', () => {
    it('match and partial count as the same, different as distinct, one-sided rows as neither — in row order', () => {
        expect(summarizeBreakdown([
            { field: 'name', status: 'partial', source: 'María López', profile: 'María García López' },
            { field: 'phone', status: 'different', source: '11 1111-1111' },
            { field: 'email', status: 'match', source: 'm@x.com' },
            { field: 'social', status: 'only_source', source: '@maria' },
            { field: 'id', status: 'different', source: '123' },
            { field: 'address', status: 'only_profile' },
        ])).toEqual({ same: ['name', 'email'], diff: ['phone', 'id'] });
    });
    it('no rows: both empty', () => expect(summarizeBreakdown([])).toEqual({ same: [], diff: [] }));
});
