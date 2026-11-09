/**
 * The write paths that tell the owner's team what was added to a profile
 * (profile_content_added): saveAdoption (create; an edit that places a record
 * on the profile or gives it a delivery address) and saveImage. The import's
 * door (saveRecordFor with notifyOwnerTeam: false) tells nobody. Real SQL on
 * the real schema.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { session, getUser, isAdmin, OWNER, MATE, STRANGER } from '@/test-utils/actionMocks';
import * as mocks from '@/test-utils/actionMocks';

const { state, emails } = vi.hoisted(() => ({ state: { db: null as unknown }, emails: [] as unknown[] }));
vi.mock('./_db', () => ({ getDb: async () => state.db, getUser, checkIsAdminAsync: isAdmin }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/config/admins', () => ({ isAdminAsync: isAdmin, isModeratorOrAdminAsync: isAdmin }));
vi.mock('@/lib/orgMembership', () => ({ isOrgMate: mocks.isOrgMate, isOwnerOrOrgMate: mocks.isOwnerOrOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor }));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn(async () => undefined) }));
vi.mock('@/lib/pendingSearchLog', () => ({ closePendingSearchesForAdopter: vi.fn(async () => undefined) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/r2', () => ({ processImageForStorage: vi.fn(async (url: string) => url) }));
vi.mock('@/config/features', () => ({ getFeatureFlag: async () => true }));
vi.mock('@/lib/notificationEmail', () => ({ sendNotificationEmail: vi.fn(async (n: unknown) => { emails.push(n); return 'sent'; }) }));

import { saveAdoption } from './adoptions';
import { saveImage } from './images';
import { saveRecordFor } from '@/lib/recordSave';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; all: (...a: unknown[]) => Row[]; run: (...a: unknown[]) => unknown } };

const notices = () => sqlite.prepare(`SELECT user_id, body FROM notifications WHERE type = 'profile_content_added' ORDER BY user_id`).all().map(n => [n.user_id, n.body]);
const MAIPU = 'Av. Maipú 1200, Vicente López';
const PHOTO = 'data:image/jpeg;base64,AAAA';

async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
    const before = session.user;
    session.user = user;
    try { return await fn(); } finally { session.user = before; }
}

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    emails.length = 0;
    session.user = OWNER;
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('ad1', 'Marta Paez', '5', ?, 1, 1)`).run(OWNER);
    sqlite.prepare(`INSERT INTO user (id, email, name) VALUES ('u-ana', ?, 'Ana')`).run(STRANGER);
});

describe('saveAdoption tells the owner\'s team what an outsider added', () => {
    it('a record with a rating, its delivery address and 3 photos: ONE notice to each of the owner team', async () => {
        const res = await as(STRANGER, () => saveAdoption({ adopterId: 'ad1', recordType: 'adoption', animalName: 'Luna', species: 'cat', rating: 4, deliveredToHome: 1, verifiedAddress: MAIPU } as never));
        await as(STRANGER, () => Promise.all([1, 2, 3].map(() => saveImage('ad1', PHOTO, 'Photo for Luna', res.id, 'image', false, 'placement'))));
        expect(notices()).toEqual([
            [MATE, 'Ana agregó un registro (Adopción, 4★), 3 fotos y una dirección de entrega a Marta Paez.'],
            [OWNER, 'Ana agregó un registro (Adopción, 4★), 3 fotos y una dirección de entrega a Marta Paez.'],
        ]);
        // The address itself never reaches a notice.
        expect(JSON.stringify(sqlite.prepare(`SELECT * FROM notifications`).all())).not.toContain('Maipú');
        expect(emails).toHaveLength(2);
    });

    it('photos alone (the gallery): one notice', async () => {
        await as(STRANGER, async () => { await saveImage('ad1', PHOTO, 'Uploaded Image'); await saveImage('ad1', PHOTO, 'Uploaded Image'); });
        expect(notices()).toEqual([[MATE, 'Ana agregó 2 fotos a Marta Paez.'], [OWNER, 'Ana agregó 2 fotos a Marta Paez.']]);
    });

    it('a teammate\'s add with the default «Otros rescatistas»: nobody; the owner\'s own add: nobody', async () => {
        await as(MATE, () => saveAdoption({ adopterId: 'ad1', recordType: 'observation', rating: 2 } as never));
        await as(MATE, () => saveImage('ad1', PHOTO, 'Uploaded Image'));
        await as(OWNER, () => saveAdoption({ adopterId: 'ad1', recordType: 'observation' } as never));
        expect(notices()).toEqual([]);
    });

    it('the import\'s door (notifyOwnerTeam: false) tells nobody; the record still lands', async () => {
        await as(STRANGER, () => saveRecordFor({ adopterId: 'ad1', recordType: 'adoption', animalName: 'Luna', rating: 5 } as never, undefined, { notifyOwnerTeam: false }));
        expect(notices()).toEqual([]);
        expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM placements WHERE adopter_id = 'ad1'`).get()!.n).toBe(1);
    });

    it('a record not on any profile (an available animal) tells nobody', async () => {
        await as(STRANGER, () => saveAdoption({ recordType: 'available', animalName: 'Luna', species: 'cat' } as never));
        expect(notices()).toEqual([]);
    });

    it('edit: delivering an outsider\'s own adoption home later tells the team about the address — once, not on a re-save', async () => {
        const res = await as(STRANGER, () => saveAdoption({ adopterId: 'ad1', recordType: 'adoption', animalName: 'Luna', species: 'cat' } as never));
        sqlite.prepare(`DELETE FROM notifications`).run();
        await as(STRANGER, () => saveAdoption({ id: res.id, deliveredToHome: 1, verifiedAddress: MAIPU } as never, { loaded: { deliveredToHome: 0, verifiedAddress: null } }));
        expect(notices()).toEqual([[MATE, 'Ana agregó una dirección de entrega a Marta Paez.'], [OWNER, 'Ana agregó una dirección de entrega a Marta Paez.']]);
        sqlite.prepare(`DELETE FROM notifications`).run();
        await as(STRANGER, () => saveAdoption({ id: res.id, comments: 'Todo bien' } as never, { loaded: { comments: null } }));
        expect(notices()).toEqual([]);
    });

    it('edit: placing one\'s available animal with the profile is adding a record to it', async () => {
        const res = await as(STRANGER, () => saveAdoption({ recordType: 'available', animalName: 'Luna', species: 'cat' } as never));
        await as(STRANGER, () => saveAdoption({ id: res.id, adopterId: 'ad1', recordType: 'adoption', rating: 3 } as never, { loaded: { adopterId: null, recordType: 'available' } }));
        expect(notices()).toEqual([[MATE, 'Ana agregó un registro (Adopción, 3★) a Marta Paez.'], [OWNER, 'Ana agregó un registro (Adopción, 3★) a Marta Paez.']]);
    });

    it('an animal photo keyed on the owner\'s email or «__available__» tells nobody', async () => {
        await as(STRANGER, () => saveImage('__available__', PHOTO, 'Photo', undefined, 'image', false, 'animal'));
        expect(notices()).toEqual([]);
    });
});
