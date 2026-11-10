/** Check-up reminders clear once every check-up they list is registered — on real SQLite (json_each). */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { clearDoneFollowupNotices, followupNoticeItems } from './followupNotices';

let sqlite: Database.Database;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the Db union getDb() returns
let db: any;
const add = (id: string, userId: string, metadata: object) =>
    sqlite.prepare(`INSERT INTO notifications (id, user_id, type, title, body, read, metadata) VALUES (?, ?, 'follow_up_due', 't', 'b', 0, ?)`).run(id, userId, JSON.stringify(metadata));
const unread = () => (sqlite.prepare('SELECT id FROM notifications WHERE read = 0 ORDER BY id').all() as Array<{ id: string }>).map(r => r.id);
const checkIn = (animalId: string, placementId: string, key: string) =>
    sqlite.prepare(`INSERT INTO adopter_events (id, adopter_id, event_type, animal_id, placement_id, followup_key) VALUES (?, 'ad', 'follow_up', ?, ?, ?)`).run(crypto.randomUUID(), animalId, placementId, key);
const care = (animalId: string, key: string) =>
    sqlite.prepare(`INSERT INTO animal_events (id, animal_id, event_type, followup_key) VALUES (?, ?, 'vaccination', ?)`).run(crypto.randomUUID(), animalId, key);

beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
        CREATE TABLE notifications (id TEXT PRIMARY KEY, user_id TEXT, type TEXT, title TEXT, body TEXT, url TEXT, icon TEXT,
            read INTEGER DEFAULT 0, dismissed INTEGER DEFAULT 0, metadata TEXT, created_at INTEGER, expires_at INTEGER, emailed_at INTEGER);
        CREATE TABLE adopter_events (id TEXT PRIMARY KEY, adopter_id TEXT, event_type TEXT, animal_id TEXT, placement_id TEXT, followup_key TEXT);
        CREATE TABLE animal_events (id TEXT PRIMARY KEY, animal_id TEXT, event_type TEXT, followup_key TEXT, placement_id TEXT);
    `);
    db = drizzle(sqlite);
    // Ana's bundle: Sol's 6-month check-in + Sol's vaccine; Bea (teammate) got the same bundle.
    const bundle = { items: [
        { dedupKey: 'k1', placementId: 'p-sol', animalId: 'sol', followupKey: 'checkin_180d' },
        { dedupKey: 'k2', placementId: 'p-sol', animalId: 'sol', followupKey: 'health_vaccines' },
    ] };
    add('ana-bundle', 'ana@x.org', bundle);
    add('bea-bundle', 'bea@x.org', bundle);
    // A notice from before the bundle (one check-up at the top level).
    add('old-single', 'ana@x.org', { dedupKey: 'k3', placementId: 'p-poti', animalId: 'poti', followupKey: 'health_neuter' });
});

describe('clearDoneFollowupNotices', () => {
    it('one of two check-ups registered: the bundle stays unread', async () => {
        checkIn('sol', 'p-sol', 'checkin_180d');
        await clearDoneFollowupNotices(db, 'sol');
        expect(unread()).toEqual(['ana-bundle', 'bea-bundle', 'old-single']);
    });

    it('both registered (check-in + health): the bundle is read for the whole team', async () => {
        checkIn('sol', 'p-sol', 'checkin_180d');
        care('sol', 'health_vaccines');
        await clearDoneFollowupNotices(db, 'sol');
        expect(unread()).toEqual(['old-single']);
    });

    it('notices from before the bundle clear too', async () => {
        care('poti', 'health_neuter');
        await clearDoneFollowupNotices(db, 'poti');
        expect(unread()).toEqual(['ana-bundle', 'bea-bundle']);
    });

    it('a check-in logged for another placement of the animal doesn\'t count', async () => {
        checkIn('sol', 'p-old', 'checkin_180d');
        care('sol', 'health_vaccines');
        await clearDoneFollowupNotices(db, 'sol');
        expect(unread()).toContain('ana-bundle');
    });

    it('reads both metadata shapes; garbage is no items', () => {
        expect(followupNoticeItems('{"animalId":"a","followupKey":"k"}')).toEqual([{ animalId: 'a', placementId: null, followupKey: 'k' }]);
        expect(followupNoticeItems('nope')).toEqual([]);
    });
});
