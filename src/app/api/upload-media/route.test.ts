/**
 * /api/upload-media (videos from the gallery and the record wizard): the
 * owner's team hears about the video like a photo — profile_content_added.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { OWNER, MATE, STRANGER } from '@/test-utils/actionMocks';
import * as mocks from '@/test-utils/actionMocks';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown, user: null as string | null } }));
vi.mock('@/auth', () => ({ auth: async () => (state.user ? { user: { email: state.user } } : null) }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/r2', () => ({ uploadToR2: vi.fn(async (key: string) => `https://r2.example/${key}`) }));
vi.mock('@/lib/orgMembership', () => ({ isOrgMate: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor }));
vi.mock('@/config/features', () => ({ getFeatureFlag: async () => true }));
vi.mock('@/lib/notificationEmail', () => ({ sendNotificationEmail: vi.fn(async () => 'sent') }));

import { POST } from './route';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { all: (...a: unknown[]) => Row[]; run: (...a: unknown[]) => unknown } };

// An MP4 header (ftyp box) — the route checks magic bytes.
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
function upload(adopterId: string) {
    const fd = new FormData();
    fd.append('file', new File([MP4], 'clip.mp4', { type: 'video/mp4' }));
    fd.append('adopterId', adopterId);
    fd.append('mediaType', 'video');
    return POST(new Request('http://x/api/upload-media', { method: 'POST', body: fd }));
}

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('ad1', 'Marta Paez', '5', ?, 1, 1)`).run(OWNER);
    sqlite.prepare(`INSERT INTO user (id, email, name) VALUES ('u-ana', ?, 'Ana')`).run(STRANGER);
});

describe('POST /api/upload-media', () => {
    it('an outsider\'s video tells the owner\'s team', async () => {
        state.user = STRANGER;
        expect((await upload('ad1')).status).toBe(200);
        expect(sqlite.prepare(`SELECT user_id, body FROM notifications WHERE type = 'profile_content_added' ORDER BY user_id`).all())
            .toEqual([{ user_id: MATE, body: 'Ana agregó un video a Marta Paez.' }, { user_id: OWNER, body: 'Ana agregó un video a Marta Paez.' }]);
    });

    it('the owner\'s own video tells nobody', async () => {
        state.user = OWNER;
        expect((await upload('ad1')).status).toBe(200);
        expect(sqlite.prepare(`SELECT * FROM notifications`).all()).toEqual([]);
    });
});
