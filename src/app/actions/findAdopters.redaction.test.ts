/**
 * The engine's failure logs never carry the contact values a query was bound to
 * (final review M3): Drizzle ends a failed query's message with "params: <values>".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));

vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: async () => 'rescuer@example.com' }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: {} }) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async () => undefined) }));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: vi.fn((_op: string, fn: () => unknown) => fn()),
}));

import { findAdopters } from './findAdopters';
import { logger, withTrace } from '@/lib/logger';

beforeEach(() => {
    vi.clearAllMocks();
    const m = migratedDb();
    state.db = m.db;
    // Every token-index read fails the way D1 reports it: the message ends with the bound values.
    const sqlite = m.sqlite as unknown as { prepare: (q: string) => unknown };
    const real = sqlite.prepare.bind(sqlite);
    vi.spyOn(sqlite, 'prepare').mockImplementation((q: string) => {
        if (/"duplicate_tokens"/.test(q)) throw new Error(`Failed query: ${q}\nparams: 5491165851333,ana.perez@example.com,30123456`);
        return real(q);
    });
});

describe('findAdopters failure logs', () => {
    it('«token lookup degraded» logs the redacted error, no phone, email or DNI', async () => {
        await findAdopters(
            { name: 'Ana Pérez', phones: ['+54 9 11 6585 1333'], emails: ['ana.perez@example.com'], ids: ['30123456'] },
            { mode: 'duplicate', skipLikeFallback: true },
        );
        const degraded = vi.mocked(logger.warn).mock.calls.filter(c => c[0] === 'findAdopters: token lookup degraded');
        expect(degraded.length).toBeGreaterThan(0);
        expect(degraded[0][1]).toMatchObject({ tokenType: expect.any(String), error: expect.stringMatching(/Failed query/), errorName: expect.any(String) });
        expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toMatch(/65851333|ana\.perez|30123456/);
    });

    it('«findAdopters failed» logs a redacted error and keeps its errorId', async () => {
        vi.mocked(withTrace).mockImplementationOnce(() => { throw new Error('Failed query: select … where token_value = ?\nparams: 5491165851333,ana.perez@example.com'); });
        await expect(findAdopters({ name: 'Ana Pérez', phones: ['11 6585-1333'] }, { mode: 'duplicate' })).rejects.toThrow('findAdopters failed (ID: err12345)');
        const [msg, err] = vi.mocked(logger.error).mock.calls[0];
        expect(msg).toBe('findAdopters failed');
        expect((err as Error).message).toMatch(/^Failed query/);
        expect(JSON.stringify([(err as Error).message, (err as Error).stack])).not.toMatch(/65851333|ana\.perez/);
    });
});
