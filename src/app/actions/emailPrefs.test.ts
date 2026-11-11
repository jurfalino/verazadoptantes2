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
const storedFollowups = () =>
    (sqlite.prepare(`SELECT followup_settings AS f FROM user_profiles WHERE user_id = 'u1'`).get() as { f: string | null } | undefined)?.f;
const DEFAULTS = { prefs: {}, followupEmail: false, animalsScope: 'team', profileChangesFrom: 'outside' };

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as Sqlite;
    session.user = OWNER;
    fromFails.on = false;
    sqlite.prepare(`INSERT INTO user (id, email) VALUES ('u1', ?)`).run(OWNER);
});

describe('«Avisos» actions', () => {
    it('no profile row: the defaults', async () => {
        expect(await getEmailPrefs()).toEqual(DEFAULTS);
    });

    it('the choice unreadable: the email switches still show, the choice reads as the default (review M6)', async () => {
        await saveEmailPref('form', false);
        fromFails.on = true;
        expect(await getEmailPrefs()).toEqual({ ...DEFAULTS, prefs: { form: false } });
    });

    it('signed out: null', async () => {
        session.user = null;
        expect(await getEmailPrefs()).toBeNull();
    });

    it('saves a row switch and keeps earlier ones', async () => {
        expect(await saveEmailPref('form', false)).toEqual({ success: true });
        expect((await getEmailPrefs())?.prefs.form).toBe(false);
        expect((await saveEmailPref('duplicates', true)).success).toBe(true);
        expect((await getEmailPrefs())?.prefs).toEqual({ form: false, duplicates: true });
        expect((await saveEmailPref('form', true)).success).toBe(true);
        expect((await getEmailPrefs())?.prefs).toEqual({ form: true, duplicates: true });
    });

    it('refuses the «Siempre» rows, old categories and unknown values', async () => {
        for (const bad of ['merge_request', 'pii_request', 'pair_message', 'forms', 'requests', 'bogus']) {
            const r = await saveEmailPref(bad as never, false);
            expect(r.success, bad).toBe(false);
            expect(r.errorId).toBeTruthy();
        }
        expect((await saveEmailPref('form', 'no' as never)).success).toBe(false);
        expect(storedPrefs()).toBeUndefined();
    });

    it("«Toca un control de seguimiento» writes followup_settings.emailReminders, keeping the schedule", async () => {
        sqlite.prepare(`INSERT INTO user_profiles (user_id, followup_settings) VALUES ('u1', '{"version":1,"checkins":[{"offsetDays":10}],"messages":{"neuter":"Hola"}}')`).run();
        expect(await saveEmailPref('followups', true)).toEqual({ success: true });
        expect(JSON.parse(storedFollowups()!)).toEqual({ version: 1, checkins: [{ offsetDays: 10 }], messages: { neuter: 'Hola' }, emailReminders: true });
        expect((await getEmailPrefs())?.followupEmail).toBe(true);
        expect(await saveEmailPref('followups', false)).toEqual({ success: true });
        expect(JSON.parse(storedFollowups()!)).toEqual({ version: 1, checkins: [{ offsetDays: 10 }], messages: { neuter: 'Hola' } });
        expect((await getEmailPrefs())?.followupEmail).toBe(false);
        // The row switches are a different column: untouched.
        expect(storedPrefs()).toBeNull();
    });

    it('«Formularios, contratos y controles de:»: animals_mine true = «Mis animales», false = the whole team', async () => {
        expect(await saveEmailPref('animals_mine', true)).toEqual({ success: true });
        expect((await getEmailPrefs())?.animalsScope).toBe('mine');
        expect(await saveEmailPref('animals_mine', false)).toEqual({ success: true });
        expect((await getEmailPrefs())?.animalsScope).toBe('team');
    });

    it('malformed stored JSON reads as {} and the save overwrites it cleanly', async () => {
        sqlite.prepare(`INSERT INTO user_profiles (user_id, email_prefs) VALUES ('u1', '{not json')`).run();
        expect((await getEmailPrefs())?.prefs).toEqual({});
        expect((await saveEmailPref('group', true)).success).toBe(true);
        expect(JSON.parse(storedPrefs()!)).toEqual({ group: true });
    });

    it('save for a user with no user row fails with an errorId', async () => {
        session.user = 'ghost@example.com';
        for (const key of ['form', 'followups', 'animals_mine'] as const) {
            const r = await saveEmailPref(key, false);
            expect(r.success, key).toBe(false);
            expect(r.errorId).toBeTruthy();
        }
    });
});

const storedFrom = () =>
    (sqlite.prepare(`SELECT profile_changes_from AS f FROM user_profiles WHERE user_id = 'u1'`).get() as { f: string | null } | undefined)?.f;

describe('«Avisame de cambios hechos por:» (saveProfileChangesFrom)', () => {
    it("saves «… y mi equipo» and back; getEmailPrefs returns it; the email switches are untouched", async () => {
        await saveEmailPref('form', false);
        expect(await saveProfileChangesFrom('team')).toEqual({ success: true });
        expect(storedFrom()).toBe('team');
        expect(await getEmailPrefs()).toMatchObject({ profileChangesFrom: 'team', prefs: { form: false } });
        expect(await saveProfileChangesFrom('outside')).toEqual({ success: true });
        expect((await getEmailPrefs())?.profileChangesFrom).toBe('outside');
    });

    it('works whatever the profile-change rows\' email switches say (the choice is the bell too)', async () => {
        await saveEmailPref('content', false);
        expect(await saveProfileChangesFrom('team')).toEqual({ success: true });
        expect(await getEmailPrefs()).toMatchObject({ profileChangesFrom: 'team', prefs: { content: false } });
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
