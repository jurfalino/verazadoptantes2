import { test, expect } from '@playwright/test';
import { loginAsAnon, TEST_NAMES } from './helpers';

test.setTimeout(60000);

test.describe('Search Functionality', () => {

    test.beforeEach(async ({ page }) => {
        await loginAsAnon(page);
    });

    test('Search by exact name returns results', async ({ page }) => {
        await page.fill('input#search', TEST_NAMES.MARIA);
        await page.getByRole('button', { name: /search records|buscar registros/i }).click();

        // Results found — heading shows match count
        // Note: names are PII-masked for anon users (e.g. "Mar••••")
        await expect(page.getByText(/found \d+ match/i)).toBeVisible({ timeout: 15000 });
    });

    test('Search by partial name returns results', async ({ page }) => {
        await page.fill('input#search', 'Carlos');
        await page.getByRole('button', { name: /search records|buscar registros/i }).click();

        // Should find at least 1 result
        await expect(page.getByText(/found \d+ match/i)).toBeVisible({ timeout: 15000 });
    });

    test('Search shows no results for unknown name', async ({ page }) => {
        await page.fill('input#search', 'XXXNONEXISTENTXXX');
        await page.getByRole('button', { name: /search records|buscar registros/i }).click();

        // Wait for search to complete — should show no matches
        await page.waitForTimeout(3000);
        const hasResults = await page.getByText(/found \d+ match/i).isVisible().catch(() => false);
        expect(hasResults).toBeFalsy();
    });

    test('Search result links to adopter profile', async ({ page }) => {
        await page.fill('input#search', TEST_NAMES.MARIA);
        await page.getByRole('button', { name: /search records|buscar registros/i }).click();

        // Wait for results
        await expect(page.getByText(/found \d+ match/i)).toBeVisible({ timeout: 15000 });

        // Verify result card contains a link to an adopter profile
        // (clicking triggers auth gate for anon users, so we just verify the link exists)
        const resultLink = page.locator('a[href*="/adopter/"]').first();
        await expect(resultLink).toBeVisible();
        const href = await resultLink.getAttribute('href');
        expect(href).toMatch(/\/adopter\//);
    });
});
