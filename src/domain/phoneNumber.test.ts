import { describe, it, expect } from 'vitest';
import { readPhone, phoneIndexTokens, phoneQueryPlan, phoneMatchesQuery, phoneDuplicateTokens, samePhone } from './phoneNumber';

const MIN = 6;

describe('readPhone — every way the same Argentine number is written', () => {
    const sameNumber = ['+54 11 6585 1333', '+54 9 11 6585-1333', '011 15 6585-1333', '11 15 6585 1333', '1165851333', '11-6585-1333', '(11) 6585-1333'];
    it.each(sameNumber)('%s → 541165851333', (v) => {
        expect(readPhone(v, 'AR')).toEqual({ kind: 'complete', key: '541165851333', national: '1165851333' });
    });

    it('handles 3- and 4-digit area codes', () => {
        expect(readPhone('0351 15 412-3456', 'AR')).toMatchObject({ kind: 'complete', key: '543514123456' });
        expect(readPhone('351 4123456', 'AR')).toMatchObject({ kind: 'complete', key: '543514123456' });
        expect(readPhone('2944 123456', 'AR')).toMatchObject({ kind: 'complete', key: '542944123456' });
        expect(readPhone('+54 9 2944 123456', 'AR')).toMatchObject({ kind: 'complete', key: '542944123456' });
    });

    it('keeps Córdoba and Rosario apart even though their last 8 digits agree', () => {
        expect(readPhone('351 412-3456', 'AR')!).not.toEqual(readPhone('341 412-3456', 'AR'));
    });

    it('reads other countries', () => {
        expect(readPhone('+1 (212) 555-0199', 'AR')).toMatchObject({ kind: 'complete', key: '12125550199' });
        expect(readPhone('+34 612 34 56 78', 'AR')).toMatchObject({ kind: 'complete', key: '34612345678' });
        expect(readPhone('99 123 456', 'UY')).toMatchObject({ kind: 'complete', key: '59899123456' });
    });

    it('keeps a number without an area code as incomplete — never invents one', () => {
        expect(readPhone('6585 1333', 'AR')).toEqual({ kind: 'incomplete', local: '65851333' });
        expect(readPhone('4864-8245', 'AR')).toEqual({ kind: 'incomplete', local: '48648245' });
    });

    it('drops the old "15" mobile prefix from an incomplete number', () => {
        expect(readPhone('15-6585-1333', 'AR')).toEqual({ kind: 'incomplete', local: '65851333' });
        expect(readPhone('156-1013599', 'AR')).toEqual({ kind: 'incomplete', local: '61013599' });
    });

    it('rejects placeholders and fragments', () => {
        expect(readPhone('1234567', 'AR')).toBeNull();
        expect(readPhone('99999999', 'AR')).toBeNull();
        expect(readPhone('6585', 'AR')).toBeNull();
        expect(readPhone('', 'AR')).toBeNull();
    });

    it('defaults to Argentina when the country is missing or malformed', () => {
        expect(readPhone('1165851333', null)).toMatchObject({ key: '541165851333' });
        expect(readPhone('1165851333', 'argentina')).toMatchObject({ key: '541165851333' });
    });
});

describe('phoneIndexTokens', () => {
    it('stores a complete number as its key plus its last 8 national digits', () => {
        expect(phoneIndexTokens('+54 9 11 6585-1333', 'AR')).toEqual([
            { type: 'phone', value: '541165851333' },
            { type: 'phone_suffix', value: '65851333' },
        ]);
    });
    it('stores an incomplete number as its local digits only', () => {
        expect(phoneIndexTokens('6585 1333', 'AR')).toEqual([{ type: 'phone', value: '65851333' }]);
    });
});

describe('phoneQueryPlan', () => {
    it('a complete search looks up the exact key, and the endings a local-only record could hold', () => {
        const plan = phoneQueryPlan('+54 11 6585 1333', 'AR', MIN)!;
        expect(plan.exact).toEqual(expect.arrayContaining(['541165851333', '65851333', '5851333', '851333']));
        expect(plan.endsWith).toEqual([]);
    });

    it('a partial search matches endings, strong from 8 digits', () => {
        expect(phoneQueryPlan('6585 1333', 'AR', MIN)).toEqual({ exact: [], endsWith: [{ digits: '65851333', strong: true }] });
        expect(phoneQueryPlan('585-1333', 'AR', MIN)).toEqual({ exact: [], endsWith: [{ digits: '5851333', strong: false }] });
    });

    it('country and area code alone never produce a lookup', () => {
        expect(phoneQueryPlan('+54 11', 'AR', MIN)).toBeNull();
        expect(phoneQueryPlan('+54 9 11 65', 'AR', MIN)).toBeNull();
    });

    it('nothing below the minimum digits', () => {
        expect(phoneQueryPlan('6585', 'AR', MIN)).toBeNull();
        expect(phoneQueryPlan('maria', 'AR', MIN)).toBeNull();
    });

    it('finds a phone inside a name query', () => {
        expect(phoneQueryPlan('jonatan 1165851333', 'AR', MIN)!.exact).toContain('541165851333');
    });
});

describe('phoneMatchesQuery — the reveal rule', () => {
    it('the reported case: "+54 9 11 6585 1333" identifies a stored "1165851333"', () => {
        expect(phoneMatchesQuery('1165851333', '+54 9 11 6585 1333', 'AR', MIN)).toBe(true);
    });
    it('a full search identifies a number stored without area code', () => {
        expect(phoneMatchesQuery('6585-1333', '11 6585 1333', 'AR', MIN)).toBe(true);
    });
    it('a different city with the same last digits is not revealed', () => {
        expect(phoneMatchesQuery('341 412-3456', '351 412-3456', 'AR', MIN)).toBe(false);
    });
    it('the beginning of a number does not reveal it', () => {
        expect(phoneMatchesQuery('1165851333', '116585', 'AR', MIN)).toBe(false);
    });
});

describe('phoneDuplicateTokens / samePhone', () => {
    it('a complete number also probes the local-only forms', () => {
        const values = phoneDuplicateTokens('11 6585 1333', 'AR').map(t => `${t.type}:${t.value}`);
        expect(values).toEqual(expect.arrayContaining(['phone:541165851333', 'phone_suffix:65851333', 'phone:65851333']));
    });
    it('samePhone agrees across formats and with a local-only number', () => {
        expect(samePhone('+54 9 11 6585-1333', '1165851333', 'AR')).toBe(true);
        expect(samePhone('6585 1333', '011 15 6585 1333', 'AR')).toBe(true);
        expect(samePhone('351 412-3456', '341 412-3456', 'AR')).toBe(false);
    });
});
