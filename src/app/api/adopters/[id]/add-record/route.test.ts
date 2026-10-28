/**
 * «Agregar a este perfil» from the post import (ImportWizard → POST
 * /api/adopters/[id]/add-record) on a minor's profile (review of audit A3): a
 * minor gets no records — an expected rule, so the route answers 422
 * `profile_is_minor` (as the public API does, src/lib/api/records.ts), logged at
 * info, with no Error ID, and writes nothing. Real route, real SQL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

const { state, logs } = vi.hoisted(() => ({
    state: { db: null as unknown },
    logs: { info: [] as Array<[string, Record<string, unknown>]>, error: [] as string[] },
}));

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { email: 'rescuer@example.com', name: 'Rescuer' } })) }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: async () => 'rescuer@example.com' }));
vi.mock('@/lib/r2', () => ({ processImageForStorage: vi.fn(), uploadToR2: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async () => undefined) }));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn(async () => undefined) }));
vi.mock('@/lib/logger', () => ({
    logger: {
        warn: vi.fn(), debug: vi.fn(),
        info: vi.fn((m: string, ctx: Record<string, unknown>) => { logs.info.push([m, ctx]); }),
        error: vi.fn((m: string) => { logs.error.push(m); return 'err12345'; }),
    },
    generateErrorId: () => 'gen12345',
    withTrace: (_n: string, fn: () => unknown) => fn(),
}));

import { POST } from './route';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    logs.info.length = 0;
    logs.error.length = 0;
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, is_minor) VALUES ('lucas', 'Lucas Paez', '5', 'rescuer@example.com', 1), ('pedro', 'Pedro Paez', '5', 'rescuer@example.com', 0)`).run();
});

const post = (id: string) => POST(
    new Request(`http://localhost/api/adopters/${id}/add-record`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceUrl: 'https://facebook.com/posts/1', notes: 'Pedido de adopción', adoption: { recordType: 'observation', rating: 4 } }),
    }),
    { params: Promise.resolve({ id }) },
);
const records = (id: string) => sqlite.prepare('SELECT id FROM adoptions WHERE adopter_id = ?').all(id);

describe('POST /api/adopters/[id]/add-record — a minor\'s profile', () => {
    it('answers 422 profile_is_minor with no Error ID, logged at info, nothing written', async () => {
        const res = await post('lucas');
        expect(res.status).toBe(422);
        const body = await res.json() as Record<string, unknown>;
        expect(body).toMatchObject({ error: 'profile_is_minor', code: 'profile_is_minor' });
        expect(body).not.toHaveProperty('errorId');
        expect(logs.error).toEqual([]);
        expect(logs.info).toContainEqual([expect.stringContaining('minor'), expect.objectContaining({ adopterId: 'lucas', user: 'rescuer@example.com', recordType: 'observation' })]);
        expect(records('lucas')).toEqual([]);
    });

    it('an adult\'s profile still gets the record', async () => {
        const res = await post('pedro');
        expect(res.status).toBe(200);
        expect(records('pedro')).toHaveLength(1);
    });
});
