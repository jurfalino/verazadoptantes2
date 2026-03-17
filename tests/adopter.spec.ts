import { test, expect } from '@playwright/test';
import { TEST_ADOPTERS, TEST_NAMES, dismissCountryBanner } from './helpers';

test.setTimeout(60000);

test.describe('Adopter Profile', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await dismissCountryBanner(page);
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
        await dismissCountryBanner(page);
        await page.waitForLoadState('networkidle');

        // Wait for profile to load — name appears as h1
        await expect(page.getByRole('heading', { name: TEST_NAMES.NUEVA })).toBeVisible({ timeout: 15000 });

        // Wait for the Notifications button (confirms auth session is loaded)
        await expect(page.getByRole('button', { name: /Notifications|Notificaciones/i })).toBeVisible({ timeout: 15000 });

        // Try clicking edit — retry if login modal opens instead of edit mode (session race)
        const editBtn = page.getByRole('button', { name: /Click to Edit|Clic para Editar/i }).first();
        const nameInput = page.locator('input[type="text"][required]').first();

        for (let attempt = 0; attempt < 3; attempt++) {
            await editBtn.click();
            const inputVisible = await nameInput.isVisible({ timeout: 3000 }).catch(() => false);
            if (inputVisible) break;
            await page.keyboard.press('Escape');
            await page.waitForTimeout(2000);
        }

        // Verify edit mode activated — name input is visible and editable
        await expect(nameInput).toBeVisible({ timeout: 5000 });
        await nameInput.clear();
        await nameInput.fill(newName);
        await expect(nameInput).toHaveValue(newName);

        // Verify Save and Cancel buttons are visible
        const saveBtn = page.getByRole('button', { name: /save|guardar/i });
        const cancelBtn = page.getByRole('button', { name: /cancel|cancelar/i });
        await expect(saveBtn).toBeVisible();
        await expect(cancelBtn).toBeVisible();

        // Cancel to exit edit mode and verify name reverts to original
        await cancelBtn.click();
        await expect(page.getByRole('heading', { name: TEST_NAMES.NUEVA })).toBeVisible({ timeout: 5000 });
    });
});
