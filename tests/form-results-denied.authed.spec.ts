import { test, expect } from '@playwright/test';

/**
 * A teammate/admin who opens someone else's form submission or contract result
 * (the app's own notification links) keeps the "no permission" screen — NOT the
 * friendly 404, which is reserved for missing records and strangers.
 * Runs under `authed` (gatitosolivos@gmail.com: admin + org-mate of the fixture owner).
 */
test.describe('shared notification links for non-owners', () => {
    test('form-results of a teammate: "no permission", not the 404', async ({ page }) => {
        await page.goto('/form-results/test-formsub-fixture-teammate-1');
        await expect(page.locator('body')).toContainText(/No tenés permiso/, { timeout: 30000 });
        await expect(page.getByTestId('not-found-page')).toHaveCount(0);
    });

    test('contract-results of a teammate: "no permission", not the 404', async ({ page }) => {
        await page.goto('/contract-results/test-notif-fixture-teammate-1');
        await expect(page.locator('body')).toContainText(/No tenés permiso/, { timeout: 30000 });
        await expect(page.getByTestId('not-found-page')).toHaveCount(0);
    });

    test('a missing submission still gets the 404', async ({ page }) => {
        await page.goto('/form-results/test-formsub-fixture-missing');
        await expect(page.getByTestId('not-found-page')).toBeVisible({ timeout: 30000 });
    });
});
