/**
 * createNotification's per-type kill switch on real SQL: no `NOTIF_ENABLED_<type>`
 * row sends with no warning (it used to log one for every notice: the type is
 * not a FEATURE_FLAGS key, so the flag read threw); an explicit 'false' stops it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/background', () => ({ runAfterResponse: async () => undefined }));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
}));

import { createNotification } from './notifications';
import { logger } from '@/lib/logger';

type Sqlite = { prepare: (s: string) => { get: (...a: unknown[]) => Record<string, unknown> | undefined; run: (...a: unknown[]) => unknown } };
let sqlite: Sqlite;

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as Sqlite;
    vi.mocked(logger.warn).mockClear();
});

const count = () => sqlite.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'member_joined'").get()!.n;
const send = () => createNotification({ userId: 'a@example.com', type: 'member_joined', title: 't', body: 'b' });

describe('createNotification — per-type kill switch', () => {
    it('no row: sent, and nothing is logged as a warning', async () => {
        expect(await send()).toEqual(expect.any(String));
        expect(count()).toBe(1);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it("an explicit 'false': not written", async () => {
        sqlite.prepare("INSERT INTO app_config (key, value) VALUES ('NOTIF_ENABLED_member_joined', 'false')").run();
        expect(await send()).toBeNull();
        expect(count()).toBe(0);
    });

    it("'true': sent", async () => {
        sqlite.prepare("INSERT INTO app_config (key, value) VALUES ('NOTIF_ENABLED_member_joined', 'true')").run();
        expect(await send()).toEqual(expect.any(String));
        expect(count()).toBe(1);
    });

    it('an unreadable switch fails open, logged', async () => {
        sqlite.prepare('DROP TABLE app_config').run();
        expect(await send()).toEqual(expect.any(String));
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('kill switch'), expect.objectContaining({ type: 'member_joined' }));
    });
});
