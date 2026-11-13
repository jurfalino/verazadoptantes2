/**
 * Migrations 0107 and 0108 read JSON columns that may hold malformed rows.
 * SQLite doesn't promise to evaluate `json_valid(x) AND json_extract(x, …)`
 * left to right, and json_extract / json_type raise on invalid JSON, so one
 * bad row could fail the migration. Every read must be
 * `CASE WHEN json_valid(x) THEN json_extract(x, …) END` (as in
 * src/lib/piiRequestNotices.ts).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migratedDb } from '@/test-utils/migratedDb';

const FILES = ['drizzle/0107_animals_scope.sql', 'drizzle/0108_pair_messages.sql'];
const read = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf8').replace(/--.*$/gm, '');
const statements = (f: string) => read(f).split(';').map(s => s.trim()).filter(Boolean);

describe('migrations 0107 / 0108: malformed JSON', () => {
    it.each(FILES)('%s: every json_extract / json_type sits inside CASE WHEN json_valid(same column) THEN', (f) => {
        const sql = read(f);
        const calls = [...sql.matchAll(/json_(?:extract|type)\(\s*([\w.]+)/g)];
        expect(calls.length).toBeGreaterThan(0);
        for (const m of calls) {
            const before = sql.slice(0, m.index).replace(/\s+/g, ' ');
            const col = m[1].replace('.', '\\.');
            expect(before, `${f}: ${sql.slice(m.index, m.index! + 50)}`).toMatch(new RegExp(`CASE WHEN json_valid\\(${col}\\) THEN $`));
        }
    });

    it('both run on a DB holding malformed rows, without error, and still copy the valid ones', () => {
        const { sqlite } = migratedDb();
        sqlite.prepare(`INSERT INTO user (id, email) VALUES ('u1', 'ana@example.com'), ('u2', 'bea@example.com')`).run();
        sqlite.prepare(`INSERT INTO user_profiles (user_id, followup_settings) VALUES ('u1', '{broken'), ('u2', '{"version":1,"onlyMyAnimals":true}')`).run();
        sqlite.exec(`UPDATE user_profiles SET animals_scope = NULL`);
        sqlite.exec(`DELETE FROM pair_messages`);
        const insert = sqlite.prepare(`INSERT INTO notifications (id, user_id, type, title, body, metadata, created_at) VALUES (?, ?, 'pair_message', 't', ?, ?, ?)`);
        insert.run('n-bad', 'bea@example.com', 'hola', '{broken', 1000);
        insert.run('n-bad2', 'cal@example.com', 'hola', 'not json at all', 1001);
        insert.run('n-ok', 'bea@example.com', 'hola', JSON.stringify({ requestId: 'r1', replyTo: 'Ana@Example.com', fromName: 'Ana' }), 1002);

        for (const f of FILES) {
            for (const stmt of statements(f)) {
                if (stmt.startsWith('ALTER TABLE')) continue; // the column is already there (migratedDb)
                expect(() => sqlite.exec(stmt + ';'), `${f}: ${stmt.slice(0, 60)}`).not.toThrow();
            }
        }
        expect(sqlite.prepare(`SELECT user_id, animals_scope FROM user_profiles ORDER BY user_id`).all())
            .toEqual([{ user_id: 'u1', animals_scope: null }, { user_id: 'u2', animals_scope: 'mine' }]);
        expect(sqlite.prepare(`SELECT id, request_id, sender_email, body FROM pair_messages`).all())
            .toEqual([{ id: 'pm-n-ok', request_id: 'r1', sender_email: 'ana@example.com', body: 'hola' }]);
    });
});
