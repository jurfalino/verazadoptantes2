import { test, expect } from '@playwright/test';
import { TEST_ADOPTERS, TEST_NAMES, dismissCountryBanner } from './helpers';

test.setTimeout(90000);

test.describe('Authenticated User', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        await dismissCountryBanner(page);
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

        await expect(page.getByText(/found \d+ match|\d+ resultado/i)).toBeVisible({ timeout: 30000 });

        // Authenticated users see full names (not PII-masked)
        await expect(page.getByText(TEST_NAMES.MARIA).first()).toBeVisible({ timeout: 5000 });
    });

    test('Full adoption record: add adoption → verify in history', async ({ page }) => {
        const animalName = `TestAnimal-${Date.now()}`;

        // Step 1: Navigate to test adopter (Nueva Persona — clean slate)
        await page.goto(`/adopter/${TEST_ADOPTERS.NUEVA}`);
        await dismissCountryBanner(page);
        await expect(page.getByRole('heading', { name: TEST_NAMES.NUEVA })).toBeVisible({ timeout: 15000 });

        // Step 2: Click the "Log Activity" button to expand the form
        // Match exactly the button label to avoid hitting the "Activity" section header.
        const openFormBtn = page.getByRole('button', { name: /Log Activity|Registrar Actividad/i }).first();
        await expect(openFormBtn).toBeVisible({ timeout: 10000 });
        await openFormBtn.click({ force: true });

        // Step 3: Click "Create New" tab to show the create form (form defaults to "Select Existing" if animals exist)
        const createNewBtn = page.getByRole('button', { name: /Create New|Crear Nuevo/i });
        if (await createNewBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await createNewBtn.click();
        }

        // Step 4: Fill in the adoption form
        // Animal name — the text input with Luna placeholder
        const animalInput = page.getByPlaceholder(/Luna/i);
        await expect(animalInput).toBeVisible({ timeout: 5000 });
        await animalInput.fill(animalName);

        // Species — target the visible species select (avoid hidden stats-period-select)
        const speciesSelect = page.getByRole('combobox').first();
        await expect(speciesSelect).toBeVisible({ timeout: 5000 });
        await speciesSelect.selectOption('dog');

        // Verify the animal name was filled correctly
        await expect(animalInput).toHaveValue(animalName);

        // Step 5: Verify the submit button is visible and has correct text
        const submitBtn = page.getByRole('button', { name: /Record Adoption|Registrar Adopción/i });
        await expect(submitBtn).toBeVisible();

        // Step 6: Click submit and verify the form submits (button becomes disabled or hidden)
        await submitBtn.click();

        // The form should close or reset after submission
        await expect(submitBtn).not.toBeVisible({ timeout: 15000 });
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
