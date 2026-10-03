import { describe, it, expect, vi } from 'vitest';

vi.mock('@cloudflare/next-on-pages', () => ({ getRequestContext: () => { throw new Error('no context'); } }));

import { guardD1, ViewAsReadOnlyError } from './readOnlyGuard';

function fakeD1() {
    const ran: string[] = [];
    const stmt = (sql: string) => {
        const s = {
            sql,
            bind: () => s,
            run: async () => { ran.push(sql); return { success: true }; },
            all: async () => { ran.push(sql); return { results: [] }; },
            first: async () => { ran.push(sql); return null; },
            raw: async () => { ran.push(sql); return []; },
        };
        return s;
    };
    const d1 = {
        prepare: (sql: string) => stmt(sql),
        batch: async (stmts: { sql: string }[]) => { stmts.forEach(s => ran.push(s.sql)); return []; },
        exec: async (sql: string) => { ran.push(sql); return { count: 1 }; },
    };
    return { d1: d1 as unknown as D1Database, ran };
}

describe('guardD1', () => {
    it('passes everything through when the request is not read-only', async () => {
        const { d1, ran } = fakeD1();
        const db = guardD1(d1, () => false);
        await db.prepare('INSERT INTO t VALUES (?)').bind(1).run();
        await db.exec('DELETE FROM t');
        expect(ran).toEqual(['INSERT INTO t VALUES (?)', 'DELETE FROM t']);
    });

    it('lets reads through while read-only', async () => {
        const { d1, ran } = fakeD1();
        const db = guardD1(d1, () => true);
        await db.prepare('SELECT * FROM t WHERE id = ?').bind(1).all();
        expect(ran).toEqual(['SELECT * FROM t WHERE id = ?']);
    });

    it('refuses writes while read-only — asynchronously, so .catch() chains still see it', async () => {
        const { d1, ran } = fakeD1();
        const db = guardD1(d1, () => true);
        const stmt = db.prepare('UPDATE user_profiles SET country = ?');
        await expect(stmt.bind('AR').run()).rejects.toBeInstanceOf(ViewAsReadOnlyError);
        await expect(db.prepare('DELETE FROM t').first()).rejects.toBeInstanceOf(ViewAsReadOnlyError);
        const fallback = await db.prepare('INSERT INTO t VALUES (1)').run().catch(() => 'caught');
        expect(fallback).toBe('caught');
        expect(ran).toEqual([]);
    });

    it('refuses a batch holding any write, and exec entirely', async () => {
        const { d1, ran } = fakeD1();
        const db = guardD1(d1, () => true);
        await expect(db.batch([db.prepare('SELECT 1'), db.prepare('INSERT INTO t VALUES (1)')])).rejects.toBeInstanceOf(ViewAsReadOnlyError);
        await expect(db.exec('SELECT 1')).rejects.toBeInstanceOf(ViewAsReadOnlyError);
        await db.batch([db.prepare('SELECT 1')]);
        expect(ran).toEqual(['SELECT 1']);
    });

    it('decides per statement, so a request that stops viewing can write again', async () => {
        const { d1, ran } = fakeD1();
        let readOnly = true;
        const db = guardD1(d1, () => readOnly);
        await expect(db.prepare('INSERT INTO t VALUES (1)').run()).rejects.toBeInstanceOf(ViewAsReadOnlyError);
        readOnly = false;
        await db.prepare('INSERT INTO t VALUES (2)').run();
        expect(ran).toEqual(['INSERT INTO t VALUES (2)']);
    });
});
