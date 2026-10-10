import { test, expect } from '@playwright/test';
import { dismissCountryBanner } from './helpers';

/** Phone search stays signed-in only (2.56.155 changed how numbers are read, not who may search them). */
test('a logged-out phone search asks to sign in instead of searching', async ({ page }) => {
    await page.goto('/');
    await dismissCountryBanner(page);
    const box = page.locator('input#search');
    await box.fill('+54 9 11 6585 1333');
    await box.press('Enter');
    await expect(page.getByText(/iniciar sesión para buscar|sign in to search|log in to search/i)).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-walkthrough="results"] a[href^="/adopter/"]')).toHaveCount(0);
});
