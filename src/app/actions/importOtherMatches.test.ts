/**
 * Spreadsheet import «También coincide con» for identical rows: the API's
 * exact-mode lookup (email / phone / document only; Jon 2026-11-01). Real SQL
 * and the real token index; the session is the only actor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { session, OWNER } = mocks;

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));

vi.mock('@/auth', () => ({ auth: vi.fn(async () => null) }));
vi.mock('./_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: (_op: string, fn: () => unknown) => fn(),
}));

import { findIdenticalRowsOtherMatches } from './importOtherMatches';
import { tokenizeAdopter } from '@/lib/adopterTokenize';
import { logger } from '@/lib/logger';

type Sqlite = { prepare: (s: string) => { run: (...a: unknown[]) => unknown } };
let sqliteRef: Sqlite;

beforeEach(async () => {
    const m = migratedDb();
    state.db = m.db;
    const sqlite = m.sqlite as unknown as Sqlite;
    sqliteRef = sqlite;
    session.user = OWNER;
    const insert = sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, country, created_at, updated_at, contact_entries, deleted_at) VALUES (?, ?, '5', ?, 'AR', 1000, 1000, ?, ?)`);
    const entries = (...e: Array<[string, string]>) => JSON.stringify(e.map(([type, value], i) => ({ id: `e${i}`, type, value })));
    // The identical profile, and others sharing one identifier each.
    insert.run('same', 'Ana Pérez', OWNER, entries(['phone', '+54 9 11 6585-1333'], ['email', 'ana@example.com']), null);
    insert.run('by-phone', 'Ana P. Gómez', OWNER, entries(['phone', '11 6585-1333']), null);
    insert.run('by-email', 'Otra Persona', OWNER, entries(['email', 'ANA@example.com']), null);
    insert.run('by-doc', 'Ana Doc', OWNER, entries(['id', '30.123.456']), null);
    // Same name, nothing in common: never «también coincide» (names don't count).
    insert.run('name-only', 'Ana Pérez', OWNER, entries(['phone', '+54 9 11 4000-2222']), null);
    // Shares the phone but was merged away: never listed.
    insert.run('gone', 'Ana Pérez', OWNER, entries(['phone', '+54 9 11 6585-1333']), 5000);
    for (const id of ['same', 'by-phone', 'by-email', 'by-doc', 'name-only', 'gone']) await tokenizeAdopter(id);
});

describe('findIdenticalRowsOtherMatches', () => {
    it('lists the other live profiles sharing an email, phone or document — never the identical one, never a name-only match, at most 2', async () => {
        const r = await findIdenticalRowsOtherMatches([{ key: 'fp1', identicalId: 'same', phones: ['11 6585-1333'], emails: ['ana@example.com'], ids: ['30123456'] }]);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const ids = r.others.fp1.map(m => m.adopterId);
        expect(ids).toHaveLength(2);
        for (const id of ids) expect(['by-phone', 'by-email', 'by-doc']).toContain(id);
        expect(ids).not.toContain('same');
        expect(ids).not.toContain('name-only');
        expect(ids).not.toContain('gone');
        expect(r.failed).toEqual([]);
    });

    it('each identifier on its own finds its profile, written differently', async () => {
        const r = await findIdenticalRowsOtherMatches([
            { key: 'p', identicalId: 'same', phones: ['+54 9 11 6585 1333'], emails: [], ids: [] },
            { key: 'e', identicalId: 'same', phones: [], emails: [' Ana@Example.com '], ids: [] },
            { key: 'd', identicalId: 'same', phones: [], emails: [], ids: ['30123456'] },
        ]);
        expect(r.ok && r.others.p.map(m => m.adopterId)).toEqual(['by-phone']);
        expect(r.ok && r.others.e.map(m => m.adopterId)).toEqual(['by-email']);
        expect(r.ok && r.others.d.map(m => m.adopterId)).toEqual(['by-doc']);
        expect(r.ok && r.others.p[0].matchTypes).toEqual(['phone']);
    });

    it('the profile matched on more identifiers comes first', async () => {
        const r = await findIdenticalRowsOtherMatches([{ key: 'fp', identicalId: 'none', phones: ['11 6585-1333'], emails: ['ana@example.com'], ids: [] }]);
        // «same» shares the phone AND the email; the others share one each.
        expect(r.ok && r.others.fp[0].adopterId).toBe('same');
        expect(r.ok && r.others.fp[0].matchTypes.sort()).toEqual(['email', 'phone']);
    });

    it('one call stays under its D1 query budget: rows that don\'t fit come back as deferred, never dropped', async () => {
        const rows = Array.from({ length: 50 }, (_, i) => ({
            key: `fp${i}`, identicalId: 'same',
            phones: [`11 4${String(i).padStart(3, '0')}-1111`, `11 5${String(i).padStart(3, '0')}-2222`, `11 6${String(i).padStart(3, '0')}-3333`],
            emails: [`x${i}@example.com`], ids: [],
        }));
        // drizzle on better-sqlite3 prepares once per query.
        const prepare = vi.spyOn(sqliteRef, 'prepare');
        const r = await findIdenticalRowsOtherMatches(rows);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.deferred.length).toBeGreaterThan(0);
        expect(Object.keys(r.others).length + r.deferred.length).toBe(50);
        expect(r.deferred.every(k => !(k in r.others))).toBe(true);
        expect(prepare.mock.calls.length).toBeLessThanOrEqual(400);
    });

    it('a row with no email, phone or document lists nothing', async () => {
        const r = await findIdenticalRowsOtherMatches([{ key: 'x', identicalId: 'same', phones: [], emails: [], ids: [] }]);
        expect(r).toEqual({ ok: true, others: { x: [] }, failed: [], deferred: [] });
    });

    it('needs a session', async () => {
        session.user = null;
        expect(await findIdenticalRowsOtherMatches([{ key: 'x', identicalId: 'same', phones: ['11 6585-1333'], emails: [], ids: [] }])).toEqual({ ok: false, errorId: 'unauth' });
    });

    it('never logs a contact value', async () => {
        await findIdenticalRowsOtherMatches([{ key: 'fp1', identicalId: 'same', phones: ['11 6585-1333'], emails: ['ana@example.com'], ids: [] }]);
        const logged = JSON.stringify([vi.mocked(logger.info).mock.calls, vi.mocked(logger.warn).mock.calls]);
        expect(logged).not.toContain('6585');
        expect(logged).not.toContain('ana@example.com');
    });
});
