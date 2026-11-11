/**
 * notifyOrgMembers' team copies of forms and contracts («Avisos», Jon
 * 2026-11-11): every copy reaches the bell; only the one to `teamCopy.emailTo`
 * may be emailed. Real SQL; the email twin is observed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/background', () => ({ runAfterResponse: async (_l: string, fn: () => Promise<unknown>) => { await fn(); } }));
vi.mock('@/lib/notificationEmail', () => ({ sendNotificationEmail: vi.fn(async () => 'skipped_local') }));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
}));

import { notifyOrgMembers } from './notifications';
import { sendNotificationEmail } from '@/lib/notificationEmail';

type Sqlite = { prepare: (s: string) => { all: (...a: unknown[]) => Record<string, unknown>[]; run: (...a: unknown[]) => unknown } };
let sqlite: Sqlite;
const ANA = 'ana@example.com';
const BEA = 'bea@example.com';
const CAL = 'cal@example.com';

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as Sqlite;
    vi.mocked(sendNotificationEmail).mockClear();
    for (const [i, e] of [ANA, BEA, CAL].entries()) {
        sqlite.prepare(`INSERT INTO org_members (id, org_id, user_email) VALUES (?, 'org-1', ?)`).run(`m${i}`, e);
    }
});

const bellOnlyByRecipient = () => Object.fromEntries(vi.mocked(sendNotificationEmail).mock.calls.map(([n]) => [n.userId, n.bellOnly === true]));

describe('notifyOrgMembers — team copies', () => {
    it('a form for a teammate\'s animal: every copy in the bell, only the animal owner\'s may be emailed', async () => {
        await notifyOrgMembers({ actorEmail: ANA, type: 'form_submission', title: 't', body: 'b', teamCopy: { emailTo: BEA, animalOwner: BEA } });
        expect(sqlite.prepare("SELECT user_id FROM notifications ORDER BY user_id").all().map(r => r.user_id)).toEqual([BEA, CAL]);
        expect(bellOnlyByRecipient()).toEqual({ [BEA]: false, [CAL]: true });
    });

    it('a contract (the owner is the actor): every team copy bell only', async () => {
        await notifyOrgMembers({ actorEmail: ANA, type: 'contract_result', title: 't', body: 'b', teamCopy: { emailTo: ANA, animalOwner: ANA } });
        expect(bellOnlyByRecipient()).toEqual({ [BEA]: true, [CAL]: true });
    });

    it('«Mis animales»: no copy (not even the bell) unless the member added the animal', async () => {
        sqlite.prepare(`INSERT INTO user (id, email) VALUES ('ub', ?), ('uc', ?)`).run(BEA, CAL);
        sqlite.prepare(`INSERT INTO user_profiles (user_id, animals_scope) VALUES ('ub', 'mine'), ('uc', 'mine')`).run();
        await notifyOrgMembers({ actorEmail: ANA, type: 'form_submission', title: 't', body: 'b', teamCopy: { emailTo: BEA, animalOwner: BEA } });
        expect(sqlite.prepare("SELECT user_id FROM notifications").all().map(r => r.user_id)).toEqual([BEA]);
        sqlite.prepare('DELETE FROM notifications').run();
        // A form for no animal of the team: nobody with «Mis animales» hears.
        await notifyOrgMembers({ actorEmail: ANA, type: 'form_submission', title: 't', body: 'b', teamCopy: { emailTo: ANA, animalOwner: null } });
        expect(sqlite.prepare("SELECT user_id FROM notifications").all()).toEqual([]);
    });

    it('an unreadable choice counts as the whole team, logged', async () => {
        sqlite.prepare('DROP TABLE user_profiles').run();
        await notifyOrgMembers({ actorEmail: ANA, type: 'form_submission', title: 't', body: 'b', teamCopy: { emailTo: BEA, animalOwner: BEA } });
        expect(sqlite.prepare("SELECT user_id FROM notifications ORDER BY user_id").all().map(r => r.user_id)).toEqual([BEA, CAL]);
        const { logger } = await import('@/lib/logger');
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('animals scope unreadable'), expect.objectContaining({ type: 'form_submission' }));
    });

    it('excluded members (the route already wrote their copy) get no second one, whatever the case', async () => {
        await notifyOrgMembers({ actorEmail: ANA, type: 'form_submission', title: 't', body: 'b', teamCopy: { emailTo: null, animalOwner: BEA }, excludeEmails: [' Bea@Example.COM'] });
        expect(sqlite.prepare("SELECT user_id FROM notifications ORDER BY user_id").all().map(r => r.user_id)).toEqual([CAL]);
        expect(bellOnlyByRecipient()).toEqual({ [CAL]: true });
    });

    it('without teamCopy nothing changes: each copy follows its row', async () => {
        await notifyOrgMembers({ actorEmail: ANA, type: 'member_joined', title: 't', body: 'b' });
        expect(bellOnlyByRecipient()).toEqual({ [BEA]: false, [CAL]: false });
    });
});
