/**
 * drizzle/0078_placements_one_active.sql: closes duplicate active placements
 * (keeping the newest per animal) and then forbids them with a unique partial
 * index. Run against the real schema.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migratedDb } from '@/test-utils/migratedDb';

const MIGRATION = readFileSync(resolve(process.cwd(), 'drizzle/0078_placements_one_active.sql'), 'utf8');

type Row = Record<string, unknown>;
type Sqlite = { exec: (s: string) => void; prepare: (s: string) => { all: (...a: unknown[]) => Row[]; run: (...a: unknown[]) => unknown } };

function withDuplicates(): Sqlite {
    const { sqlite } = migratedDb() as unknown as { sqlite: Sqlite };
    // The state before the migration: no index, duplicates present.
    sqlite.exec('DROP INDEX IF EXISTS idx_placements_one_active');
    sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at, created_at) VALUES
        ('dupA','an-x','a1','adoption',100,100), ('dupB','an-x','a2','foster',200,150), ('dupC','an-x','a3','adoption',NULL,300),
        ('dupD','an-y','a1','adoption',50,50), ('dupE','an-y','a2','adoption',50,50),
        ('solo','an-z','a1','adoption',10,10),
        ('old','an-x','a9','foster',5,5)`).run();
    sqlite.prepare(`UPDATE placements SET ended_at = 7 WHERE id = 'old'`).run();
    return sqlite;
}

const rows = (s: Sqlite) => Object.fromEntries(s.prepare(`SELECT id, ended_at FROM placements WHERE animal_id IN ('an-x','an-y','an-z')`).all().map(r => [r.id, r.ended_at]));

describe('0078 — one active placement per animal', () => {
    it('keeps the newest active placement per animal and ends the rest at its start', () => {
        const s = withDuplicates();
        s.exec(MIGRATION);
        const r = rows(s);
        // an-x: dupB has the highest started_at (dupC's is NULL → lowest).
        expect(r.dupB).toBeNull();
        expect(r.dupA).toBe(200);
        expect(r.dupC).toBe(200);
        // an-y: tie on started_at and created_at → the higher id stays.
        expect(r.dupE).toBeNull();
        expect(r.dupD).toBe(50);
        // Untouched: a lone active placement and an already-ended one.
        expect(r.solo).toBeNull();
        expect(r.old).toBe(7);
    });

    it('is idempotent', () => {
        const s = withDuplicates();
        s.exec(MIGRATION);
        const first = rows(s);
        s.exec(MIGRATION);
        expect(rows(s)).toEqual(first);
    });

    it('afterwards a second active placement for the same animal is refused, an ended one is fine', () => {
        const s = withDuplicates();
        s.exec(MIGRATION);
        expect(() => s.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type) VALUES ('dupF','an-x','a4','adoption')`).run()).toThrow(/UNIQUE/);
        expect(() => s.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, ended_at) VALUES ('dupG','an-x','a4','adoption', 1)`).run()).not.toThrow();
    });

    it('the test schema (migratedDb) carries the index', () => {
        const { sqlite } = migratedDb() as unknown as { sqlite: Sqlite };
        const idx = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_placements_one_active'`).all();
        expect(idx.length).toBe(1);
    });
});
