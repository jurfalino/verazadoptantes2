import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { session, getUser, OWNER } from '@/test-utils/actionMocks';

const { state, logs } = vi.hoisted(() => ({
    state: { db: null as unknown },
    logs: { warn: [] as Array<[string, Record<string, unknown>]>, error: [] as string[] },
}));
vi.mock('./_db', () => ({ getDb: async () => state.db, getUser }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/logger', () => ({
    logger: {
        warn: vi.fn((m: string, ctx: Record<string, unknown>) => { logs.warn.push([m, ctx]); }),
        info: vi.fn(), debug: vi.fn(),
        error: vi.fn((m: string) => { logs.error.push(m); return 'err12345'; }),
    },
    generateErrorId: () => 'gen12345',
}));

import { saveMyLocale } from './settings';
import { getLocaleForEmail } from '@/lib/emailPrefs';

type Sqlite = { prepare: (s: string) => { get: (...a: unknown[]) => Record<string, unknown> | undefined; run: (...a: unknown[]) => unknown } };
let sqlite: Sqlite;

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as Sqlite;
    session.user = OWNER;
    logs.warn.length = 0;
    logs.error.length = 0;
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
    it('the same value again: nothing is written (final review I4)', async () => {
        expect(await saveMyLocale('pt')).toEqual({ success: true });
        sqlite.prepare(`CREATE TRIGGER no_write BEFORE UPDATE ON user_profiles BEGIN SELECT RAISE(ABORT, 'written'); END`).run();
        expect(await saveMyLocale('pt')).toEqual({ success: true });
        expect(logs.error).toEqual([]);
    });

    it('a read-only "view as" session: refused, logged at warn (not error), with an errorId', async () => {
        const { ViewAsReadOnlyError } = await import('@/lib/readOnlyGuard');
        sqlite.prepare(`INSERT INTO user_profiles (user_id, locale) VALUES ('u1', 'es')`).run();
        const db = state.db as { insert: (...a: unknown[]) => unknown };
        const insert = db.insert;
        db.insert = () => { throw new ViewAsReadOnlyError(); };
        try {
            expect(await saveMyLocale('en')).toEqual({ success: false, errorId: 'gen12345' });
        } finally {
            db.insert = insert;
        }
        expect(logs.error).toEqual([]);
        expect(logs.warn).toContainEqual(['saveMyLocale: read-only ("view as") session, not saved', expect.objectContaining({ userEmail: OWNER, locale: 'en', errorId: 'gen12345' })]);
    });
});
