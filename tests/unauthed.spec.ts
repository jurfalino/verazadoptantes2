import { test, expect } from '@playwright/test';
import { TEST_NAMES, dismissCountryBanner } from './helpers';

test.setTimeout(60000);

test.describe('Unauthenticated User — PII Masking', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await dismissCountryBanner(page);
    });

    test('Search results show masked names for unauthenticated users', async ({ page }) => {
        // Search for María — should return results but with masked PII
        await page.fill('input#search', 'María');
        await page.getByRole('button', { name: /search records|buscar registros/i }).click();

        await expect(page.getByText(/found \d+ match|\d+ resultados encontrados/i)).toBeVisible({ timeout: 30000 });

        // The full name "María García López" should NOT be visible
        await expect(page.getByText(TEST_NAMES.MARIA)).not.toBeVisible({ timeout: 30000 });

        // Per-token name reveal (v2.15.0-5): tokens that appear in the query
        // reveal in full, the rest collapse to their initial. Searching for
        // "María" against "María García López" renders as "María G L" on the
        // card — surnames the user didn't type stay masked.
        await expect(page.getByText('García')).toHaveCount(0);
        await expect(page.getByText('López')).toHaveCount(0);
        // The "María" token IS revealed because it's in the query.
        const card = page.locator('a[href*="/adopter/"]').first();
        await expect(card).toBeVisible({ timeout: 30000 });
        await expect(card).toContainText('María');
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
