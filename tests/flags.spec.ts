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
    });
});
