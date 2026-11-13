/** «Answer once, cleared everywhere» for form notices — on the real schema (json_extract). */
import { describe, it, expect, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { formNotice, unreadNotices, type Sqlite } from '@/test-utils/applicationFixtures';
import { clearFormNotices } from './formNotices';

let sqlite: Sqlite;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the Db union getDb() returns
let db: any;

beforeEach(() => {
    const m = migratedDb();
    sqlite = m.sqlite as unknown as Sqlite;
    db = m.db;
    formNotice(sqlite, 'n-owner', 'owner@example.com', 's1');
    formNotice(sqlite, 'n-mate', 'mate@example.com', 's1');
    formNotice(sqlite, 'n-other', 'owner@example.com', 's2');
    formNotice(sqlite, 'n-type', 'owner@example.com', 's1', 'contract_result');
});

describe('clearFormNotices', () => {
    it('every form notice about the submission is read — the owner\'s and the teammates\' copies; other forms and types untouched', async () => {
        await clearFormNotices(db, 's1');
        expect(unreadNotices(sqlite)).toEqual(['n-other', 'n-type']);
    });

    it('a broken metadata row is skipped — the form\'s notices still clear', async () => {
        sqlite.prepare(`INSERT INTO notifications (id, user_id, type, title, body, read, metadata) VALUES ('bad', 'x', 'form_submission', 't', 'b', 0, 'not json')`).run();
        await clearFormNotices(db, 's1');
        expect(unreadNotices(sqlite)).toEqual(['bad', 'n-other', 'n-type']);
    });

    it('never throws: a failure is logged and the answer stands', async () => {
        await expect(clearFormNotices({ update: () => { throw new Error('D1 down'); } }, 's1', { applicationId: 'a' })).resolves.toBeUndefined();
    });
});
