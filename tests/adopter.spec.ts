import { test, expect } from '@playwright/test';
import { loginAsAnon, TEST_ADOPTERS, TEST_NAMES } from './helpers';

test.setTimeout(60000);

test.describe('Adopter Profile', () => {

    test.beforeEach(async ({ page }) => {
        await loginAsAnon(page);
    });

    test('View full adopter profile', async ({ page }) => {
        await page.goto(`/adopter/${TEST_ADOPTERS.MARIA}`);

        // In view mode, name appears as an h2 heading (click-to-edit pattern)
        await expect(page.getByRole('heading', { name: TEST_NAMES.MARIA })).toBeVisible({ timeout: 15000 });

        // Contact info should be displayed
        await expect(page.getByText(/555-1234/)).toBeVisible();

        // Rating badge should be visible
        await expect(page.getByTestId('rating-badge')).toBeVisible();

        // Adoptions list should be visible with records
        await expect(page.getByTestId('adoptions-list')).toBeVisible();
    });

    test('Create new adopter', async ({ page }) => {
        const uniqueName = `Test Persona ${Date.now()}`;

        await page.goto('/adopter/create');

        // In create mode, form is in editing mode with input fields
        await page.getByPlaceholder(/name|nombre/i).fill(uniqueName);

        // Submit the form
        await page.getByRole('button', { name: /save|guardar|create|crear/i }).click();

        // Should redirect to the new profile — name visible as h2 in view mode
        await expect(page.getByRole('heading', { name: uniqueName })).toBeVisible({ timeout: 15000 });

        // URL should have changed from /create to a UUID
        await expect(page).not.toHaveURL(/\/create/);
    });

    test('Edit adopter name', async ({ page }) => {
        const newName = `Persona Editada ${Date.now()}`;

        await page.goto(`/adopter/${TEST_ADOPTERS.NUEVA}`);

        // Wait for profile to load — name in view mode is h2
        await expect(page.getByRole('heading', { name: TEST_NAMES.NUEVA })).toBeVisible({ timeout: 15000 });

        // Click name to enter edit mode
        await page.getByRole('heading', { name: TEST_NAMES.NUEVA }).click();

        // Now it should be an input field
        const nameInput = page.getByPlaceholder(/name|nombre/i);
        await expect(nameInput).toBeVisible({ timeout: 5000 });
        await nameInput.clear();
        await nameInput.fill(newName);

        // Save
        await page.getByRole('button', { name: /save|guardar/i }).click();

        // Reload and verify persistence — name in view mode
        await page.reload();
        await expect(page.getByRole('heading', { name: newName })).toBeVisible({ timeout: 15000 });

        // Restore original name for idempotency
        await page.getByRole('heading', { name: newName }).click();
        const restoreInput = page.getByPlaceholder(/name|nombre/i);
        await restoreInput.clear();
        await restoreInput.fill(TEST_NAMES.NUEVA);
        await page.getByRole('button', { name: /save|guardar/i }).click();
    });
});
