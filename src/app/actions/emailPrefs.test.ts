import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { session, getUser, OWNER } from '@/test-utils/actionMocks';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));
vi.mock('./_db', () => ({ getDb: async () => state.db, getUser }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
const { fromFails } = vi.hoisted(() => ({ fromFails: { on: false } }));
vi.mock('@/lib/teamChangeAudience', async (orig) => {
    const real = await orig<typeof import('@/lib/teamChangeAudience')>();
    return { ...real, getProfileChangesFromForEmail: async (...a: Parameters<typeof real.getProfileChangesFromForEmail>) => {
        if (fromFails.on) throw new Error('no such column: profile_changes_from');
        return real.getProfileChangesFromForEmail(...a);
    } };
});

import { getEmailPrefs, saveEmailPref, saveProfileChangesFrom } from './settings';

type Sqlite = { prepare: (s: string) => { get: (...a: unknown[]) => Record<string, unknown> | undefined; run: (...a: unknown[]) => unknown } };
let sqlite: Sqlite;

const storedPrefs = () =>
    (sqlite.prepare(`SELECT email_prefs AS p FROM user_profiles WHERE user_id = 'u1'`).get() as { p: string | null } | undefined)?.p;
const addKey = (id: string, revoked: boolean) =>
    sqlite.prepare(`INSERT INTO api_keys (id, owner_email, name, key_hash, key_prefix, scopes, created_by, revoked_at)
        VALUES (?, ?, 'k', ?, 'p', '[]', ?, ?)`).run(id, OWNER, `hash-${id}`, OWNER, revoked ? 1000 : null);

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as Sqlite;
    session.user = OWNER;
    fromFails.on = false;
    sqlite.prepare(`INSERT INTO user (id, email) VALUES ('u1', ?)`).run(OWNER);
});

describe('email prefs actions', () => {
    it('no profile row: empty prefs, no api key', async () => {
        expect(await getEmailPrefs()).toEqual({ prefs: {}, hasApiKey: false, profileChangesFrom: 'outside' });
    });

    it('the choice unreadable: the email switches still show, the choice reads as the default (review M6)', async () => {
        await saveEmailPref('forms', false);
        fromFails.on = true;
        expect(await getEmailPrefs()).toEqual({ prefs: { forms: false }, hasApiKey: false, profileChangesFrom: 'outside' });
    });

    it('signed out: null', async () => {
        session.user = null;
        expect(await getEmailPrefs()).toBeNull();
    });

    it('saves a switch and keeps earlier ones', async () => {
        expect(await saveEmailPref('forms', false)).toEqual({ success: true });
        expect((await getEmailPrefs())?.prefs.forms).toBe(false);
        expect((await saveEmailPref('merges', false)).success).toBe(true);
        expect((await getEmailPrefs())?.prefs).toEqual({ forms: false, merges: false });
        expect((await saveEmailPref('forms', true)).success).toBe(true);
        expect((await getEmailPrefs())?.prefs).toEqual({ forms: true, merges: false });
    });

    it('refuses the always-on category and unknown values', async () => {
        const r = await saveEmailPref('requests', false);
        expect(r.success).toBe(false);
        expect(r.errorId).toBeTruthy();
        expect((await saveEmailPref('bogus' as never, false)).success).toBe(false);
        expect((await saveEmailPref('forms', 'no' as never)).success).toBe(false);
        expect(storedPrefs()).toBeUndefined();
    });

    it('revoked key: hasApiKey false; live key: true', async () => {
        addKey('k1', true);
        expect((await getEmailPrefs())?.hasApiKey).toBe(false);
        addKey('k2', false);
        expect((await getEmailPrefs())?.hasApiKey).toBe(true);
    });

    it('malformed stored JSON reads as {} and the save overwrites it cleanly', async () => {
        sqlite.prepare(`INSERT INTO user_profiles (user_id, email_prefs) VALUES ('u1', '{not json')`).run();
        expect((await getEmailPrefs())?.prefs).toEqual({});
        expect((await saveEmailPref('other', false)).success).toBe(true);
        expect(JSON.parse(storedPrefs()!)).toEqual({ other: false });
    });

    it('save for a user with no user row fails with an errorId', async () => {
        session.user = 'ghost@example.com';
        const r = await saveEmailPref('forms', false);
        expect(r.success).toBe(false);
        expect(r.errorId).toBeTruthy();
    });
});

const storedFrom = () =>
    (sqlite.prepare(`SELECT profile_changes_from AS f FROM user_profiles WHERE user_id = 'u1'`).get() as { f: string | null } | undefined)?.f;

describe('«Avisame de cambios hechos por:» (saveProfileChangesFrom)', () => {
    it("saves «… y mi equipo» and back; getEmailPrefs returns it; the email switches are untouched", async () => {
        await saveEmailPref('forms', false);
        expect(await saveProfileChangesFrom('team')).toEqual({ success: true });
        expect(storedFrom()).toBe('team');
        expect(await getEmailPrefs()).toMatchObject({ profileChangesFrom: 'team', prefs: { forms: false } });
        expect(await saveProfileChangesFrom('outside')).toEqual({ success: true });
        expect((await getEmailPrefs())?.profileChangesFrom).toBe('outside');
    });

    it('works while the «Cambios en tus perfiles» email switch is off (the choice is the bell too)', async () => {
        await saveEmailPref('profile_changes', false);
        expect(await saveProfileChangesFrom('team')).toEqual({ success: true });
        expect(await getEmailPrefs()).toMatchObject({ profileChangesFrom: 'team', prefs: { profile_changes: false } });
    });

    it('refuses anything but outside|team, with an errorId; nothing stored', async () => {
        for (const bad of ['everyone', '', null, 1, { from: 'team' }]) {
            const r = await saveProfileChangesFrom(bad as never);
            expect(r.success).toBe(false);
            expect(r.errorId).toBeTruthy();
        }
        expect(storedFrom()).toBeUndefined();
    });

    it('signed out or no user row: refused with an errorId', async () => {
        session.user = null;
        expect(await saveProfileChangesFrom('team')).toMatchObject({ success: false, errorId: expect.any(String) });
        session.user = 'ghost@example.com';
        expect(await saveProfileChangesFrom('team')).toMatchObject({ success: false, errorId: expect.any(String) });
    });
});
