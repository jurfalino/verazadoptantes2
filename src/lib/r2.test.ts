/**
 * F1: a screenshot too big to keep inline goes to R2 instead of being skipped —
 * but only a real image: the bytes and the type are the client's, the bucket is public.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { put, warn, error } = vi.hoisted(() => ({ put: vi.fn(), warn: vi.fn(), error: vi.fn(() => 'err12345') }));

vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: { IMAGES_BUCKET: { put } } }) }));
vi.mock('@/lib/logger', () => ({ logger: { warn, error, info: vi.fn(), debug: vi.fn() } }));

import { storeLargeImageDataUrl, R2_PUBLIC_URL } from './r2';

const dataUrl = (mime: string, bytes: number[]) => `data:${mime};base64,${Buffer.from([...bytes, ...new Array(64).fill(7)]).toString('base64')}`;
const JPEG = [0xFF, 0xD8, 0xFF, 0xE0];
const PNG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

beforeEach(() => { put.mockReset(); put.mockResolvedValue(undefined); warn.mockClear(); error.mockClear(); });

describe('storeLargeImageDataUrl', () => {
    it('a JPEG goes to R2 under the profile, and its URL comes back', async () => {
        const url = await storeLargeImageDataUrl(dataUrl('image/jpeg', JPEG), 'ad1', 'img1');
        expect(url).toBe(`${R2_PUBLIC_URL}/adopters/ad1/img1.jpg`);
        expect(put).toHaveBeenCalledWith('adopters/ad1/img1.jpg', expect.any(Uint8Array), expect.objectContaining({ httpMetadata: expect.objectContaining({ contentType: 'image/jpeg' }) }));
    });

    it('a PNG screenshot goes to R2 as .png', async () => {
        expect(await storeLargeImageDataUrl(dataUrl('image/png', PNG), 'ad1', 'img2')).toBe(`${R2_PUBLIC_URL}/adopters/ad1/img2.png`);
    });

    it('HTML dressed as an image is refused, nothing is stored', async () => {
        const html = `data:image/png;base64,${Buffer.from('<html><script>alert(1)</script></html>').toString('base64')}`;
        expect(await storeLargeImageDataUrl(html, 'ad1', 'img3')).toBeNull();
        expect(put).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalled();
    });

    it('a type that is not a photo type is refused, even with image bytes (no HTML, no SVG)', async () => {
        expect(await storeLargeImageDataUrl(dataUrl('text/html', JPEG), 'ad1', 'img4')).toBeNull();
        expect(await storeLargeImageDataUrl(dataUrl('image/svg+xml', JPEG), 'ad1', 'img4')).toBeNull();
        expect(put).not.toHaveBeenCalled();
    });

    it('R2 failing answers null, logged with an error', async () => {
        vi.useFakeTimers();
        put.mockRejectedValue(new Error('R2 down'));
        const pending = storeLargeImageDataUrl(dataUrl('image/jpeg', JPEG), 'ad1', 'img5');
        await vi.runAllTimersAsync();
        expect(await pending).toBeNull();
        expect(error).toHaveBeenCalled();
        vi.useRealTimers();
    });
});
