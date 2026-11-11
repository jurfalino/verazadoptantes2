/**
 * The Worker deploys on its own workflow, so it can run before migration 0107
 * adds user_profiles.animals_scope. Its settings read must not depend on it.
 * Real SQL (better-sqlite3 behind a D1-shaped shim).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readRecipientSettings, type FirstRowDb } from './recipientSettings';

let sqlite: Database.Database;

function d1(s: Database.Database): FirstRowDb {
    return {
        prepare: (query: string) => ({
            bind: (...values: unknown[]) => ({
                first: async <T,>() => (s.prepare(query).get(...values) as T | undefined) ?? null,
            }),
        }),
    };
}

const SETTINGS = JSON.stringify({ version: 1, emailReminders: true, disabledKeys: ['adoption_day_7'] });

beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT)`);
    // Before 0107: no animals_scope column.
    sqlite.exec(`CREATE TABLE user_profiles (user_id TEXT PRIMARY KEY, followup_settings TEXT)`);
    sqlite.prepare(`INSERT INTO user (id, email) VALUES ('u1', 'ana@example.com')`).run();
    sqlite.prepare(`INSERT INTO user_profiles (user_id, followup_settings) VALUES ('u1', ?)`).run(SETTINGS);
});

describe('readRecipientSettings', () => {
    it('before 0107 (no animals_scope): the settings still apply, the scope is the whole team, logged', async () => {
        const warn = vi.fn();
        const r = await readRecipientSettings(d1(sqlite), 'ana@example.com', warn);
        expect(r.id).toBe('u1');
        expect(r.settings?.emailReminders).toBe(true);
        expect(r.settings?.disabledKeys).toEqual(['adoption_day_7']);
        expect(r.scope).toBe('team');
        expect(warn).toHaveBeenCalledWith(expect.objectContaining({ warn: expect.stringContaining('animals scope'), email: 'ana@example.com' }));
        expect(warn).not.toHaveBeenCalledWith(expect.objectContaining({ warn: 'settings fallback' }));
    });

    it('after 0107: reads the scope', async () => {
        sqlite.exec(`ALTER TABLE user_profiles ADD COLUMN animals_scope TEXT`);
        sqlite.exec(`UPDATE user_profiles SET animals_scope = 'mine'`);
        const warn = vi.fn();
        const r = await readRecipientSettings(d1(sqlite), 'ana@example.com', warn);
        expect(r).toMatchObject({ id: 'u1', scope: 'mine' });
        expect(r.settings?.emailReminders).toBe(true);
        expect(warn).not.toHaveBeenCalled();
    });

    it('no profile row: defaults, no warning', async () => {
        sqlite.exec(`ALTER TABLE user_profiles ADD COLUMN animals_scope TEXT`);
        sqlite.prepare(`INSERT INTO user (id, email) VALUES ('u2', 'bea@example.com')`).run();
        const warn = vi.fn();
        expect(await readRecipientSettings(d1(sqlite), 'bea@example.com', warn)).toEqual({ id: 'u2', settings: null, scope: 'team' });
        expect(warn).not.toHaveBeenCalled();
    });

    it('the settings read fails: no settings (defaults), logged', async () => {
        sqlite.exec(`DROP TABLE user_profiles`);
        const warn = vi.fn();
        const r = await readRecipientSettings(d1(sqlite), 'ana@example.com', warn);
        expect(r.settings).toBeNull();
        expect(r.scope).toBe('team');
        expect(warn).toHaveBeenCalledWith(expect.objectContaining({ warn: 'settings fallback', email: 'ana@example.com' }));
    });
});
