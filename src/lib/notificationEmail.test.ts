import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

const { state, send } = vi.hoisted(() => ({
    state: { db: null as unknown },
    send: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/email', async (orig) => ({ ...(await orig<typeof import('@/lib/email')>()), sendEmailViaResend: send }));

import { sendNotificationEmail } from './notificationEmail';
import { buildNotificationEmail } from './email';

type Sqlite = { prepare: (s: string) => { get: (...a: unknown[]) => Record<string, unknown> | undefined; run: (...a: unknown[]) => unknown } };
let sqlite: Sqlite;
const EMAIL = 'rescuer@example.com';
let seq = 0;

function addNotif(type: string): string {
    const id = `n${++seq}`;
    sqlite.prepare(`INSERT INTO notifications (id, user_id, type, title, body, created_at) VALUES (?, ?, ?, 'T', 'B', 1000)`).run(id, EMAIL, type);
    return id;
}
const emailedAt = (id: string) => sqlite.prepare('SELECT emailed_at AS e FROM notifications WHERE id = ?').get(id)?.e ?? null;
const call = (id: string, type: string) => sendNotificationEmail({ id, userId: EMAIL, type, title: 'T', body: 'B', url: '/x' });

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as Sqlite;
    send.mockReset();
    send.mockResolvedValue({ ok: true });
    vi.stubEnv('RESEND_API_KEY', 'key');
    vi.stubEnv('AUTH_SECRET', 'test-secret');
    // A registered recipient (no user_profiles row yet: every switch on).
    sqlite.prepare(`INSERT INTO user (id, email) VALUES ('u1', ?)`).run(EMAIL);
});
afterEach(() => vi.unstubAllEnvs());

function seedUser(prefs: string | null) {
    sqlite.prepare(`INSERT INTO user_profiles (user_id, email_prefs) VALUES ('u1', ?)`).run(prefs);
}

describe('sendNotificationEmail', () => {
    it('forms:false -> skipped_pref, nothing sent', async () => {
        seedUser(JSON.stringify({ forms: false }));
        expect(await call(addNotif('form_submission'), 'form_submission')).toBe('skipped_pref');
        expect(send).not.toHaveBeenCalled();
    });
    it('requests stays on even with {requests:false} stored', async () => {
        seedUser(JSON.stringify({ requests: false }));
        const id = addNotif('pii_access_request');
        expect(await call(id, 'pii_access_request')).toBe('sent');
        expect(emailedAt(id)).not.toBeNull();
    });
    it('second same-category notification within 10 min is throttled; other category is not', async () => {
        const a = addNotif('form_submission');
        const b = addNotif('form_submission');
        expect(await call(a, 'form_submission')).toBe('sent');
        expect(await call(b, 'form_submission')).toBe('skipped_throttle');
        expect(await call(addNotif('merge_request'), 'merge_request')).toBe('sent');
        expect(send).toHaveBeenCalledTimes(2);
    });
    it('a different throttleable category is not throttled by a recent email', async () => {
        expect(await call(addNotif('form_submission'), 'form_submission')).toBe('sent');
        expect(await call(addNotif('adopter_merged'), 'adopter_merged')).toBe('sent');
        expect(send).toHaveBeenCalledTimes(2);
    });
    it('a user row but no user_profiles row -> sent', async () => {
        expect(await call(addNotif('form_submission'), 'form_submission')).toBe('sent');
    });
    it('no user row -> skipped_no_account, nothing sent (no way to manage or unsubscribe)', async () => {
        sqlite.prepare(`DELETE FROM user WHERE id = 'u1'`).run();
        expect(await call(addNotif('form_submission'), 'form_submission')).toBe('skipped_no_account');
        expect(await call(addNotif('merge_request'), 'merge_request')).toBe('skipped_no_account');
        expect(send).not.toHaveBeenCalled();
    });
    it('the user row has capitals: prefs still apply (matched case-insensitively)', async () => {
        sqlite.prepare(`UPDATE user SET email = 'Rescuer@Example.com' WHERE id = 'u1'`).run();
        seedUser(JSON.stringify({ forms: false }));
        expect(await call(addNotif('form_submission'), 'form_submission')).toBe('skipped_pref');
        expect(await call(addNotif('adopter_merged'), 'adopter_merged')).toBe('sent');
    });
    it('two pii_access_request emails back to back: the second is throttled; merge_request never is', async () => {
        expect(await call(addNotif('pii_access_request'), 'pii_access_request')).toBe('sent');
        expect(await call(addNotif('pii_access_request'), 'pii_access_request')).toBe('skipped_throttle');
        expect(await call(addNotif('merge_request'), 'merge_request')).toBe('sent');
        expect(await call(addNotif('merge_request'), 'merge_request')).toBe('sent');
        expect(send).toHaveBeenCalledTimes(3);
    });
    it('a just-sent merge_request does not throttle a pii_access_request', async () => {
        expect(await call(addNotif('merge_request'), 'merge_request')).toBe('sent');
        expect(await call(addNotif('pii_access_request'), 'pii_access_request')).toBe('sent');
        expect(send).toHaveBeenCalledTimes(2);
        // Still always-on: no unsubscribe link.
        expect(send.mock.calls[1][0].html).not.toContain('Dejar de recibir');
    });
    it('ENABLE_NOTIFICATION_EMAIL off (app_config) -> skipped_disabled, checked before anything else', async () => {
        sqlite.prepare(`INSERT INTO app_config (key, value) VALUES ('ENABLE_NOTIFICATION_EMAIL', 'false')`).run();
        sqlite.prepare(`DELETE FROM user WHERE id = 'u1'`).run();
        expect(await call(addNotif('merge_request'), 'merge_request')).toBe('skipped_disabled');
        expect(await call(addNotif('form_submission'), 'form_submission')).toBe('skipped_disabled');
        expect(send).not.toHaveBeenCalled();
    });
    it('ENABLE_NOTIFICATION_EMAIL on by default (no row) and when set true', async () => {
        expect(await call(addNotif('merge_request'), 'merge_request')).toBe('sent');
        sqlite.prepare(`INSERT INTO app_config (key, value) VALUES ('ENABLE_NOTIFICATION_EMAIL', 'true')`).run();
        expect(await call(addNotif('merge_request'), 'merge_request')).toBe('sent');
        expect(send).toHaveBeenCalledTimes(2);
    });
    it('malformed email_prefs -> sent', async () => {
        seedUser('{not json');
        expect(await call(addNotif('form_submission'), 'form_submission')).toBe('sent');
    });
    it('send failure -> failed, emailed_at stays null', async () => {
        send.mockResolvedValue({ ok: false, errorId: 'abc12345' });
        const id = addNotif('form_submission');
        expect(await call(id, 'form_submission')).toBe('failed');
        expect(emailedAt(id)).toBeNull();
    });
    it('no API key -> skipped_config', async () => {
        vi.stubEnv('RESEND_API_KEY', '');
        expect(await call(addNotif('form_submission'), 'form_submission')).toBe('skipped_config');
        expect(send).not.toHaveBeenCalled();
    });
});

describe('buildNotificationEmail', () => {
    const links = { appBaseUrl: 'https://staging.buenadoptante.org', unsubscribeUrl: null as string | null };
    it('escapes html in title and body', () => {
        const m = buildNotificationEmail({ title: '<b>t</b>', body: '<script>alert(1)</script>', url: '/a' }, links);
        expect(m.html).not.toContain('<script>');
        expect(m.html).toContain('&lt;script&gt;');
        expect(m.html).toContain('https://staging.buenadoptante.org/a');
    });
    it('omits the unsubscribe line when unsubscribeUrl is null, includes it otherwise', () => {
        expect(buildNotificationEmail({ title: 't', body: 'b', url: null }, links).html).not.toContain('Dejar de recibir');
        const m = buildNotificationEmail({ title: 't', body: 'b', url: null }, { ...links, unsubscribeUrl: 'https://u/x' });
        expect(m.html).toContain('Dejar de recibir estos avisos');
        expect(m.text).toContain('https://u/x');
    });
});
