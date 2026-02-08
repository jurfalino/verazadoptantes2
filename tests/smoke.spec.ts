import { test, expect } from '@playwright/test';
import { loginAsAnon } from './helpers';

test.setTimeout(60000);

test.describe('Smoke Tests', () => {

    test('Homepage loads correctly', async ({ page }) => {
        await page.goto('/');
        // Page title from metadata
        await expect(page).toHaveTitle(/BuenAdoptante/i);
        // Main heading should be visible
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
    });

    test('Anonymous login grants access', async ({ page }) => {
        await loginAsAnon(page);
        // After anon login, search input should be visible
        await expect(page.locator('input#search')).toBeVisible();
        // Footer with version badge
        await expect(page.locator('footer')).toBeVisible();
    });

    test('Navigation between pages works', async ({ page }) => {
        await loginAsAnon(page);

        // Home page has search
        await expect(page.locator('input#search')).toBeVisible();

        // Navigate to create adopter
        await page.goto('/adopter/create');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });

        // Navigate back home
        await page.goto('/');
        await expect(page.locator('input#search')).toBeVisible({ timeout: 15000 });

        // Footer visible
        await expect(page.locator('footer')).toBeVisible();
    });
});
