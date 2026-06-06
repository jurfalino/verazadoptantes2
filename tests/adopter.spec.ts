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
        await expect(page.getByRole('heading', { name: TEST_NAMES.MARIA })).toBeVisible({ timeout: 30000 });

        // Contact info should be displayed
        await expect(page.getByText(/555-1234/)).toBeVisible({ timeout: 30000 });

        // Rating badge should be visible
        await expect(page.getByTestId('rating-badge')).toBeVisible({ timeout: 30000 });

        // Adoptions list should be visible with records
        await expect(page.getByTestId('adoptions-list')).toBeVisible({ timeout: 30000 });
    });

    test('Create new adopter', async ({ page }) => {
        const uniqueName = `Test Persona ${Date.now()}`;

        await page.goto('/adopter/create');
        await dismissCountryBanner(page);

        // In create mode, form is in editing mode with input fields
        await page.getByPlaceholder(/name|nombre/i).fill(uniqueName);

        // Submit the form
        await page.getByRole('button', { name: /save|guardar|create|crear/i }).click();

        // Handle duplicate detection modal if it appears
        // Wait up to 3s for it to appear; if it doesn't, assume no duplicates were found.
        const createAnywayBtn = page.getByRole('button', { name: /Create new profile anyway|Crear perfil nuevo/i });
        try {
            await createAnywayBtn.waitFor({ state: 'visible', timeout: 3000 });
            await createAnywayBtn.click();
        } catch {
            // Modal did not appear, which is fine
        }

        // Should redirect to the new profile — name visible as h2 in view mode
        await expect(page.getByRole('heading', { name: uniqueName })).toBeVisible({ timeout: 30000 });

        // URL should have changed from /create to a UUID
        await expect(page).not.toHaveURL(/\/create/);
    });

    test('Adds typed contact entries via the inline composer on creation', async ({ page }) => {
        // v2.16.0-5 unified the contact add UI across new and existing adopters:
        // new-adopter creation now uses ContactEntriesSection's inline composer
        // instead of ContactEntriesInput's paste-and-categorize. This test
        // confirms entries added through the composer in local mode (no
        // adopterId yet) survive the saveAdopter create call.
        const uniqueName = `Contacto Test ${Date.now()}`;

        await page.goto('/adopter/create');
        await dismissCountryBanner(page);

        await page.getByPlaceholder(/name|nombre/i).fill(uniqueName);

        // Open the composer. v2.18.4 redesign: clicking the trigger lands
        // in the "pick-type" stage (no input visible yet); the user must
        // explicitly choose a type before the input panel appears. So each
        // add now requires `ce-add-trigger` → `ce-type-<type>` → fill.
        await page.getByTestId('ce-add-trigger').click();
        await page.getByTestId('ce-type-phone').click();
        await page.locator('input[placeholder*="2345-6789"], input[placeholder*="+54"]').first().fill('11 2345-6789');
        await page.getByTestId('ce-composer-submit').click();

        // Open the composer again for an email entry.
        await page.getByTestId('ce-add-trigger').click();
        await page.getByTestId('ce-type-email').click();
        await page.locator('input[placeholder*="@example.com"], input[placeholder*="name@"]').first().fill('juan.contacto@example.com');
        await page.getByTestId('ce-composer-submit').click();

        // Both chips render in the section now.
        const chips = page.getByTestId('ce-chip');
        await expect(chips).toHaveCount(2, { timeout: 10000 });

        await page.getByRole('button', { name: /save|guardar|create|crear/i }).click();
        const createAnywayBtn = page.getByRole('button', { name: /Create new profile anyway|Crear perfil nuevo/i });
        try {
            await createAnywayBtn.waitFor({ state: 'visible', timeout: 3000 });
            await createAnywayBtn.click();
        } catch {
            // No duplicates — fine.
        }

        // The saved profile shows the entered contact value.
        await expect(page.getByRole('heading', { name: uniqueName })).toBeVisible({ timeout: 30000 });
        await expect(page.getByText('juan.contacto@example.com')).toBeVisible({ timeout: 30000 });
    });

    test('Composer three-stage flow — change-type discards in-progress input (v2.18.4)', async ({ page }) => {
        // v2.18.4 redesign: clicking the trigger lands in the "pick-type"
        // stage with no input visible. Picking a pill advances to the
        // "editing" stage with input(s) + Save/Cancel laid out identically
        // to the in-row edit form. The "↺ cambiar" link returns to
        // pick-type and DISCARDS any in-progress input — explicit user
        // action, no auto-commit hack from v2.18.1 since pills no longer
        // appear during editing so there's no silent-discard scenario.
        const uniqueName = `Contacto Compose ${Date.now()}`;

        await page.goto('/adopter/create');
        await dismissCountryBanner(page);

        await page.getByPlaceholder(/name|nombre/i).fill(uniqueName);

        await page.getByTestId('ce-add-trigger').click();
        // Pick-type stage: no input visible yet. The Save submit button
        // shouldn't render either — guard against it for regression sake.
        await expect(page.getByTestId('ce-composer-submit')).toHaveCount(0);

        // Pick address, type something, then "↺ cambiar" → input is wiped,
        // pills are visible again. Switch to phone and save successfully.
        await page.getByTestId('ce-type-address').click();
        await page.locator('input[placeholder*="Calle"], input[placeholder*="Street"]').first().fill('THROWAWAY ADDRESS');
        await page.getByTestId('ce-compose-change-type').click();

        // Back in pick-type. Pick phone and submit a real value.
        await page.getByTestId('ce-type-phone').click();
        await page.locator('input[placeholder*="2345-6789"], input[placeholder*="+54"]').first().fill('11 5555-1234');
        await page.getByTestId('ce-composer-submit').click();

        // Exactly ONE chip — the address draft was discarded by "cambiar".
        const chips = page.getByTestId('ce-chip');
        await expect(chips).toHaveCount(1, { timeout: 10000 });

        // Save the adopter end-to-end to confirm the entry persists.
        await page.getByRole('button', { name: /save|guardar|create|crear/i }).click();
        const createAnywayBtn = page.getByRole('button', { name: /Create new profile anyway|Crear perfil nuevo/i });
        try {
            await createAnywayBtn.waitFor({ state: 'visible', timeout: 3000 });
            await createAnywayBtn.click();
        } catch {
            // No duplicates — fine.
        }

        // The saved profile has the phone but NOT the throwaway address.
        await expect(page.getByRole('heading', { name: uniqueName })).toBeVisible({ timeout: 30000 });
        await expect(page.getByText('11 5555-1234')).toBeVisible({ timeout: 30000 });
        await expect(page.getByText('THROWAWAY ADDRESS')).toHaveCount(0);
    });

    test('Edit adopter name', async ({ page }) => {
        const newName = `Persona Editada ${Date.now()}`;

        await page.goto(`/adopter/${TEST_ADOPTERS.NUEVA}`);
        await dismissCountryBanner(page);
        await page.waitForLoadState('networkidle');

        // Wait for profile to load — name appears as h1
        await expect(page.getByRole('heading', { name: TEST_NAMES.NUEVA })).toBeVisible({ timeout: 30000 });

        // Wait for the Notifications button (confirms auth session is loaded)
        await expect(page.getByRole('button', { name: /Notifications|Notificaciones/i })).toBeVisible({ timeout: 30000 });

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
        await expect(nameInput).toBeVisible({ timeout: 30000 });
        await nameInput.clear();
        await nameInput.fill(newName);
        await expect(nameInput).toHaveValue(newName);

        // Verify Save and Cancel buttons are visible
        const saveBtn = page.getByRole('button', { name: /save|guardar/i });
        const cancelBtn = page.getByRole('button', { name: /cancel|cancelar/i });
        await expect(saveBtn).toBeVisible({ timeout: 30000 });
        await expect(cancelBtn).toBeVisible({ timeout: 30000 });

        // Cancel to exit edit mode and verify name reverts to original
        await cancelBtn.click();
        await expect(page.getByRole('heading', { name: TEST_NAMES.NUEVA })).toBeVisible({ timeout: 30000 });
    });
});
