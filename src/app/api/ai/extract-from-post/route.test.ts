/**
 * POST /api/ai/extract-from-post (I1): the AI reads at most five images, but
 * every image the rescuer attached or picked comes back to be saved — none is
 * silently dropped past the fifth.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { extract, warn } = vi.hoisted(() => ({
    extract: vi.fn(async () => ({ confidence: 'high', name: 'Ana' })),
    warn: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { email: 'rescuer@example.com' } })) }));
vi.mock('@/lib/db', () => ({ getDb: async () => null }));
vi.mock('@/lib/gemini', () => ({ extractAdopterData: extract }));
vi.mock('@/lib/logger', () => ({ logger: { warn, info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') } }));

import { POST } from './route';

const upload = (n: number) => ({ data: `up${n}`, mimeType: 'image/png' });
const call = (body: unknown) => POST(new Request('http://x/api/ai/extract-from-post', { method: 'POST', body: JSON.stringify(body) }) as never);

beforeEach(() => {
    extract.mockClear();
    warn.mockClear();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('broken')
        ? new Response('no', { status: 404 })
        : new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }))));
});
afterEach(() => vi.unstubAllGlobals());

describe('extract-from-post — images past the fifth are kept', () => {
    it('six screenshots: the AI reads five, all six come back to be saved', async () => {
        const res = await call({ text: 'post', images: [1, 2, 3, 4, 5, 6].map(upload) });
        const json = await res.json() as { processedImages: Array<{ data: string }> };
        expect(json.processedImages.map(i => i.data)).toEqual(['up1', 'up2', 'up3', 'up4', 'up5', 'up6']);
        expect((extract.mock.calls[0] as unknown[])[1]).toHaveLength(5);
    });

    it('three screenshots and four post images: every one comes back, the post ones with their URL', async () => {
        const urls = ['https://cdn/a.jpg', 'https://cdn/b.jpg', 'https://cdn/c.jpg', 'https://cdn/d.jpg'];
        const res = await call({ images: [1, 2, 3].map(upload), imageUrls: urls });
        const json = await res.json() as { processedImages: Array<{ originalUrl?: string }> };
        expect(json.processedImages).toHaveLength(7);
        expect(json.processedImages.filter(i => i.originalUrl).map(i => i.originalUrl)).toEqual(urls);
        expect((extract.mock.calls[0] as unknown[])[1]).toHaveLength(5);
    });

    it('a post image that cannot be downloaded is logged, never silently skipped', async () => {
        const res = await call({ imageUrls: ['https://cdn/broken.jpg', 'https://cdn/ok.jpg'] });
        const json = await res.json() as { processedImages: Array<{ originalUrl?: string }> };
        expect(json.processedImages.map(i => i.originalUrl)).toEqual(['https://cdn/ok.jpg']);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('post image not downloaded'), expect.objectContaining({ status: 404 }));
    });
});
