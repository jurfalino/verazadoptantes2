/**
 * profile_content_added: what someone adds to a profile reaches the owner's
 * team as ONE notice per action — the record, its photos and its delivery
 * address merged into the same row — through the one recipient rule
 * (keepChangeRecipients). Real SQL on the real schema.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { OWNER, MATE, STRANGER, isOrgMate, getOrgMemberEmailsFor } from '@/test-utils/actionMocks';

const { state, emails } = vi.hoisted(() => ({ state: { db: null as unknown }, emails: [] as Array<Record<string, unknown>> }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/orgMembership', () => ({ isOrgMate, getOrgMemberEmailsFor, normEmail: (e: string) => e.trim().toLowerCase() }));
vi.mock('@/config/features', () => ({ getFeatureFlag: async () => true }));
vi.mock('@/lib/background', () => ({ runAfterResponse: async (_n: string, fn: () => Promise<unknown>) => { await fn(); } }));
vi.mock('@/lib/notificationEmail', () => ({ sendNotificationEmail: vi.fn(async (n: Record<string, unknown>) => { emails.push(n); return 'sent'; }) }));

import { notifyProfileAddition } from './profileAdditionNotices';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; all: (...a: unknown[]) => Row[]; run: (...a: unknown[]) => unknown } };

const notices = () => sqlite.prepare(`SELECT user_id, title, body, url, read, metadata FROM notifications WHERE type = 'profile_content_added' ORDER BY user_id`).all();
const bodies = () => notices().map(n => [n.user_id, n.body]);

function chooseTeam(email: string) {
    const id = `u-${email}`;
    sqlite.prepare(`INSERT OR IGNORE INTO user (id, email, name) VALUES (?, ?, ?)`).run(id, email, email.split('@')[0]);
    sqlite.prepare(`INSERT INTO user_profiles (user_id, profile_changes_from) VALUES (?, 'team')`).run(id);
}

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    emails.length = 0;
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('ad1', 'Marta Paez', '5', ?, 1, 1)`).run(OWNER);
    sqlite.prepare(`INSERT INTO user (id, email, name) VALUES ('u-ana', ?, 'Ana')`).run(STRANGER);
});

describe('notifyProfileAddition', () => {
    it('an outsider\'s record reaches the owner and their teammate, once each, linked to the profile', async () => {
        await notifyProfileAddition(state.db as never, { adopterId: 'ad1', actor: STRANGER, add: { records: [{ type: 'adoption', rating: 4 }] }, op: 'test' });
        expect(bodies()).toEqual([
            [MATE, 'Ana agregó un registro (Adopción, 4★) a Marta Paez.'],
            [OWNER, 'Ana agregó un registro (Adopción, 4★) a Marta Paez.'],
        ]);
        expect(notices().every(n => n.url === '/adopter/ad1')).toBe(true);
        // The metadata never carries the actor's email.
        expect(notices().some(n => String(n.metadata).includes(STRANGER))).toBe(false);
        expect(emails).toHaveLength(2);
    });

    it('a record, then its photos (in parallel) and the delivery address: ONE notice per recipient, one email', async () => {
        await notifyProfileAddition(state.db as never, { adopterId: 'ad1', actor: STRANGER, add: { records: [{ type: 'adoption', rating: 4 }], address: true }, op: 'test' });
        await Promise.all([1, 2, 3].map(() => notifyProfileAddition(state.db as never, { adopterId: 'ad1', actor: STRANGER, add: { photos: 1 }, op: 'test' })));
        expect(bodies()).toEqual([
            [MATE, 'Ana agregó un registro (Adopción, 4★), 3 fotos y una dirección de entrega a Marta Paez.'],
            [OWNER, 'Ana agregó un registro (Adopción, 4★), 3 fotos y una dirección de entrega a Marta Paez.'],
        ]);
        expect(emails).toHaveLength(2);
    });

    it('photos alone, uploaded at once with no notice yet: one notice counting all of them', async () => {
        await Promise.all([1, 2, 3].map(() => notifyProfileAddition(state.db as never, { adopterId: 'ad1', actor: STRANGER, add: { photos: 1 }, op: 'test' })));
        expect(bodies()).toEqual([[MATE, 'Ana agregó 3 fotos a Marta Paez.'], [OWNER, 'Ana agregó 3 fotos a Marta Paez.']]);
    });

    it('a photo first, then the record: still one notice; a read notice comes back unread', async () => {
        await notifyProfileAddition(state.db as never, { adopterId: 'ad1', actor: STRANGER, add: { photos: 1 }, op: 'test' });
        sqlite.prepare(`UPDATE notifications SET read = 1`).run();
        await notifyProfileAddition(state.db as never, { adopterId: 'ad1', actor: STRANGER, add: { records: [{ type: 'observation' }] }, op: 'test' });
        expect(notices().map(n => [n.body, n.read])).toEqual([
            ['Ana agregó un registro (Observación) y una foto a Marta Paez.', 0],
            ['Ana agregó un registro (Observación) y una foto a Marta Paez.', 0],
        ]);
    });

    it('two records in one save (the wizard\'s adoption + its follow-up) are listed together', async () => {
        await notifyProfileAddition(state.db as never, { adopterId: 'ad1', actor: STRANGER, add: { records: [{ type: 'adoption', rating: 5 }] }, op: 'test' });
        await notifyProfileAddition(state.db as never, { adopterId: 'ad1', actor: STRANGER, add: { records: [{ type: 'follow_up' }] }, op: 'test' });
        expect(bodies()[0][1]).toBe('Ana agregó 2 registros (Adopción, 5★; Seguimiento) a Marta Paez.');
    });

    it('another person\'s add, or an add after the window, is its own notice', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
            await notifyProfileAddition(state.db as never, { adopterId: 'ad1', actor: STRANGER, add: { photos: 1 }, op: 'test' });
            vi.setSystemTime(new Date('2026-11-08T11:00:00Z'));
            await notifyProfileAddition(state.db as never, { adopterId: 'ad1', actor: STRANGER, add: { photos: 1 }, op: 'test' });
        } finally {
            vi.useRealTimers();
        }
        await notifyProfileAddition(state.db as never, { adopterId: 'ad1', actor: 'other@example.com', add: { photos: 1 }, op: 'test' });
        expect(notices().filter(n => n.user_id === OWNER)).toHaveLength(3);
    });

    it('a teammate\'s add with the default «Otros rescatistas»: nobody is told', async () => {
        await notifyProfileAddition(state.db as never, { adopterId: 'ad1', actor: MATE, add: { records: [{ type: 'adoption' }], photos: 2 }, op: 'test' });
        expect(notices()).toEqual([]);
    });

    it('a teammate\'s add reaches only the teammates who chose «… y mi equipo»; the owner\'s own add tells nobody', async () => {
        chooseTeam(OWNER);
        await notifyProfileAddition(state.db as never, { adopterId: 'ad1', actor: MATE, add: { photos: 1 }, op: 'test' });
        expect(notices().map(n => n.user_id)).toEqual([OWNER]);
        sqlite.prepare(`DELETE FROM notifications`).run();
        chooseTeam(MATE);
        await notifyProfileAddition(state.db as never, { adopterId: 'ad1', actor: OWNER, add: { photos: 1 }, op: 'test' });
        expect(notices().map(n => n.user_id)).toEqual([MATE]);
    });

    it('a photo on one of the profile\'s records is told; one on an animal event (stored under the holder) is not', async () => {
        sqlite.prepare(`INSERT INTO animals (id, name, species, added_by, created_at, updated_at) VALUES ('an1', 'Nina', 'cat', ?, 1, 1)`).run(STRANGER);
        sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at, recorded_by) VALUES ('an1-plc', 'an1', 'ad1', 'adoption', 1, ?)`).run(STRANGER);
        await notifyProfileAddition(state.db as never, { adopterId: 'ad1', actor: STRANGER, add: { photos: 1 }, op: 'test', recordId: 'animal-event-1' });
        expect(notices()).toEqual([]);
        await notifyProfileAddition(state.db as never, { adopterId: 'ad1', actor: STRANGER, add: { photos: 1 }, op: 'test', recordId: 'an1' });
        expect(notices()).toHaveLength(2);
    });

    it('no live profile (an animal photo keyed on an email or «__available__», a deleted or ownerless profile): nothing', async () => {
        await notifyProfileAddition(state.db as never, { adopterId: '__available__', actor: STRANGER, add: { photos: 1 }, op: 'test' });
        await notifyProfileAddition(state.db as never, { adopterId: OWNER, actor: STRANGER, add: { photos: 1 }, op: 'test' });
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at, deleted_at) VALUES ('gone', 'X', '5', ?, 1, 1, 5)`).run(OWNER);
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('imp', 'Y', '5', 'import', 1, 1)`).run();
        await notifyProfileAddition(state.db as never, { adopterId: 'gone', actor: STRANGER, add: { photos: 1 }, op: 'test' });
        await notifyProfileAddition(state.db as never, { adopterId: 'imp', actor: STRANGER, add: { photos: 1 }, op: 'test' });
        expect(notices()).toEqual([]);
    });

    it('nothing added, or no real actor: nothing', async () => {
        await notifyProfileAddition(state.db as never, { adopterId: 'ad1', actor: STRANGER, add: {}, op: 'test' });
        await notifyProfileAddition(state.db as never, { adopterId: 'ad1', actor: 'anonymous', add: { photos: 1 }, op: 'test' });
        expect(notices()).toEqual([]);
    });

    it('a failure never throws (the save already landed): logged', async () => {
        const { logger } = await import('@/lib/logger');
        const warn = vi.spyOn(logger, 'warn');
        await expect(notifyProfileAddition({ select: () => { throw new Error('db down'); } } as never, { adopterId: 'ad1', actor: STRANGER, add: { photos: 1 }, op: 'test' })).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('profileAdditionNotices'), expect.objectContaining({ adopterId: 'ad1', actor: STRANGER }));
    });
});
