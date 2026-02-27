import { test, expect } from '@playwright/test';

/**
 * Scraper Microservice E2E Tests
 *
 * Tests the Playwright-based Facebook scraper running on Fly.io.
 * Requires SCRAPER_URL (and optionally SCRAPER_API_KEY) in .env.local.
 *
 * These tests hit the LIVE scraper service — they verify the full pipeline
 * including Chromium launch, Facebook page loading, and content extraction.
 */

const SCRAPER_URL = process.env.SCRAPER_URL;
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY;

// Skip the entire suite if SCRAPER_URL is not configured
test.describe('Scraper Microservice', () => {
    test.skip(!SCRAPER_URL, 'SCRAPER_URL not configured — skipping scraper tests');

    // Scraper can be slow (cold start + Playwright + Facebook load)
    test.setTimeout(120_000);

    const headers = (): Record<string, string> => ({
        'Content-Type': 'application/json',
        ...(SCRAPER_API_KEY ? { 'X-API-Key': SCRAPER_API_KEY } : {}),
    });

    test('Health check returns OK', async ({ request }) => {
        const response = await request.get(`${SCRAPER_URL}/health`, {
            headers: headers(),
        });
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.status).toBe('ok');
    });

    test('Scrapes image post with 3 images', async ({ request }) => {
        // Public Facebook post with 3 images
        const response = await request.post(`${SCRAPER_URL}/scrape`, {
            headers: headers(),
            data: { url: 'https://www.facebook.com/share/p/1GDp3iR79R/' },
        });

        expect(response.status()).toBe(200);
        const body = await response.json();

        // Must succeed
        expect(body.success, `Scraper returned error: ${body.error}`).toBe(true);
        expect(body.data).toBeDefined();

        // Must extract at least 1 image (3 expected, but Facebook may vary)
        expect(body.data.images.length, 'Expected at least 1 image from the post').toBeGreaterThanOrEqual(1);

        // Ideal: all 3 images extracted
        if (body.data.images.length < 3) {
            console.warn(`[Scraper Test] Only ${body.data.images.length}/3 images extracted — Facebook may have changed layout`);
        }

        // Images should be valid URLs (scontent CDN or similar)
        for (const img of body.data.images) {
            expect(img).toMatch(/^https?:\/\//);
        }

        // Should extract some text content
        expect(body.data.text.length, 'Expected non-empty text from the post').toBeGreaterThan(0);
    });

    test('Scrapes video/reel post', async ({ request }) => {
        // Public Facebook reel/video
        const response = await request.post(`${SCRAPER_URL}/scrape`, {
            headers: headers(),
            data: { url: 'https://www.facebook.com/share/r/1AymLThK1J/' },
        });

        expect(response.status()).toBe(200);
        const body = await response.json();

        // Must succeed
        expect(body.success, `Scraper returned error: ${body.error}`).toBe(true);
        expect(body.data).toBeDefined();

        // Video posts may not have traditional images, but should have
        // at least text or a video poster/thumbnail
        const hasContent = body.data.text.length > 0 || body.data.images.length > 0;
        expect(hasContent, 'Expected at least text or thumbnail from the video post').toBe(true);

        // Log what was extracted for debugging
        console.log(`[Scraper Test] Video post: text=${body.data.text.length} chars, images=${body.data.images.length}, author="${body.data.author || 'unknown'}"`);
    });

    test('Rejects invalid URL', async ({ request }) => {
        const response = await request.post(`${SCRAPER_URL}/scrape`, {
            headers: headers(),
            data: { url: 'https://www.google.com' },
        });

        expect(response.status()).toBe(400);
        const body = await response.json();
        expect(body.error).toBeDefined();
    });

    test('Rejects missing URL', async ({ request }) => {
        const response = await request.post(`${SCRAPER_URL}/scrape`, {
            headers: headers(),
            data: {},
        });

        expect(response.status()).toBe(400);
        const body = await response.json();
        expect(body.error).toBeDefined();
    });
});
