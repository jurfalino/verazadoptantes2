/**
 * searchFormDuplicates' gate and failure log (final review M2, M3). Retrieval and
 * hydration are mocked: what is tested is whether it searches, and what a failure logs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({ getDb: async () => ({}) }));
vi.mock('@/lib/identityMatch', () => ({ findPersonMatches: vi.fn(async () => []) }));
vi.mock('@/app/actions/hydrateDuplicateMatches', () => ({ hydrateDuplicateMatches: vi.fn(async () => []) }));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
}));

import { findPersonMatches } from '@/lib/identityMatch';
import { hydrateDuplicateMatches } from '@/app/actions/hydrateDuplicateMatches';
import { logger } from '@/lib/logger';
import { searchFormDuplicates } from './formDuplicates';

const viewer = async () => 'rescuer@example.com';

beforeEach(() => vi.clearAllMocks());

describe('searchFormDuplicates: who it looks for', () => {
    it('«Agregar conviviente» with only a DNI searches (contact-only allowed)', async () => {
        await searchFormDuplicates({ name: '', documentIds: ['30.123.456'] }, { allowContactOnly: true }, viewer);
        expect(findPersonMatches).toHaveBeenCalledTimes(1);
        expect(vi.mocked(findPersonMatches).mock.calls[0][1]).toMatchObject({ name: '', documentIds: ['30.123.456'] });
    });

    it('a blank DNI is no contact', async () => {
        await searchFormDuplicates({ name: '', documentIds: ['  '] }, { allowContactOnly: true }, viewer);
        expect(findPersonMatches).not.toHaveBeenCalled();
    });

    it('the browser form (no contact-only) still needs a name, even with a DNI', async () => {
        await searchFormDuplicates({ name: '', documentIds: ['30123456'] }, {}, viewer);
        expect(findPersonMatches).not.toHaveBeenCalled();
    });
});

describe('searchFormDuplicates: what the rescuer typed shows in full on a match (2026-11-04)', () => {
    it('every typed contact is handed to the hydrator as revealValues', async () => {
        vi.mocked(findPersonMatches).mockResolvedValueOnce([{ adopterId: 'a1' }] as never);
        await searchFormDuplicates({ name: 'Ana Pérez', phones: ['1144387944'], emails: ['ana@example.com'], socials: ['@ana'], documentIds: ['30123456'] }, {}, viewer);
        expect(vi.mocked(hydrateDuplicateMatches).mock.calls[0][2]).toMatchObject({
            revealValues: ['1144387944', 'ana@example.com', '@ana', '30123456'],
        });
    });
});

describe('searchFormDuplicates: a failure', () => {
    it('logs actor, counts and the redacted error — never the bound contact values', async () => {
        vi.mocked(findPersonMatches).mockRejectedValueOnce(new Error('Failed query: select … where token_value = ?\nparams: 1165851333,ana@example.com'));
        const r = await searchFormDuplicates(
            { name: 'Ana Pérez', phones: ['11 6585-1333'], emails: ['ana@example.com'], documentIds: ['30123456'], excludeAdopterId: 'a1' },
            {}, viewer,
        );
        expect(r).toEqual({ results: [], failed: true });
        const [msg, fields] = vi.mocked(logger.warn).mock.calls[0];
        expect(msg).toMatch(/findFormDuplicates failed/);
        expect(fields).toMatchObject({ actor: 'rescuer@example.com', excludesProfile: true, phones: 1, emails: 1, socials: 0, documentIds: 1, errorName: 'Error' });
        const logged = JSON.stringify(vi.mocked(logger.warn).mock.calls);
        expect(logged).not.toMatch(/65851333|ana@example|30123456|Ana P/);
    });
});
