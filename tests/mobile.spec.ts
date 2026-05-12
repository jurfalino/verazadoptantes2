import { test, expect } from '@playwright/test';
import { dismissCountryBanner } from './helpers';

/**
 * Mobile viewport tests — runs on iPhone 14 (390×844).
 * Verifies responsive layouts don't break at mobile widths.
 */

test.setTimeout(60000);

test.describe('Mobile Responsive', () => {

    test('Homepage search is usable at mobile width', async ({ page }) => {
        await page.goto('/');
        await dismissCountryBanner(page);

        // Search input should be visible and full-width
        const searchInput = page.locator('input#search');
        await expect(searchInput).toBeVisible({ timeout: 30000 });

        // Search button should be visible — use form submit button
        const searchBtn = page.locator('button[type="submit"]');
        await expect(searchBtn).toBeVisible({ timeout: 30000 });

        // Type and search
        await searchInput.fill('María');
        await searchBtn.click();

        // Results should appear — look for adopter links
        await expect(page.locator('a[href*="/adopter/"]').first()).toBeVisible({ timeout: 30000 });

        // Result cards should not overflow the viewport
        const firstCard = page.locator('a[href*="/adopter/"]').first();
        const cardBox = await firstCard.boundingBox();
        const viewportSize = page.viewportSize();
        if (cardBox && viewportSize) {
            expect(cardBox.width).toBeLessThanOrEqual(viewportSize.width);
        }
    });

    test('Footer is visible at mobile width', async ({ page }) => {
        await page.goto('/');
        await dismissCountryBanner(page);
        await expect(page.locator('input#search')).toBeVisible({ timeout: 30000 });

        // Scroll to bottom
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

        // Footer should be present — look for the copyright text
        await expect(page.getByText(/© 2026/)).toBeVisible({ timeout: 30000 });
    });
});
