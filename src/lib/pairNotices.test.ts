/** «Answer once, cleared everywhere» for pair notices — on real SQLite (json_extract). */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { clearPairNotices, PAIR_NOTICE_TYPES } from './pairNotices';

let sqlite: Database.Database;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the Db union getDb() returns
let db: any;
const add = (id: string, userId: string, type: string, metadata: object) =>
    sqlite.prepare(`INSERT INTO notifications (id, user_id, type, title, body, read, metadata) VALUES (?, ?, ?, 't', 'b', 0, ?)`).run(id, userId, type, JSON.stringify(metadata));
const unread = () => (sqlite.prepare('SELECT id FROM notifications WHERE read = 0 ORDER BY id').all() as Array<{ id: string }>).map(r => r.id);

beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`CREATE TABLE notifications (id TEXT PRIMARY KEY, user_id TEXT, type TEXT, title TEXT, body TEXT, url TEXT, icon TEXT,
        read INTEGER DEFAULT 0, dismissed INTEGER DEFAULT 0, metadata TEXT, created_at INTEGER, expires_at INTEGER, emailed_at INTEGER)`);
    db = drizzle(sqlite);
    add('req-ana', 'ana@x.org', 'merge_request', { mergeRequestId: 'r1', primaryId: 'A', secondaryId: 'B' });
    add('req-bea', 'bea@x.org', 'merge_request', { mergeRequestId: 'r1', primaryId: 'A', secondaryId: 'B' });
    add('flag', 'ana@x.org', 'duplicate_flagged', { adopterId: 'B', targetAdopterId: 'A' });
    add('declined', 'cam@x.org', 'merge_request_resolved', { status: 'declined', primaryId: 'A', secondaryId: 'B' });
    add('other-pair', 'ana@x.org', 'merge_request', { primaryId: 'A', secondaryId: 'C' });
    add('form', 'ana@x.org', 'form_submission', { primaryId: 'A', secondaryId: 'B' });
});

describe('clearPairNotices', () => {
    it('a settled pair: every pair notice about it is read, for everyone, in either orientation and naming', async () => {
        await clearPairNotices(db, 'B', 'A', { types: PAIR_NOTICE_TYPES });
        expect(unread()).toEqual(['form', 'other-pair']);
    });

    it('an answered request clears only the «te pide unir» notices (the requester\'s new answer notice stays)', async () => {
        await clearPairNotices(db, 'A', 'B', { types: ['merge_request'] });
        expect(unread()).toEqual(['declined', 'flag', 'form', 'other-pair']);
    });

    it('hiding is personal: only that person\'s «rechazó» notice', async () => {
        await clearPairNotices(db, 'A', 'B', { types: ['merge_request_resolved'], userId: 'CAM@x.org ' });
        expect(unread()).toEqual(['flag', 'form', 'other-pair', 'req-ana', 'req-bea']);
    });

    it('a broken metadata row never breaks the answer', async () => {
        sqlite.prepare(`INSERT INTO notifications (id, user_id, type, title, body, read, metadata) VALUES ('bad', 'x', 'merge_request', 't', 'b', 0, 'not json')`).run();
        await expect(clearPairNotices(db, 'A', 'B', { types: PAIR_NOTICE_TYPES })).resolves.toBeUndefined();
    });
});
