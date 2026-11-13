/**
 * «Escribirle»: a short message between the two sides of a merge request,
 * delivered as a bell notification (the email twin carries reply_to). Real SQL;
 * session / team / notifications mocked like the other action tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { OWNER, MATE, STRANGER } = mocks;
const REQUESTER = STRANGER;

const { state, notify, logs } = vi.hoisted(() => ({
    state: { db: null as unknown },
    notify: { create: [] as Array<Record<string, unknown>>, result: 'n' as string | null, throws: false },
    logs: { warn: [] as Array<[string, Record<string, unknown>]>, error: [] as Array<[string, Record<string, unknown>]> },
}));

vi.mock('./_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOwnerOrOrgMate: mocks.isOwnerOrOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
}));
vi.mock('@/app/actions/notifications', () => ({
    createNotification: vi.fn(async (d: Record<string, unknown>) => {
        if (notify.throws) throw new Error('D1 down');
        notify.create.push(d);
        return notify.result;
    }),
    resolveDisplayName: vi.fn(async (email: string) => email.split('@')[0]),
}));
vi.mock('@/lib/logger', () => ({
    logger: {
        warn: vi.fn((m: string, ctx: Record<string, unknown>) => { logs.warn.push([m, ctx]); }),
        info: vi.fn(), debug: vi.fn(),
        error: vi.fn((m: string, _e: unknown, ctx: Record<string, unknown>) => { logs.error.push([m, ctx]); return 'err12345'; }),
    },
    generateErrorId: () => 'gen12345',
}));

import { sendPairMessage } from './pairMessages';
import { pairKey } from '@/domain/dedupPair';

type Sqlite = { prepare: (s: string) => { run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Record<string, unknown>[] }; exec: (s: string) => void };
let sqlite: Sqlite;

function addRequest(id: string, status: string, owner: string | null = OWNER) {
    sqlite.prepare(`INSERT INTO merge_requests (id, primary_id, secondary_id, requester_email, owner_email, status, created_at) VALUES (?, 'r-old', 'o-new', ?, ?, ?, 1)`)
        .run(id, REQUESTER, owner, status);
}

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as Sqlite;
    notify.create.length = 0;
    notify.result = 'n';
    notify.throws = false;
    logs.warn.length = 0;
    logs.error.length = 0;
    mocks.session.user = REQUESTER;
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES
        ('r-old', 'Carla Gómez', '5', ?, 1000, 1000), ('o-new', 'Carla Gomez', '5', ?, 2000, 2000)`).run(REQUESTER, OWNER);
    addRequest('declined-1', 'declined');
    addRequest('pending-1', 'pending');
    addRequest('accepted-1', 'accepted');
    addRequest('admin-1', 'pending', null);
});

describe('sendPairMessage', () => {
    it('requester on a declined request: the owner team is notified, never the sender, and no address comes back', async () => {
        const res = await sendPairMessage('declined-1', '  Hola, es la misma persona  ');
        expect(res).toEqual({ success: true });
        expect(JSON.stringify(res)).not.toContain('@');
        expect(notify.create.map(n => n.userId).sort()).toEqual([MATE, OWNER]);
        const n = notify.create[0];
        expect(n).toMatchObject({
            type: 'pair_message', body: 'Hola, es la misma persona', url: `/my-adopters?pair=${encodeURIComponent('o-new|r-old')}#pendientes`,
            title: 'stranger te escribió sobre «Carla Gómez»',
            metadata: { requestId: 'declined-1', replyTo: REQUESTER, fromName: 'stranger' },
            template: { key: 'pair_message', params: { fromName: 'stranger', profileName: 'Carla Gómez', message: 'Hola, es la misma persona' } },
        });
    });

    it('owner on a pending request: only the requester is notified', async () => {
        mocks.session.user = MATE;
        expect(await sendPairMessage('pending-1', 'Hola')).toEqual({ success: true });
        expect(notify.create.map(n => n.userId)).toEqual([REQUESTER]);
        expect(notify.create[0].metadata).toMatchObject({ replyTo: MATE });
    });

    it('«Te escribió» opens the pair, as a «posible duplicado» notice does (?pair=, CX review I3)', async () => {
        mocks.session.user = MATE;
        expect(await sendPairMessage('pending-1', 'Hola')).toEqual({ success: true });
        const url = new URL(String(notify.create[0].url), 'https://x.test');
        expect(url.pathname).toBe('/my-adopters');
        expect(url.searchParams.get('pair')).toBe(pairKey('r-old', 'o-new'));
        expect(url.hash).toBe('#pendientes');
    });

    it('a stranger is refused and logged', async () => {
        mocks.session.user = 'nosy@example.com';
        const res = await sendPairMessage('declined-1', 'Hola');
        expect(res).toMatchObject({ success: false, error: 'not_allowed' });
        expect(notify.create).toEqual([]);
        expect(logs.warn[0][1]).toMatchObject({ requestId: 'declined-1', actor: 'nosy@example.com', reason: 'not_allowed' });
    });

    it('a plain possible duplicate (no request) is refused', async () => {
        expect(await sendPairMessage('cand-1', 'Hola')).toMatchObject({ success: false, error: 'not_found' });
        expect(notify.create).toEqual([]);
    });

    it('refuses answered requests, admin-owned requests, bad text and anonymous', async () => {
        expect(await sendPairMessage('accepted-1', 'Hola')).toMatchObject({ success: false, error: 'not_open' });
        expect(await sendPairMessage('admin-1', 'Hola')).toMatchObject({ success: false, error: 'no_recipient' });
        expect(await sendPairMessage('declined-1', '   ')).toMatchObject({ success: false, error: 'invalid' });
        expect(await sendPairMessage('declined-1', 'x'.repeat(1001))).toMatchObject({ success: false, error: 'invalid' });
        expect(await sendPairMessage('declined-1', 'x'.repeat(1000))).toEqual({ success: true });
        notify.create.length = 0;
        mocks.session.user = null;
        expect(await sendPairMessage('declined-1', 'Hola')).toMatchObject({ success: false, error: 'unauthenticated' });
        expect(notify.create).toEqual([]);
    });
});

const stored = () => sqlite.prepare('SELECT request_id, sender_email, sender_name, body FROM pair_messages ORDER BY created_at, id').all();

describe('sendPairMessage — the message lives on the pair (2026-11-11)', () => {
    it('one row per message (not per recipient), then the notices carry its id', async () => {
        expect(await sendPairMessage('declined-1', '  Hola, es la misma persona  ')).toEqual({ success: true });
        expect(stored()).toEqual([{ request_id: 'declined-1', sender_email: REQUESTER, sender_name: 'stranger', body: 'Hola, es la misma persona' }]);
        const [{ id }] = sqlite.prepare('SELECT id FROM pair_messages').all();
        expect(notify.create).toHaveLength(2);
        for (const n of notify.create) expect(n.metadata).toMatchObject({ requestId: 'declined-1', messageId: id });
    });

    it('the row can\'t be written: the send fails with a logged errorId and nobody is notified', async () => {
        sqlite.prepare('DROP TABLE pair_messages').run();
        const res = await sendPairMessage('declined-1', 'Hola');
        expect(res).toEqual({ success: false, error: 'failed', errorId: 'err12345' });
        expect(notify.create).toEqual([]);
        expect(logs.error[0]).toEqual(['sendPairMessage: message not saved', expect.objectContaining({ requestId: 'declined-1', actor: REQUESTER })]);
        // The text itself is never logged.
        expect(JSON.stringify(logs)).not.toContain('Hola');
    });

    it('the notices fail after the row is written: still a success, logged', async () => {
        notify.result = null;
        expect(await sendPairMessage('declined-1', 'Hola')).toEqual({ success: true });
        expect(stored()).toHaveLength(1);
        expect(logs.warn).toContainEqual(['sendPairMessage: message saved, some notices not sent', expect.objectContaining({ requestId: 'declined-1', notSent: 2 })]);
        notify.throws = true;
        expect(await sendPairMessage('declined-1', 'Otra vez')).toEqual({ success: true });
        expect(stored()).toHaveLength(2);
        expect(logs.warn.some(([m]) => m === 'sendPairMessage: message saved, notices failed')).toBe(true);
        expect(JSON.stringify(logs)).not.toContain('Otra vez');
    });
});

describe('migration 0108 — messages already sent are copied once', () => {
    const notice = (id: string, user: string, createdAt: number, meta: Record<string, unknown> | string, body = 'Hola') =>
        sqlite.prepare(`INSERT INTO notifications (id, user_id, type, title, body, metadata, created_at) VALUES (?, ?, 'pair_message', 't', ?, ?, ?)`)
            .run(id, user, body, typeof meta === 'string' ? meta : JSON.stringify(meta), createdAt);
    const backfill = () => {
        const sql = readFileSync(resolve(process.cwd(), 'drizzle/0108_pair_messages.sql'), 'utf8').replace(/--.*$/gm, '');
        sqlite.exec(sql.split(';').map(x => x.trim()).find(x => x.startsWith('INSERT'))!);
    };
    const msg = (requestId: string, replyTo: string, message: string) =>
        ({ requestId, replyTo, fromName: 'Marta', template: { key: 'pair_message', params: { fromName: 'Marta', message } } });

    it('one row per message, not per recipient; a minute apart are two messages; re-running adds nothing', async () => {
        notice('n1', OWNER, 1000, msg('declined-1', 'Marta@X.org', 'Hola'));
        notice('n2', MATE, 1001, msg('declined-1', 'marta@x.org', 'Hola'));
        notice('n3', OWNER, 1100, msg('declined-1', 'marta@x.org', 'Hola'));
        notice('n4', OWNER, 1000, msg('declined-1', 'marta@x.org', 'Otra cosa'), 'Otra cosa');
        notice('n5', OWNER, 1000, msg('pending-1', 'marta@x.org', 'Hola'));
        backfill();
        backfill();
        expect(sqlite.prepare('SELECT id, request_id, sender_email, sender_name, body, created_at FROM pair_messages ORDER BY id').all()).toEqual([
            { id: 'pm-n1', request_id: 'declined-1', sender_email: 'marta@x.org', sender_name: 'Marta', body: 'Hola', created_at: 1000 },
            { id: 'pm-n3', request_id: 'declined-1', sender_email: 'marta@x.org', sender_name: 'Marta', body: 'Hola', created_at: 1100 },
            { id: 'pm-n4', request_id: 'declined-1', sender_email: 'marta@x.org', sender_name: 'Marta', body: 'Otra cosa', created_at: 1000 },
            { id: 'pm-n5', request_id: 'pending-1', sender_email: 'marta@x.org', sender_name: 'Marta', body: 'Hola', created_at: 1000 },
        ]);
    });

    it('skips notices with no request or sender, broken metadata, and ones the new code wrote (they carry messageId)', async () => {
        notice('a', OWNER, 1, { replyTo: 'marta@x.org' });
        notice('b', OWNER, 1, { requestId: 'declined-1' });
        notice('c', OWNER, 1, '{oops');
        await sendPairMessage('declined-1', 'Nuevo');
        backfill();
        expect(stored()).toEqual([{ request_id: 'declined-1', sender_email: REQUESTER, sender_name: 'stranger', body: 'Nuevo' }]);
    });

    it('no template in the metadata: the notice body is the text', async () => {
        notice('n1', OWNER, 5, { requestId: 'declined-1', replyTo: 'marta@x.org' }, 'Texto guardado');
        backfill();
        expect(stored()).toEqual([{ request_id: 'declined-1', sender_email: 'marta@x.org', sender_name: null, body: 'Texto guardado' }]);
    });
});
