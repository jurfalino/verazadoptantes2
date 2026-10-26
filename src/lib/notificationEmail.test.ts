import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

const { state, send } = vi.hoisted(() => ({
    state: { db: null as unknown, localeFails: false },
    send: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/emailPrefs', async (orig) => {
    const real = await orig<typeof import('@/lib/emailPrefs')>();
    return {
        ...real,
        getLocaleForEmail: (...a: Parameters<typeof real.getLocaleForEmail>) =>
            state.localeFails ? Promise.reject(new Error('D1 down')) : real.getLocaleForEmail(...a),
    };
});
vi.mock('@/lib/email', async (orig) => ({ ...(await orig<typeof import('@/lib/email')>()), sendEmailViaResend: send }));

import { sendNotificationEmail } from './notificationEmail';
import { buildNotificationEmail } from './email';
import { isLocalRun } from './emailConfig';

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
    state.localeFails = false;
    vi.stubEnv('RESEND_API_KEY', 'key');
    vi.stubEnv('AUTH_SECRET', 'test-secret');
    // A CI-stamped build (D53): an unstamped one is a local run and never emails.
    vi.stubEnv('APP_ENVIRONMENT', 'staging');
    vi.stubEnv('EMAIL_ALLOW_LOCAL', '');
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

describe('local runs never email (D53)', () => {
    it('no APP_ENVIRONMENT stamp -> skipped_local, nothing sent, emailed_at stays null, logged at info', async () => {
        const { logger } = await import('@/lib/logger');
        const info = vi.spyOn(logger, 'info');
        vi.stubEnv('APP_ENVIRONMENT', '');
        const id = addNotif('merge_request');
        expect(await call(id, 'merge_request')).toBe('skipped_local');
        expect(send).not.toHaveBeenCalled();
        expect(emailedAt(id)).toBeNull();
        expect(info).toHaveBeenCalledWith(expect.stringContaining('local run'), expect.objectContaining({ notificationId: id, type: 'merge_request' }));
        info.mockRestore();
    });
    it('EMAIL_ALLOW_LOCAL=1 lets a local run send (explicitly allowed for a test)', async () => {
        vi.stubEnv('APP_ENVIRONMENT', '');
        vi.stubEnv('EMAIL_ALLOW_LOCAL', '1');
        const id = addNotif('merge_request');
        expect(await call(id, 'merge_request')).toBe('sent');
        expect(send).toHaveBeenCalledTimes(1);
        expect(emailedAt(id)).not.toBeNull();
    });
    it('only exactly "1" allows it', async () => {
        vi.stubEnv('APP_ENVIRONMENT', '');
        for (const v of ['true', '0', 'yes']) {
            vi.stubEnv('EMAIL_ALLOW_LOCAL', v);
            expect(await call(addNotif('merge_request'), 'merge_request')).toBe('skipped_local');
        }
        expect(send).not.toHaveBeenCalled();
    });
    it('stamped staging and production builds send', async () => {
        for (const env of ['staging', 'production']) {
            vi.stubEnv('APP_ENVIRONMENT', env);
            expect(await call(addNotif('merge_request'), 'merge_request')).toBe('sent');
        }
        expect(send).toHaveBeenCalledTimes(2);
    });
    it('isLocalRun: true without the stamp, false for staging and production', () => {
        vi.stubEnv('APP_ENVIRONMENT', '');
        expect(isLocalRun()).toBe(true);
        vi.stubEnv('APP_ENVIRONMENT', 'staging');
        expect(isLocalRun()).toBe(false);
        vi.stubEnv('APP_ENVIRONMENT', 'production');
        expect(isLocalRun()).toBe(false);
    });
});

describe('pair_message reply-to', () => {
    const callWith = (type: string, metadata: Record<string, unknown> | undefined) =>
        sendNotificationEmail({ id: addNotif(type), userId: EMAIL, type, title: 'T', body: 'B', url: '/x', metadata });
    it('pair_message: reply_to is the sender (metadata.replyTo), category merges', async () => {
        seedUser(JSON.stringify({ merges: false }));
        expect(await callWith('pair_message', { replyTo: 'sender@example.com' })).toBe('skipped_pref');
        sqlite.prepare('DELETE FROM user_profiles').run();
        expect(await callWith('pair_message', { requestId: 'r', replyTo: 'sender@example.com' })).toBe('sent');
        expect(send.mock.calls[0][0]).toMatchObject({ to: EMAIL, replyTo: 'sender@example.com' });
    });
    it('pair_message with a missing or malformed replyTo: sent without one', async () => {
        await callWith('pair_message', { replyTo: 'not an email' });
        await callWith('pair_message', undefined);
        expect(send.mock.calls[0][0].replyTo).toBeUndefined();
        expect(send.mock.calls[1][0].replyTo).toBeUndefined();
    });
    it('other types never get a reply-to even if metadata carries one', async () => {
        await callWith('merge_request', { replyTo: 'sender@example.com' });
        expect(send.mock.calls[0][0].replyTo).toBeUndefined();
    });
});

describe('recipient language (D38)', () => {
    const template = { key: 'contact_entry_added', params: { actorName: 'Ana', adopterName: 'Carla', entryType: 'phone' } };
    const stored = { title: 'Nuevo dato de contacto', body: 'Ana agregó un teléfono a Carla.' };
    const callWith = (metadata: Record<string, unknown> | null) =>
        sendNotificationEmail({ id: addNotif('contact_entry_added'), userId: EMAIL, type: 'contact_entry_added', ...stored, url: '/x', metadata });

    it('a pt recipient gets the pt subject and body', async () => {
        sqlite.prepare(`INSERT INTO user_profiles (user_id, locale) VALUES ('u1', 'pt')`).run();
        expect(await callWith({ adopterId: 'a1', template })).toBe('sent');
        const sent = send.mock.calls[0][0];
        expect(sent.subject).toContain('Novo dado de contato');
        expect(sent.text).toContain('Ana adicionou um telefone a Carla.');
        expect(sent.text).toContain('Ver no BuenAdoptante');
    });
    it('a notification without a template still emails its stored Spanish text', async () => {
        sqlite.prepare(`INSERT INTO user_profiles (user_id, locale) VALUES ('u1', 'en')`).run();
        expect(await callWith({ adopterId: 'a1' })).toBe('sent');
        expect(send.mock.calls[0][0].subject).toContain(stored.title);
        expect(send.mock.calls[0][0].text).toContain(stored.body);
    });
    it('an unknown template key falls back to the stored text, never the key', async () => {
        sqlite.prepare(`INSERT INTO user_profiles (user_id, locale) VALUES ('u1', 'en')`).run();
        await callWith({ template: { key: 'gone', params: {} } });
        expect(send.mock.calls[0][0].subject).toContain(stored.title);
        expect(send.mock.calls[0][0].subject).not.toContain('gone');
    });
    it('a failed locale lookup still sends, in Spanish, and logs a warn', async () => {
        const { logger } = await import('@/lib/logger');
        const warn = vi.spyOn(logger, 'warn');
        state.localeFails = true;
        const id = addNotif('contact_entry_added');
        expect(await sendNotificationEmail({ id, userId: EMAIL, type: 'contact_entry_added', ...stored, url: '/x', metadata: { template } })).toBe('sent');
        expect(send.mock.calls[0][0].subject).toContain(stored.title);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('locale lookup failed'), expect.objectContaining({ notificationId: id, type: 'contact_entry_added' }));
        warn.mockRestore();
    });
});

