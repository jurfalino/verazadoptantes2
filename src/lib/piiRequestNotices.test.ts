/** «Answer once, cleared everywhere» for contact-access requests — on the real schema (json_extract). */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { unreadNotices, type Sqlite } from '@/test-utils/applicationFixtures';

vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
}));

import { clearPiiRequestNotices } from './piiRequestNotices';
import { logger } from '@/lib/logger';

let sqlite: Sqlite;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the Db union getDb() returns
let db: any;

const notice = (id: string, userId: string, type: string, metadata: unknown) =>
    sqlite.prepare(`INSERT INTO notifications (id, user_id, type, title, body, url, read, metadata) VALUES (?, ?, ?, 't', 'b', '/adopter/p1', 0, ?)`)
        .run(id, userId, type, typeof metadata === 'string' ? metadata : JSON.stringify(metadata));

beforeEach(() => {
    const m = migratedDb();
    sqlite = m.sqlite as unknown as Sqlite;
    db = m.db;
    vi.mocked(logger.warn).mockClear();
    // r1: the owner's and an editor's copy. r2: another request on the same profile.
    notice('n-owner', 'owner@example.com', 'pii_access_request', { adopterId: 'p1', requestId: 'r1' });
    notice('n-editor', 'editor@example.com', 'pii_access_request', { adopterId: 'p1', requestId: 'r1' });
    notice('n-other', 'owner@example.com', 'pii_access_request', { adopterId: 'p1', requestId: 'r2' });
    // The requester's answer carries the same requestId — it must stay unread.
    notice('n-answer', 'stranger@example.com', 'pii_access_approved', { adopterId: 'p1', requestId: 'r1' });
});

describe('clearPiiRequestNotices', () => {
    it("every approver's copy of the request is read; other requests and the requester's answer untouched", async () => {
        await clearPiiRequestNotices(db, 'r1', { adopterId: 'p1' });
        expect(unreadNotices(sqlite)).toEqual(['n-answer', 'n-other']);
    });

    it('a broken metadata row is skipped — the request\'s notices still clear', async () => {
        notice('bad', 'x@example.com', 'pii_access_request', 'not json');
        await clearPiiRequestNotices(db, 'r1');
        expect(unreadNotices(sqlite)).toEqual(['bad', 'n-answer', 'n-other']);
    });

    it('no request id: nothing changes', async () => {
        await clearPiiRequestNotices(db, '');
        expect(unreadNotices(sqlite)).toEqual(['n-answer', 'n-editor', 'n-other', 'n-owner']);
    });

    it('never throws: a failure is logged with its context and the answer stands', async () => {
        await expect(clearPiiRequestNotices({ update: () => { throw new Error('D1 down'); } }, 'r1', { adopterId: 'p1', actor: 'owner@example.com' }))
            .resolves.toBeUndefined();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('clearPiiRequestNotices'),
            expect.objectContaining({ requestId: 'r1', adopterId: 'p1', actor: 'owner@example.com', error: 'D1 down' }));
    });
});
