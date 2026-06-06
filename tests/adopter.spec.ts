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

        // Open the composer (its trigger has a stable data-testid). Phone is
        // the default selected type, so we can type the value straight in.
        await page.getByTestId('ce-add-trigger').click();
        await page.locator('input[placeholder*="2345-6789"], input[placeholder*="+54"]').first().fill('11 2345-6789');
        await page.getByTestId('ce-composer-submit').click();

        // Open the composer again for an email entry, switch type, submit.
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

    test('Composer auto-commits previous entry when switching types via pill click (v2.18.1)', async ({ page }) => {
        // Prod-reported bug: user opens composer, types a phone, then clicks
        // the address pill (intending to add address too), types address,
        // clicks Save — only the address gets saved; the phone is silently
        // dropped. Fix B auto-commits the in-progress entry before
        // switching types so neither value is lost.
        const uniqueName = `Contacto Switch ${Date.now()}`;

        await page.goto('/adopter/create');
        await dismissCountryBanner(page);

        await page.getByPlaceholder(/name|nombre/i).fill(uniqueName);

        // Open the composer. Default active type is `phone`.
        await page.getByTestId('ce-add-trigger').click();

        // Step 1: type a phone value while the composer is on `phone`.
        await page.locator('input[placeholder*="2345-6789"], input[placeholder*="+54"]').first().fill('11 5555-1234');

        // Step 2: click the `address` pill WITHOUT clicking Save first. This
        // is the exact prod-reported sequence. Pre-fix, the typed phone is
        // silently discarded; post-fix, it auto-commits before the pill
        // switch resolves.
        await page.getByTestId('ce-type-address').click();

        // Step 3: now type an address and click Save.
        await page.locator('input[placeholder*="Calle"], input[placeholder*="Street"]').first().fill('Avenida Test 123');
        await page.getByTestId('ce-composer-submit').click();

        // BOTH chips should now exist in the section. Pre-fix only the
        // address would be present (count=1) — this assertion is what
        // makes the regression visible if the fix ever regresses.
        const chips = page.getByTestId('ce-chip');
        await expect(chips).toHaveCount(2, { timeout: 10000 });

        // Save the adopter to confirm the entries persist through the
        // create flow (local-mode auto-commit landed in `entries`).
        await page.getByRole('button', { name: /save|guardar|create|crear/i }).click();
        const createAnywayBtn = page.getByRole('button', { name: /Create new profile anyway|Crear perfil nuevo/i });
        try {
            await createAnywayBtn.waitFor({ state: 'visible', timeout: 3000 });
            await createAnywayBtn.click();
        } catch {
            // No duplicates — fine.
        }

        // The saved profile shows both the phone and the address.
        await expect(page.getByRole('heading', { name: uniqueName })).toBeVisible({ timeout: 30000 });
        await expect(page.getByText('11 5555-1234')).toBeVisible({ timeout: 30000 });
        await expect(page.getByText('Avenida Test 123')).toBeVisible({ timeout: 30000 });
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
