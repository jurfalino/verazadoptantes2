import { test, expect } from '@playwright/test';
import { TEST_ADOPTERS, TEST_NAMES } from './helpers';

test.setTimeout(90000);

test.describe('Authenticated User', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        // Session cookie was injected by auth.setup.ts — verify it worked
        await expect(page.getByText('Test Admin')).toBeVisible({ timeout: 15000 });
    });

    test('Auth session is valid — header shows user, no Sign In button', async ({ page }) => {
        // Sign In button should NOT be visible
        await expect(page.getByRole('button', { name: /Sign In/i })).not.toBeVisible({ timeout: 3000 });

        // User name should be in the nav
        const header = page.locator('nav');
        await expect(header).toBeVisible();
    });

    test('Search shows unmasked names for authenticated user', async ({ page }) => {
        await page.fill('input#search', TEST_NAMES.MARIA);
        await page.getByRole('button', { name: /search records|buscar registros/i }).click();

        await expect(page.getByText(/found \d+ match/i)).toBeVisible({ timeout: 15000 });

        // Authenticated users see full names (not PII-masked)
        await expect(page.getByText(TEST_NAMES.MARIA).first()).toBeVisible({ timeout: 5000 });
    });

    test('Full adoption record: add adoption → verify in history', async ({ page }) => {
        const animalName = `TestAnimal-${Date.now()}`;

        // Step 1: Navigate to test adopter (Nueva Persona — clean slate)
        await page.goto(`/adopter/${TEST_ADOPTERS.NUEVA}`);
        await expect(page.getByRole('heading', { name: TEST_NAMES.NUEVA })).toBeVisible({ timeout: 15000 });

        // Step 2: Click the "+ Record New Adoption" button to open the form
        const openFormBtn = page.getByRole('button', { name: /Record New Adoption/i });
        await expect(openFormBtn).toBeVisible({ timeout: 5000 });
        await openFormBtn.click();

        // Step 3: Fill in the adoption form
        // Animal name — the text input with Luna placeholder
        const animalInput = page.getByPlaceholder(/Luna/i);
        await expect(animalInput).toBeVisible({ timeout: 5000 });
        await animalInput.fill(animalName);

        // Species — select dog from dropdown
        const speciesSelect = page.locator('select').first();
        await speciesSelect.selectOption('dog');

        // Details (optional)
        const detailsTextarea = page.getByPlaceholder(/details|detalles/i);
        if (await detailsTextarea.isVisible().catch(() => false)) {
            await detailsTextarea.fill('E2E test adoption record');
        }

        // Step 4: Submit the form
        const submitBtn = page.getByRole('button', { name: /Record Adoption|Registrar Adopción/i });
        await expect(submitBtn).toBeVisible();
        await submitBtn.click();

        // Step 5: Wait for save confirmation
        await page.waitForTimeout(3000);

        // Step 6: Verify the record persisted — reload and check
        await page.reload();
        await page.waitForLoadState('networkidle');

        // The Adoptions section starts open (defaultOpen=true), so the animal name
        // should be visible without any clicks. Scroll down to ensure it's in view.
        const adoptionsSection = page.locator('#adoptions-section');
        await adoptionsSection.scrollIntoViewIfNeeded();

        // The animal name should be visible as an h4 heading in the expanded section
        await expect(page.getByRole('heading', { name: animalName, level: 4 })).toBeVisible({ timeout: 10000 });
    });

    test('Import Wizard: text input reaches Step 2', async ({ page }) => {
        await page.goto('/import');
        await page.waitForLoadState('networkidle');

        // Wizard header visible
        await expect(page.getByRole('heading', { name: /Import Content|Importar Contenido/i })).toBeVisible({ timeout: 10000 });

        // The wizard has a text input for URL or text
        const inputField = page.getByPlaceholder(/paste|pegar|URL|text/i);
        await expect(inputField).toBeVisible();

        // Type sample adopter text
        await inputField.fill('María González adoptó un perro llamado Luna. Teléfono: 099123456.');

        // Continue button should become enabled
        const continueBtn = page.getByRole('button', { name: /Continue|Continuar/i });
        await expect(continueBtn).toBeEnabled({ timeout: 5000 });
        await continueBtn.click();

        // Step 2 should show "Review Content" heading
        await expect(page.getByRole('heading', { name: /Review Content|Revisar Contenido/i })).toBeVisible({ timeout: 10000 });

        // The extracted text should be visible in a textbox
        await expect(page.getByText('María González')).toBeVisible();
    });
});
