/**
 * Notifications cleanup, Phase 1 (change 3): «Intento de login bloqueado» goes
 * through createNotification like every other notice — a template rendered in
 * the reader's language, the per-type NOTIF_ENABLED_adopter_login_blocked kill
 * switch — and it is never emailed (an admin-queue item: the bell only). Same
 * recipients (every admin: the bootstrap list plus DB role=admin), link and
 * content as before. Real SQL; the email twin is the real one, spied.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/background', () => ({ runAfterResponse: async (_l: string, fn: () => Promise<unknown>) => { await fn(); } }));
vi.mock('@/lib/notificationEmail', async (orig) => {
    const real = await orig<typeof import('@/lib/notificationEmail')>();
    return { ...real, sendNotificationEmail: vi.fn(real.sendNotificationEmail) };
});
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
}));

import { recordBlockedLogin } from './blockedLoginRecorder';
import { BOOTSTRAP_ADMIN_EMAILS } from '@/config/admins';
import { sendNotificationEmail } from '@/lib/notificationEmail';
import { localizedNotification } from '@/domain/notificationTemplates';
import { logger } from '@/lib/logger';
import type { GateResult } from '@/lib/adopterLoginGate';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };

const DB_ADMIN = 'db-admin@example.com';
const BLOCKED = 'blocked@example.com';
const gate: GateResult = {
    blocked: true,
    reason: 'low_rating',
    matches: [
        { adopterId: 'p-quiet', adopterName: 'Otro', avgRating: 3, tooManyAdoptions: false, tooManyRequests: false, addedBy: null, lastChangedBy: [], triggers: [] },
        { adopterId: 'p1', adopterName: 'Pedro Paez', avgRating: 1, tooManyAdoptions: false, tooManyRequests: false, addedBy: 'owner@example.com', lastChangedBy: [], triggers: ['low_rating'] },
    ],
};
const notices = () => sqlite.prepare("SELECT user_id, type, title, body, url, metadata FROM notifications WHERE type = 'adopter_login_blocked' ORDER BY user_id").all();
const admins = () => [...new Set([...BOOTSTRAP_ADMIN_EMAILS, DB_ADMIN])].sort();

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    vi.mocked(sendNotificationEmail).mockClear();
    vi.mocked(logger.warn).mockClear();
    sqlite.prepare(`INSERT INTO user (id, email, name) VALUES ('u-admin', ?, 'Ada Admin'), ('u-viewer', 'viewer@example.com', 'Vera')`).run(DB_ADMIN);
    sqlite.prepare(`INSERT INTO user_profiles (user_id, role) VALUES ('u-admin', 'admin'), ('u-viewer', 'viewer')`).run();
});

describe('recordBlockedLogin — the admins\' notice', () => {
    it('one notice per admin (bootstrap + DB role=admin), the same link and Spanish text as before', async () => {
        await recordBlockedLogin(BLOCKED, gate);
        const rows = notices();
        expect(rows.map(r => r.user_id)).toEqual(admins());
        for (const r of rows) {
            expect(r).toMatchObject({
                type: 'adopter_login_blocked', url: '/adopter/p1',
                title: `Intento de login bloqueado: ${BLOCKED}`,
                body: 'Coincide con perfil: Pedro Paez. Motivo: low_rating',
            });
            expect(JSON.parse(r.metadata as string)).toMatchObject({ email: BLOCKED, matchedAdopterIds: ['p-quiet', 'p1'], reason: 'low_rating' });
        }
        // The audit trail is still written.
        expect(sqlite.prepare('SELECT email, reason FROM blocked_logins').all()).toEqual([{ email: BLOCKED, reason: 'low_rating' }]);
    });

    it('reads in the reader\'s language', async () => {
        await recordBlockedLogin(BLOCKED, gate);
        const r = notices()[0] as { title: string; body: string; metadata: string };
        expect(localizedNotification(r, 'en')).toEqual({ title: `Blocked sign-in attempt: ${BLOCKED}`, body: 'Matches profile: Pedro Paez. Reason: low_rating' });
        expect(localizedNotification(r, 'pt')).toEqual({ title: `Tentativa de login bloqueada: ${BLOCKED}`, body: 'Coincide com o perfil: Pedro Paez. Motivo: low_rating' });
    });

    it('no match: the blocked-logins page, the reason only; an unnamed match shows its id', async () => {
        await recordBlockedLogin(BLOCKED, { ...gate, matches: [] });
        expect(notices()[0]).toMatchObject({ url: '/admin/blocked-logins', body: 'Motivo: low_rating' });
        sqlite.prepare('DELETE FROM notifications').run();
        await recordBlockedLogin(BLOCKED, { ...gate, matches: [{ ...gate.matches[1], adopterName: '' }] });
        expect(notices()[0]).toMatchObject({ url: '/adopter/p1', body: 'Coincide con perfil: p1. Motivo: low_rating' });
    });

    it('never emailed: the email twin skips it as admin-only', async () => {
        await recordBlockedLogin(BLOCKED, gate);
        const calls = vi.mocked(sendNotificationEmail).mock.results;
        expect(calls).toHaveLength(admins().length);
        expect(await Promise.all(calls.map(c => c.value))).toEqual(admins().map(() => 'skipped_admin_only'));
        expect(sqlite.prepare("SELECT COUNT(*) AS n FROM notifications WHERE emailed_at IS NOT NULL").get()!.n).toBe(0);
    });

    it('the per-type kill switch applies: no notice, the audit row still written', async () => {
        // The admin page's per-type switch writes this row (the real feature-flag read, no mock).
        sqlite.prepare(`INSERT INTO app_config (key, value) VALUES ('NOTIF_ENABLED_adopter_login_blocked', 'false')`).run();
        // One recipient (the bootstrap admin): the switch is read through lazy imports, and two
        // notices created at once under vitest can race the first lazy import of the mocked
        // getDb and read the real one — a test-runner artifact, not the app's behaviour.
        sqlite.prepare(`DELETE FROM user_profiles WHERE role = 'admin'`).run();
        await recordBlockedLogin(BLOCKED, gate);
        expect(notices()).toEqual([]);
        expect(sqlite.prepare('SELECT COUNT(*) AS n FROM blocked_logins').get()!.n).toBe(1);
    });

    it('the DB admin lookup failing is logged; the bootstrap admins are still told', async () => {
        sqlite.prepare('DROP TABLE user_profiles').run();
        await recordBlockedLogin(BLOCKED, gate);
        expect(notices().map(r => r.user_id)).toEqual([...BOOTSTRAP_ADMIN_EMAILS].sort());
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('DB admins'), expect.objectContaining({ email: BLOCKED }));
    });

    it('never throws into sign-in: the notices failing still resolves, the audit row stands', async () => {
        sqlite.prepare('DROP TABLE notifications').run();
        await expect(recordBlockedLogin(BLOCKED, gate)).resolves.toBeUndefined();
        expect(sqlite.prepare('SELECT COUNT(*) AS n FROM blocked_logins').get()!.n).toBe(1);
    });
});
