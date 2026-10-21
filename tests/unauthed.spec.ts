import { test, expect } from '@playwright/test';
import { dismissCountryBanner } from './helpers';

test.setTimeout(60000);

test.describe('Unauthenticated User — protected pages', () => {
    test('the spreadsheet import sends a logged-out visitor to sign in', async ({ page }) => {
        // Every save behind /import/sheet rejects anonymous callers; letting the
        // page load meant filling in the whole wizard only to fail at the end.
        await page.goto('/import/sheet');
        await page.waitForURL(u => !u.pathname.startsWith('/import/sheet'), { timeout: 30000 });
    });

    test('a post shared while logged out asks to sign in and keeps the post', async ({ page }) => {
        // The PWA share target lands here. It used to open the wizard anyway and
        // fail at "Extraer con IA" with a raw "Unauthorized" (audit 2026-10-21, A2).
        // Read the redirect itself: the home page strips callbackUrl once the
        // sign-in prompt has opened, so the final URL no longer carries it.
        const shared = 'https://www.facebook.com/groups/1/posts/2/';
        const res = await page.request.get(`/import?shared=true&shared_url=${encodeURIComponent(shared)}`, { maxRedirects: 0 });
        expect(res.status()).toBe(307);
        // Location may be relative (dev) or absolute (Cloudflare); resolve against the request.
        const location = new URL(res.headers()['location'] ?? '', res.url());
        expect(location.pathname).toBe('/');
        const callback = new URL(location.searchParams.get('callbackUrl') ?? '', location.origin);
        expect(callback.pathname).toBe('/import');
        expect(callback.searchParams.get('shared_url')).toBe(shared);
    });
});

test.describe('Unauthenticated User — PII Masking', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await dismissCountryBanner(page);
    });

    test('Search results show full names for unauthenticated users (names not PII-gated)', async ({ page }) => {
        // Search for María — names are always visible now; contact stays masked.
        await page.fill('input#search', 'María');
        await page.getByRole('button', { name: /search records|buscar registros/i }).click();

        await expect(page.getByText(/found \d+ match|\d+ resultados encontrados/i)).toBeVisible({ timeout: 30000 });

        // v2.22.x: adopter names are no longer PII-gated — the FULL name shows,
        // including surnames the user didn't type. (Contact info still masks —
        // see the "Protected info banner" test below.)
        const card = page.locator('a[href*="/adopter/"]').first();
        await expect(card).toBeVisible({ timeout: 30000 });
        await expect(card).toContainText('María');
        await expect(card).toContainText('García');
    });

    test('Protected info banner shows for unauthenticated users', async ({ page }) => {
        await page.fill('input#search', 'María');
        await page.getByRole('button', { name: /search records|buscar registros/i }).click();

        await expect(page.getByText(/found \d+ match|\d+ resultados encontrados/i)).toBeVisible({ timeout: 30000 });

        // Unauthenticated users see "(login to view)" next to masked contact info
        await expect(page.getByText(/login to view|iniciar sesión para ver/i).first()).toBeVisible({ timeout: 30000 });
    });

    test('Clicking search result card prompts login instead of navigating', async ({ page }) => {
        await page.fill('input#search', 'María');
        await page.getByRole('button', { name: /search records|buscar registros/i }).click();

        await expect(page.getByText(/found \d+ match|\d+ resultados encontrados/i)).toBeVisible({ timeout: 30000 });

        // Click the first result card
        const firstCard = page.locator('a[href*="/adopter/"]').first();
        await expect(firstCard).toBeVisible({ timeout: 30000 });
        await firstCard.click();

        // Should show login modal instead of navigating to profile
        // The login modal uses Google sign-in
        await expect(page.getByText(/sign in|iniciar sesión/i).first()).toBeVisible({ timeout: 30000 });

        // URL should NOT have changed to an adopter profile
        expect(page.url()).not.toMatch(/\/adopter\/test-adopter/);
    });

    test('Contact info is partially masked for unauthenticated users', async ({ page }) => {
        await page.fill('input#search', 'María');
        await page.getByRole('button', { name: /search records|buscar registros/i }).click();

        await expect(page.getByText(/found \d+ match|\d+ resultados encontrados/i)).toBeVisible({ timeout: 30000 });

        // The full phone number "555-1234" should NOT be fully visible
        // It should show a masked version with •••••• replacing most digits
        const resultCard = page.locator('a[href*="/adopter/"]').first();
        await expect(resultCard).toBeVisible({ timeout: 30000 });

        const cardText = await resultCard.textContent();
        // Should contain masking bullets instead of full contact info
        expect(cardText).toContain('••');
    });
});
