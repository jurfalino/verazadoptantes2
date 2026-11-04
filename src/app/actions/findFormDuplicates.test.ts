/**
 * findFormDuplicates (browser-callable): the browser's `limit` is clamped (final review M6),
 * and the contact-only option is never passed through.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./_db', () => ({ getUser: vi.fn(async () => 'rescuer@example.com') }));
vi.mock('@/lib/formDuplicates', () => ({ searchFormDuplicates: vi.fn(async () => ({ results: [] })) }));

import { searchFormDuplicates } from '@/lib/formDuplicates';
import { findFormDuplicates } from './findFormDuplicates';

const limitPassed = () => vi.mocked(searchFormDuplicates).mock.calls[0][1].limit;

beforeEach(() => vi.clearAllMocks());

describe('findFormDuplicates limit', () => {
    it.each([
        [5, 5], [10, 10], [1000, 10], [0, 1], [-3, 1], [2.7, 2], ['7', 7],
    ])('limit %p → %p', async (given, expected) => {
        await findFormDuplicates({ name: 'Ana Pérez' }, { limit: given as number });
        expect(limitPassed()).toBe(expected);
    });

    it.each([[undefined], [NaN], ['muchos'], [Infinity]])('limit %p → the default (none passed)', async (given) => {
        await findFormDuplicates({ name: 'Ana Pérez' }, { limit: given as number });
        expect(limitPassed()).toBeUndefined();
    });

    it('each contact list is cut to 20 strings: no guessing many values in one call (review 2026-11-04)', async () => {
        const many = Array.from({ length: 25 }, (_, i) => `11443879${String(i).padStart(2, '0')}`);
        await findFormDuplicates({ name: 'Ana Pérez', phones: [...many, 7 as never], emails: many }, {});
        const passed = vi.mocked(searchFormDuplicates).mock.calls[0][0];
        expect(passed.phones).toHaveLength(20);
        expect(passed.emails).toHaveLength(20);
        expect(passed.socials).toBeUndefined();
    });

    it('never passes allowContactOnly, whatever the browser sends', async () => {
        await findFormDuplicates({ name: '' }, { limit: 3, allowContactOnly: true } as never);
        expect(vi.mocked(searchFormDuplicates).mock.calls[0][1]).not.toHaveProperty('allowContactOnly');
    });
});
