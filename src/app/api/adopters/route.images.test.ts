/**
 * F1: POST /api/adopters (the post import's «Guardar perfil») never drops a big
 * screenshot without a word. Over the inline cap it goes to R2; one that still
 * can't be stored is counted in the response, for the wizard's notice. Real route, real SQL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

const { state, r2 } = vi.hoisted(() => ({
    state: { db: null as unknown },
    r2: { store: vi.fn(), process: vi.fn() },
}));

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { email: 'rescuer@example.com', name: 'Rescuer' } })) }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: async () => 'rescuer@example.com' }));
vi.mock('@/config/features', async (orig) => ({ ...(await orig()), getFeatureFlag: vi.fn(async () => false) }));
vi.mock('@/config/admins', () => ({ isAdminAsync: async () => false, isModeratorOrAdminAsync: async () => false, isAdmin: () => false }));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async () => undefined) }));
vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: {} }) }));
vi.mock('@/lib/r2', () => ({
    MAX_INLINE_IMAGE_DATA_URL: 500_000,
    processImageForStorage: r2.process,
    storeLargeImageDataUrl: r2.store,
    uploadToR2: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: (_n: string, fn: () => unknown) => fn(),
}));

import { POST } from './route';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; all: (...a: unknown[]) => Row[] } };

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    r2.store.mockReset();
    r2.process.mockReset();
    r2.process.mockImplementation(async (url: string) => url);
});

const small = { data: 'c21hbGw=', mimeType: 'image/jpeg' };
const big = { data: 'A'.repeat(600_000), mimeType: 'image/png' };
const save = (images: unknown[]) => POST(new Request('http://localhost/api/adopters', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Juan Pérez', images }),
}));
const urlsOf = (id: string) => sqlite.prepare('SELECT url FROM adopter_images WHERE adopter_id = ? ORDER BY caption').all(id).map(r => r.url);

describe('POST /api/adopters — big screenshots (F1)', () => {
    it('a screenshot over the inline cap goes to R2 and is saved, next to the small one', async () => {
        r2.store.mockResolvedValue('https://r2.example/adopters/x/big.png');
        const res = await save([small, big]);
        const json = await res.json() as { id: string; imagesNotSaved?: number };
        expect(res.status).toBe(200);
        expect(json.imagesNotSaved).toBeUndefined();
        expect(urlsOf(json.id)).toEqual(['data:image/jpeg;base64,c21hbGw=', 'https://r2.example/adopters/x/big.png']);
        expect(r2.store).toHaveBeenCalledTimes(1);
    });

    it('one that still cannot be stored is counted in the answer: «1 of 3»', async () => {
        r2.store.mockResolvedValueOnce('https://r2.example/a.png').mockResolvedValueOnce(null);
        const res = await save([small, big, big]);
        const json = await res.json() as { id: string; imagesNotSaved?: number; imagesTotal?: number; errorId?: string };
        expect(res.status).toBe(200);
        expect(json).toMatchObject({ imagesNotSaved: 1, imagesTotal: 3, errorId: expect.any(String) });
        expect(urlsOf(json.id)).toHaveLength(2);
    });

    it('a video is not counted among the images', async () => {
        r2.store.mockResolvedValue(null);
        const res = await save([big, { data: '', mimeType: 'video/mp4', originalUrl: 'https://video.example/v.mp4' }]);
        expect(await res.json()).toMatchObject({ imagesNotSaved: 1, imagesTotal: 1 });
    });
});
