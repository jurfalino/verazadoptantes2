import { test as setup, expect } from '@playwright/test';

const ADMIN_EMAIL = 'gatitosolivos@gmail.com';
const AUTH_FILE = '.auth/admin.json';

/**
 * Authenticate as admin via the Credentials provider.
 * Saves the session cookie to .auth/admin.json for reuse by authed tests.
 */
setup('authenticate as admin', async ({ page }) => {
    // Navigate to the NextAuth credentials sign-in page
    await page.goto('/api/auth/signin');
    await page.waitForLoadState('networkidle');

    // Find the credentials sign-in form (the "Direct Login" provider)
    // NextAuth renders a form per provider — look for the email input
    const emailInput = page.locator('input[name="email"]');

    // If multiple forms exist (Google + Credentials), find the Credentials one
    if (await emailInput.count() > 1) {
        // Use the last email input (Credentials is listed after Google)
        await emailInput.last().fill(ADMIN_EMAIL);
    } else {
        await emailInput.fill(ADMIN_EMAIL);
    }

    // Submit the credentials form
    const submitBtn = page.locator('button[type="submit"]');
    if (await submitBtn.count() > 1) {
        await submitBtn.last().click();
    } else {
        await submitBtn.click();
    }

    // Wait for authentication to complete — should redirect to home
    await page.waitForURL('/', { timeout: 15000 });

    // Verify we're logged in — search input should be visible (no login modal)
    await expect(page.locator('input#search')).toBeVisible({ timeout: 10000 });

    // Save the authenticated state
    await page.context().storageState({ path: AUTH_FILE });
});
