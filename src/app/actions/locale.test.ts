import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { session, getUser, OWNER } from '@/test-utils/actionMocks';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));
vi.mock('./_db', () => ({ getDb: async () => state.db, getUser }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

import { saveMyLocale } from './settings';
import { getLocaleForEmail } from '@/lib/emailPrefs';

type Sqlite = { prepare: (s: string) => { get: (...a: unknown[]) => Record<string, unknown> | undefined; run: (...a: unknown[]) => unknown } };
let sqlite: Sqlite;

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as Sqlite;
    session.user = OWNER;
    sqlite.prepare(`INSERT INTO user (id, email) VALUES ('u1', ?)`).run(OWNER);
});

describe('locale persistence', () => {
    it('no profile row: es', async () => {
        expect(await getLocaleForEmail(state.db as never, OWNER)).toBe('es');
    });

    it('saves a locale and reads it back, case-insensitively', async () => {
        expect(await saveMyLocale('pt')).toEqual({ success: true });
        expect(await getLocaleForEmail(state.db as never, OWNER.toUpperCase())).toBe('pt');
        expect((await saveMyLocale('en')).success).toBe(true);
        expect(await getLocaleForEmail(state.db as never, OWNER)).toBe('en');
    });

    it('refuses an unknown value and stores nothing', async () => {
        const r = await saveMyLocale('fr' as never);
        expect(r.success).toBe(false);
        expect(r.errorId).toBeTruthy();
        expect(await getLocaleForEmail(state.db as never, OWNER)).toBe('es');
    });

    it('signed out: refused', async () => {
        session.user = null;
        expect((await saveMyLocale('pt')).success).toBe(false);
    });

    it('an unknown stored value reads as es', async () => {
        sqlite.prepare(`INSERT INTO user_profiles (user_id, locale) VALUES ('u1', 'xx')`).run();
        expect(await getLocaleForEmail(state.db as never, OWNER)).toBe('es');
    });
});
