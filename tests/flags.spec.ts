import { test, expect } from '@playwright/test';
import { loginAsAnon, TEST_ADOPTERS, TEST_NAMES, TEST_ANIMALS } from './helpers';

test.setTimeout(60000);

test.describe('Flags and Adoption History', () => {

    test.beforeEach(async ({ page }) => {
        await loginAsAnon(page);
    });

    test('Duplicate flag banner is displayed', async ({ page }) => {
        // Ana (test-adopter-3) is flagged as duplicate of María
        await page.goto(`/adopter/${TEST_ADOPTERS.ANA}`);

        // Wait for the profile to load — name in view mode is h2
        await expect(page.getByRole('heading', { name: TEST_NAMES.ANA })).toBeVisible({ timeout: 15000 });

        // Duplicate flag banner should be visible
        await expect(page.getByText(/duplicate|duplicado/i).first()).toBeVisible();
    });

    test('Adoption history displays correctly', async ({ page }) => {
        // Roberto (test-adopter-4) has 3 adoption records
        await page.goto(`/adopter/${TEST_ADOPTERS.ROBERTO}`);

        // Wait for profile to load
        await expect(page.getByRole('heading', { name: TEST_NAMES.ROBERTO })).toBeVisible({ timeout: 15000 });

        // Adoptions section should be visible
        await expect(page.getByTestId('adoptions-list')).toBeVisible();

        // Animal names from Roberto's 3 records should appear
        await expect(page.getByText(TEST_ANIMALS.FIRULAIS)).toBeVisible();
        await expect(page.getByText(TEST_ANIMALS.PELUSA)).toBeVisible();
        await expect(page.getByText(TEST_ANIMALS.ROCKY)).toBeVisible();

        // Species labels should be visible (may be English or Spanish depending on browser locale)
        // 'dog' → 'Dog'/'Perro', 'cat' → 'Cat'/'Gato'
        await expect(page.getByText(/Perro|Dog/i).first()).toBeVisible();
        await expect(page.getByText(/Gato|Cat/i).first()).toBeVisible();

        // Source URL: Firulais record has a Facebook source_url — link should be present
        const sourceLink = page.locator('a[href="https://www.facebook.com/groups/123/posts/456"]');
        await expect(sourceLink).toBeVisible();

        // Admin email hiding: Pelusa was added by admin (gatitosolivos@gmail.com) — should NOT appear
        await expect(page.getByText('gatitosolivos@gmail.com')).not.toBeVisible();
    });
});
