/**
 * Group logo/banner uploads (group branding, Review Focus #4): the bucket is
 * public and the bytes are the client's, so only a real JPEG/PNG/WEBP of a
 * bounded size is ever stored — never an SVG, never HTML renamed .png.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { put, warn, error } = vi.hoisted(() => ({ put: vi.fn(), warn: vi.fn(), error: vi.fn(() => 'err12345') }));

vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: { IMAGES_BUCKET: { put } } }) }));
vi.mock('@/lib/logger', () => ({ logger: { warn, error, info: vi.fn(), debug: vi.fn() } }));

import { storeOrgImageDataUrl, checkOrgImageDataUrl, R2_PUBLIC_URL } from './r2';
import { ORG_IMAGE_MAX_DATA_URL } from '@/domain/groupBranding';

const dataUrl = (mime: string, bytes: number[], pad = 64) => `data:${mime};base64,${Buffer.from([...bytes, ...new Array(pad).fill(7)]).toString('base64')}`;
/** A PNG data URL of exactly `length` characters (9 header bytes = 12 base64 chars, then 'A' padding). */
const exactLength = (length: number) => {
    const head = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00]).toString('base64')}`;
    return head + 'A'.repeat(length - head.length);
};
const JPEG = [0xFF, 0xD8, 0xFF, 0xE0];
const PNG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];

beforeEach(() => { put.mockReset(); put.mockResolvedValue(undefined); warn.mockClear(); error.mockClear(); });

describe('storeOrgImageDataUrl — refusals (nothing reaches the bucket)', () => {
    it('an SVG is refused', async () => {
        const svg = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64')}`;
        expect(await storeOrgImageDataUrl(svg, 'o', 'logo')).toBeNull();
        expect(put).not.toHaveBeenCalled();
    });

    it('HTML bytes typed as PNG are refused', async () => {
        const html = `data:image/png;base64,${Buffer.from('<html><script>alert(1)</script></html>').toString('base64')}`;
        expect(await storeOrgImageDataUrl(html, 'o', 'logo')).toBeNull();
        expect(put).not.toHaveBeenCalled();
    });

    it('a data URL longer than ORG_IMAGE_MAX_DATA_URL is refused', async () => {
        const big = dataUrl('image/jpeg', JPEG, Math.ceil(ORG_IMAGE_MAX_DATA_URL * 0.75) + 10);
        expect(big.length).toBeGreaterThan(ORG_IMAGE_MAX_DATA_URL);
        expect(await storeOrgImageDataUrl(big, 'o', 'banner')).toBeNull();
        expect(put).not.toHaveBeenCalled();
    });

    it('the cap is exact: one character over ORG_IMAGE_MAX_DATA_URL is refused', async () => {
        const over = exactLength(ORG_IMAGE_MAX_DATA_URL + 1);
        expect(over.length).toBe(ORG_IMAGE_MAX_DATA_URL + 1);
        expect(await storeOrgImageDataUrl(over, 'o', 'banner')).toBeNull();
        expect(put).not.toHaveBeenCalled();
    });

    it('a GIF is refused (JPEG, PNG and WEBP only)', async () => {
        expect(await storeOrgImageDataUrl(dataUrl('image/gif', GIF), 'o', 'logo')).toBeNull();
        expect(put).not.toHaveBeenCalled();
    });

    it('an unknown kind is refused', async () => {
        expect(await storeOrgImageDataUrl(dataUrl('image/png', PNG), 'o', 'avatar' as never)).toBeNull();
        expect(put).not.toHaveBeenCalled();
    });

    it('a non-data URL is refused', async () => {
        expect(await storeOrgImageDataUrl('https://evil.example/x.png', 'o', 'logo')).toBeNull();
        expect(put).not.toHaveBeenCalled();
    });
});

describe('storeOrgImageDataUrl — accepted images', () => {
    it('a PNG logo goes to orgs/<orgId>/logo-<uuid>.png and its public URL comes back', async () => {
        const url = await storeOrgImageDataUrl(dataUrl('image/png', PNG), 'org1', 'logo');
        expect(url).toMatch(new RegExp(`^${R2_PUBLIC_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/orgs/org1/logo-[0-9a-f-]{36}\\.png$`));
        expect(put).toHaveBeenCalledWith(
            expect.stringMatching(/^orgs\/org1\/logo-[0-9a-f-]{36}\.png$/), expect.any(Uint8Array),
            expect.objectContaining({ httpMetadata: expect.objectContaining({ contentType: 'image/png' }) }),
        );
    });

    it('a PNG of exactly ORG_IMAGE_MAX_DATA_URL characters is accepted', async () => {
        const atLimit = exactLength(ORG_IMAGE_MAX_DATA_URL);
        expect(atLimit.length).toBe(ORG_IMAGE_MAX_DATA_URL);
        expect(await storeOrgImageDataUrl(atLimit, 'org1', 'banner')).toMatch(/\/orgs\/org1\/banner-[0-9a-f-]{36}\.png$/);
        expect(put).toHaveBeenCalledTimes(1);
    });

    it('a JPEG banner is stored as .jpg, a WEBP as .webp', async () => {
        expect(await storeOrgImageDataUrl(dataUrl('image/jpeg', JPEG), 'org1', 'banner')).toMatch(/\/orgs\/org1\/banner-[0-9a-f-]{36}\.jpg$/);
        expect(await storeOrgImageDataUrl(dataUrl('image/webp', WEBP), 'org1', 'banner')).toMatch(/\/orgs\/org1\/banner-[0-9a-f-]{36}\.webp$/);
    });

    it('an R2 failure returns null and is logged as an error', async () => {
        put.mockRejectedValue(new Error('R2 down'));
        vi.useFakeTimers();
        const p = storeOrgImageDataUrl(dataUrl('image/png', PNG), 'org1', 'logo');
        await vi.runAllTimersAsync();
        expect(await p).toBeNull();
        vi.useRealTimers();
        expect(error).toHaveBeenCalled();
    });
});

describe('checkOrgImageDataUrl', () => {
    it('names the type and extension of an acceptable image, refuses the rest', () => {
        expect(checkOrgImageDataUrl(dataUrl('image/jpeg', JPEG))).toEqual({ ok: true, mimeType: 'image/jpeg', ext: 'jpg' });
        expect(checkOrgImageDataUrl(dataUrl('image/png', PNG))).toEqual({ ok: true, mimeType: 'image/png', ext: 'png' });
        expect(checkOrgImageDataUrl(dataUrl('image/svg+xml', PNG)).ok).toBe(false);
        expect(checkOrgImageDataUrl('').ok).toBe(false);
    });
});
