import { test, expect } from '@playwright/test';
import { dismissCountryBanner } from './helpers';


test.setTimeout(120000); // Extended timeout for wizard interactions

/**
 * The signed-out homepage shows the same «Para empezar» card a brand-new
 * signed-in rescuer sees (Jon 2026-11-11) — the old action cards are gone.
 * Every step asks a guest to sign in before it continues.
 */

test.describe('Home Screen — signed-out «Para empezar»', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await dismissCountryBanner(page);
        // Wait for page to fully render
        await expect(page.locator('input#search')).toBeVisible({ timeout: 30000 });
    });

    test('a guest sees «Para empezar», not the old action cards', async ({ page }) => {
        await expect(page.getByTestId('home-first-steps')).toBeVisible({ timeout: 30000 });
        await expect(page.getByTestId('home-step-adopters')).toBeVisible();
        await expect(page.locator('#action-cards')).toHaveCount(0);
        await expect(page.getByTestId('adoption-wizard-btn')).toHaveCount(0);
        await expect(page.getByTestId('report-wizard-btn')).toHaveCount(0);
    });

    test('«Registrá un adoptante» asks a guest to sign in, never opens the form', async ({ page }) => {
        await page.getByTestId('home-step-adopters').click();

        await expect(page.getByText(/Sign In|Iniciar/i).first()).toBeVisible({ timeout: 30000 });
        await expect(page).toHaveURL(/\/$|\/\?/);
    });

    test('every step on the card asks a guest to sign in', async ({ page }) => {
        const steps = page.locator('[data-testid^="home-step-"]');
        const n = await steps.count();
        expect(n).toBeGreaterThan(0);
        for (let i = 0; i < n; i++) {
            await page.goto('/');
            await dismissCountryBanner(page);
            await page.locator('[data-testid^="home-step-"]').nth(i).click();
            await expect(page.getByText(/Sign In|Iniciar/i).first()).toBeVisible({ timeout: 30000 });
        }
    });
});
