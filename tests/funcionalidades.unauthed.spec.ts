import { test, expect } from '@playwright/test';
import { dismissCountryBanner } from './helpers';

/**
 * /funcionalidades is the page the homepage's WhatsApp referral banner shares,
 * so it must give an invited (logged-out) visitor a way in from each feature,
 * and its link preview must carry its own image. Selectors are ids/attributes
 * (plus the brand name "Google"), not translated copy, so they hold in every locale.
 */
test.describe('features page, logged out', () => {
    test.skip(({ storageState }) => !!storageState, 'logged-out behaviour only');

    test('the search feature opens the search without an account', async ({ page }) => {
        await page.goto('/funcionalidades');
        await dismissCountryBanner(page);
        await page.locator('a[data-feature="search"]').click();
        await expect(page).toHaveURL(/\/$/, { timeout: 30000 });
        await expect(page.locator('input#search')).toBeVisible({ timeout: 30000 });
    });

    test('a members-only feature asks to sign in instead of navigating', async ({ page }) => {
        await page.goto('/funcionalidades');
        await dismissCountryBanner(page);
        await page.locator('button[data-feature="animals"]').click();
        await expect(page.getByText(/Google/).first()).toBeVisible({ timeout: 15000 });
        await expect(page).toHaveURL(/\/funcionalidades$/);
    });
});

test('the shared link has its own preview image', async ({ page }) => {
    await page.goto('/funcionalidades');
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/images\/features\/og-invite\.png$/);
    const res = await page.request.get('/images/features/og-invite.png');
    expect(res.ok()).toBe(true);
});
