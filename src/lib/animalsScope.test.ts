/**
 * «Formularios, contratos y controles de:» on real SQL: the read, the write,
 * and migration 0107's backfill from «Recordarme solo los animales que cargué yo».
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migratedDb } from '@/test-utils/migratedDb';
import { getAnimalsScopeForEmail, setAnimalsScopeForEmail } from './animalsScope';

type Sqlite = { prepare: (s: string) => { get: (...a: unknown[]) => Record<string, unknown> | undefined; run: (...a: unknown[]) => unknown }; exec: (s: string) => void };
let sqlite: Sqlite;
let db: ReturnType<typeof migratedDb>['db'];

beforeEach(() => {
    const m = migratedDb();
    db = m.db;
    sqlite = m.sqlite as unknown as Sqlite;
    sqlite.prepare(`INSERT INTO user (id, email) VALUES ('u1', 'Ana@Example.com'), ('u2', 'bea@example.com'), ('u3', 'cal@example.com'), ('u4', 'dan@example.com')`).run();
});

describe('animals scope', () => {
    it('no profile row: the whole team', async () => {
        expect(await getAnimalsScopeForEmail(db as never, 'ana@example.com')).toBe('team');
    });

    it('writes and reads back (case-insensitive email), keeping the rest of the row', async () => {
        sqlite.prepare(`INSERT INTO user_profiles (user_id, email_prefs) VALUES ('u1', '{"group":true}')`).run();
        await setAnimalsScopeForEmail(db as never, 'ana@example.com', 'mine');
        expect(await getAnimalsScopeForEmail(db as never, 'ANA@example.com')).toBe('mine');
        expect(sqlite.prepare(`SELECT email_prefs AS p FROM user_profiles WHERE user_id = 'u1'`).get()!.p).toBe('{"group":true}');
        await setAnimalsScopeForEmail(db as never, 'ana@example.com', 'team');
        expect(await getAnimalsScopeForEmail(db as never, 'ana@example.com')).toBe('team');
    });

    it('no user row: the write throws', async () => {
        await expect(setAnimalsScopeForEmail(db as never, 'nobody@example.com', 'mine')).rejects.toThrow('No user row');
    });

    it('migration 0107: «solo los animales que cargué yo» on -> «Mis animales»; nothing else changes; the backfill UPDATE is re-runnable (the ALTER is not)', async () => {
        const insert = sqlite.prepare(`INSERT INTO user_profiles (user_id, followup_settings, animals_scope) VALUES (?, ?, ?)`);
        insert.run('u1', '{"version":1,"onlyMyAnimals":true}', null);
        insert.run('u2', '{"version":1,"emailReminders":true}', null);
        insert.run('u3', '{broken', null);
        insert.run('u4', '{"version":1,"onlyMyAnimals":true}', 'team'); // chose since: kept
        const sql = readFileSync(resolve(process.cwd(), 'drizzle/0107_animals_scope.sql'), 'utf8').replace(/--.*$/gm, '');
        const update = sql.split(';').map(s => s.trim()).find(s => s.startsWith('UPDATE'))!;
        sqlite.exec(update);
        sqlite.exec(update);
        expect(await getAnimalsScopeForEmail(db as never, 'ana@example.com')).toBe('mine');
        expect(await getAnimalsScopeForEmail(db as never, 'bea@example.com')).toBe('team');
        expect(await getAnimalsScopeForEmail(db as never, 'cal@example.com')).toBe('team');
        expect(await getAnimalsScopeForEmail(db as never, 'dan@example.com')).toBe('team');
    });
});