describe('buildNotificationEmail', () => {
    const links = { appBaseUrl: 'https://staging.buenadoptante.org', unsubscribeUrl: null as string | null };
    const prod = { locale: 'es' as const, staging: false };
    it('escapes html in title and body', () => {
        const m = buildNotificationEmail({ title: '<b>t</b>', body: '<script>alert(1)</script>', url: '/a' }, links, prod);
        expect(m.html).not.toContain('<script>');
        expect(m.html).toContain('&lt;script&gt;');
        expect(m.html).toContain('https://staging.buenadoptante.org/a');
    });
    it('omits the unsubscribe line when unsubscribeUrl is null, includes it otherwise', () => {
        expect(buildNotificationEmail({ title: 't', body: 'b', url: null }, links, prod).html).not.toContain('Dejar de recibir');
        const m = buildNotificationEmail({ title: 't', body: 'b', url: null }, { ...links, unsubscribeUrl: 'https://u/x' }, prod);
        expect(m.html).toContain('Dejar de recibir estos avisos');
        expect(m.text).toContain('https://u/x');
    });
    it('staging: subject prefix and banner, in the recipient language', () => {
        const m = buildNotificationEmail({ title: 'Hola', body: 'b', url: null }, links, { locale: 'es', staging: true });
        expect(m.subject).toBe('[Staging] Hola');
        expect(m.html).toContain('Staging');
        expect(m.html).toContain('entorno de pruebas');
        expect(m.text).toContain('entorno de pruebas');
    });
    it('production: no prefix, no banner', () => {
        const m = buildNotificationEmail({ title: 'Hola', body: 'b', url: null }, links, prod);
        expect(m.subject).toBe('Hola');
        expect(m.html).not.toContain('Staging');
    });
    it('en and pt chrome', () => {
        const en = buildNotificationEmail({ title: 't', body: 'b', url: null }, { ...links, unsubscribeUrl: 'https://u/x' }, { locale: 'en', staging: false });
        expect(en.html).toContain('View on BuenAdoptante');
        expect(en.text).toContain('View on BuenAdoptante');
        const pt = buildNotificationEmail({ title: 't', body: 'b', url: null }, links, { locale: 'pt', staging: true });
        expect(pt.html).toContain('Ver no BuenAdoptante');
        expect(pt.html).toContain('ambiente de testes');
    });
});
