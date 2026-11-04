/**
 * «Escribirle»: a short message between the two sides of a merge request,
 * delivered as a bell notification (the email twin carries reply_to). Real SQL;
 * session / team / notifications mocked like the other action tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { OWNER, MATE, STRANGER } = mocks;
const REQUESTER = STRANGER;

const { state, notify, logs } = vi.hoisted(() => ({
    state: { db: null as unknown },
    notify: { create: [] as Array<Record<string, unknown>> },
    logs: { warn: [] as Array<[string, Record<string, unknown>]> },
}));

vi.mock('./_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOwnerOrOrgMate: mocks.isOwnerOrOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
}));
vi.mock('@/app/actions/notifications', () => ({
    createNotification: vi.fn(async (d: Record<string, unknown>) => { notify.create.push(d); return 'n'; }),
    resolveDisplayName: vi.fn(async (email: string) => email.split('@')[0]),
}));
vi.mock('@/lib/logger', () => ({
    logger: {
        warn: vi.fn((m: string, ctx: Record<string, unknown>) => { logs.warn.push([m, ctx]); }),
        info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345'),
    },
    generateErrorId: () => 'gen12345',
}));

import { sendPairMessage } from './pairMessages';

type Sqlite = { prepare: (s: string) => { run: (...a: unknown[]) => unknown } };
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
    logs.warn.length = 0;
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
            type: 'pair_message', body: 'Hola, es la misma persona', url: '/my-adopters#pendientes',
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
