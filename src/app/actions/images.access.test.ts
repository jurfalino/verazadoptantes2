/**
 * getAdoptionImages: signed-in only, and only the fields the UI renders.
 * setProfilePicture: the image must belong to the adopter being edited.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { session, getUser, isAdmin, isOrgMate, isOwnerOrOrgMate, OWNER, STRANGER } from '@/test-utils/actionMocks';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));
vi.mock('./_db', () => ({ getDb: async () => state.db, getUser }));
vi.mock('@/config/admins', () => ({ isAdminAsync: isAdmin, isModeratorOrAdminAsync: isAdmin }));
vi.mock('@/lib/orgMembership', () => ({ isOrgMate, isOwnerOrOrgMate }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/r2', () => ({ processImageForStorage: vi.fn() }));

import { getAdoptionImages, setProfilePicture } from './images';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown } };

function seed() {
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('ad1', 'Carla', '5', ?, 1, 1), ('ad2', 'Otra', '5', ?, 1, 1)`).run(OWNER, STRANGER);
    sqlite.prepare(`INSERT INTO adopter_images (id, adopter_id, adoption_id, url, caption, added_by, scope, is_profile_picture)
        VALUES ('img-placement', 'ad1', 'an1', 'https://r2.example/p.jpg', 'En casa', 'uploader@example.com', 'placement', 0),
               ('img-ad1', 'ad1', NULL, 'https://r2.example/a.jpg', NULL, ?, NULL, 0),
               ('img-ad2', 'ad2', NULL, 'https://r2.example/b.jpg', NULL, ?, NULL, 0)`).run(OWNER, STRANGER);
}

describe('getAdoptionImages', () => {
    beforeEach(() => { const m = migratedDb(); state.db = m.db; sqlite = m.sqlite as unknown as typeof sqlite; seed(); });

    it('anonymous: nothing — placement photos are never public', async () => {
        session.user = null;
        expect(await getAdoptionImages('an1')).toEqual([]);
    });

    it('signed-in: the photos, with only the fields the history/editor render', async () => {
        session.user = STRANGER;
        const imgs = await getAdoptionImages('an1') as Array<Record<string, unknown>>;
        expect(imgs).toHaveLength(1);
        expect(Object.keys(imgs[0]).sort()).toEqual(['caption', 'id', 'mediaType', 'thumbnailUrl', 'url']);
    });
});

describe('setProfilePicture', () => {
    beforeEach(() => { const m = migratedDb(); state.db = m.db; sqlite = m.sqlite as unknown as typeof sqlite; seed(); session.user = OWNER; });
    const pic = (id: string) => sqlite.prepare('SELECT is_profile_picture AS p FROM adopter_images WHERE id = ?').get(id)!.p;

    it('the owner can set one of the adopter\'s own photos', async () => {
        await setProfilePicture('ad1', 'img-ad1');
        expect(pic('img-ad1')).toBe(1);
    });

    it('another adopter\'s photo is refused and left untouched', async () => {
        await expect(setProfilePicture('ad1', 'img-ad2')).rejects.toThrow(/Error ID/);
        expect(pic('img-ad2')).toBe(0);
    });
});
