import { describe, it, expect } from 'vitest';
import { matchBreakdown } from './matchBreakdown';

const has = (o: Partial<Record<'phone' | 'email' | 'id' | 'social' | 'address', boolean>> = {}) =>
    ({ phone: false, email: false, id: false, social: false, address: false, ...o });

describe('matchBreakdown', () => {
    it('a phone match with another name: same phone, different name, email only in the post', () => {
        const rows = matchBreakdown({
            matchTypes: ['phone'],
            post: { name: 'Pedro Prueba', entries: [{ type: 'phone', value: '11 2345-6789' }, { type: 'email', value: 'p@x.com' }] },
            profile: { name: 'María García', has: has({ phone: true, address: true }) },
        });
        expect(rows).toEqual([
            { field: 'phone', status: 'match', post: '11 2345-6789' },
            { field: 'name', status: 'different', post: 'Pedro Prueba', profile: 'María García' },
            { field: 'email', status: 'only_post', post: 'p@x.com' },
            { field: 'address', status: 'only_profile' },
        ]);
    });

    it('a name-only match: partial name, the phones differ', () => {
        const rows = matchBreakdown({
            matchTypes: ['name_word'],
            post: { name: 'María López', entries: [{ type: 'phone', value: '11 1111-1111' }] },
            profile: { name: 'María García López', has: has({ phone: true }) },
        });
        expect(rows.map(r => [r.field, r.status])).toEqual([['name', 'partial'], ['phone', 'different']]);
    });

    it('never puts the existing profile\'s contact values in the result', () => {
        const rows = matchBreakdown({
            matchTypes: [],
            post: { name: '', entries: [] },
            profile: { name: 'X', has: has({ phone: true, email: true }) },
        });
        expect(rows.every(r => r.field === 'name' || r.profile === undefined)).toBe(true);
        expect(rows.map(r => r.status)).toEqual(['only_profile', 'only_profile']);
    });

    it('a suffix match is partial, an exact one is a match', () => {
        const rows = matchBreakdown({
            matchTypes: ['phone_suffix'],
            post: { name: 'A', entries: [{ type: 'phone', value: '1234' }] },
            profile: { name: 'A', has: has({ phone: true }) },
        });
        expect(rows.find(r => r.field === 'phone')?.status).toBe('partial');
    });

    it('works before the profile details load (no presence info)', () => {
        const rows = matchBreakdown({
            matchTypes: ['email'],
            post: { name: 'A', entries: [{ type: 'email', value: 'a@b.c' }, { type: 'phone', value: '1' }] },
            profile: { name: 'B', has: null },
        });
        expect(rows.map(r => [r.field, r.status])).toEqual([['email', 'match'], ['name', 'different'], ['phone', 'only_post']]);
    });
});
