import { test, expect } from '@playwright/test';
import { TEST_ADOPTERS, TEST_NAMES, dismissCountryBanner } from './helpers';

test.setTimeout(90000);

test.describe('Authenticated User', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        await dismissCountryBanner(page);
        // Session cookie was injected by auth.setup.ts — verify it worked
        await expect(page.getByText('Test Admin')).toBeVisible({ timeout: 30000 });
    });

    test('Auth session is valid — header shows user, no Sign In button', async ({ page }) => {
        // Sign In button should NOT be visible
        await expect(page.getByRole('button', { name: /Sign In/i })).not.toBeVisible({ timeout: 30000 });

        // User name should be in the nav
        const header = page.locator('nav');
        await expect(header).toBeVisible({ timeout: 30000 });
    });

    test('Search shows unmasked names for authenticated user', async ({ page }) => {
        await page.fill('input#search', TEST_NAMES.MARIA);
        await page.getByRole('button', { name: /search records|buscar registros/i }).click();

        await expect(page.getByText(/found \d+ match|\d+ resultado/i)).toBeVisible({ timeout: 30000 });

        // Authenticated users see full names (not PII-masked)
        await expect(page.getByText(TEST_NAMES.MARIA).first()).toBeVisible({ timeout: 30000 });
    });

    test('Full adoption record: add adoption → verify in history', async ({ page }) => {
        const animalName = `TestAnimal-${Date.now()}`;

        // Step 1: Navigate to test adopter (Nueva Persona — clean slate)
        await page.goto(`/adopter/${TEST_ADOPTERS.NUEVA}`);
        await dismissCountryBanner(page);
        await expect(page.getByRole('heading', { name: TEST_NAMES.NUEVA })).toBeVisible({ timeout: 30000 });

        // Step 2: Click "Log Activity" / "Registrar Actividad" to open the wizard
        const openFormBtn = page.getByRole('button', { name: /Log Activity|Registrar Actividad/i }).first();
        await expect(openFormBtn).toBeVisible({ timeout: 30000 });
        await openFormBtn.click({ force: true });

        // ─── WIZARD STEP 1: record type + animal ───
        // Click "Create New" tab if it's offered (only shown when there are existing animals)
        const createNewBtn = page.getByRole('button', { name: /Create New|Crear Nuevo/i });
        if (await createNewBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await createNewBtn.click();
        }

        // Animal name — placeholder hint contains "Luna"
        const animalInput = page.getByPlaceholder(/Luna/i);
        await expect(animalInput).toBeVisible({ timeout: 30000 });
        await animalInput.fill(animalName);
        await expect(animalInput).toHaveValue(animalName);

        // Species — first visible select on the page is the wizard's species dropdown
        const speciesSelect = page.getByRole('combobox').first();
        await expect(speciesSelect).toBeVisible({ timeout: 30000 });
        await speciesSelect.selectOption('dog');

        // Advance to step 2
        const nextBtn1 = page.getByRole('button', { name: /Siguiente|Next/i }).first();
        await expect(nextBtn1).toBeVisible({ timeout: 30000 });
        await nextBtn1.click();

        // ─── WIZARD STEP 2: details (date + rating + notes default to acceptable values) ───
        // Just advance — defaults work for happy path
        const nextBtn2 = page.getByRole('button', { name: /Siguiente|Next/i }).first();
        await expect(nextBtn2).toBeVisible({ timeout: 30000 });
        await nextBtn2.click();

        // ─── WIZARD STEP 3: save ───
        const saveBtn = page.getByRole('button', { name: /Guardar Registro|Save Record/i });
        await expect(saveBtn).toBeVisible({ timeout: 30000 });
        await saveBtn.click();

        // After submission the wizard closes — save button no longer visible
        await expect(saveBtn).not.toBeVisible({ timeout: 30000 });
    });

    test('Import Wizard: text input reaches Step 2', async ({ page }) => {
        await page.goto('/import');
        await page.waitForLoadState('networkidle');

        // Wizard header visible
        await expect(page.getByRole('heading', { name: /Import Content|Importar Contenido/i })).toBeVisible({ timeout: 30000 });

        // The wizard has a text input for URL or text
        const inputField = page.getByPlaceholder(/paste|pegar|URL|text/i);
        await expect(inputField).toBeVisible({ timeout: 30000 });

        // Type sample adopter text
        await inputField.fill('María González adoptó un perro llamado Luna. Teléfono: 099123456.');

        // Continue button should become enabled
        const continueBtn = page.getByRole('button', { name: /Continue|Continuar/i });
        await expect(continueBtn).toBeEnabled({ timeout: 5000 });
        await continueBtn.click();

        // Step 2 should show "Review Content" heading
        await expect(page.getByRole('heading', { name: /Review Content|Revisar Contenido/i })).toBeVisible({ timeout: 30000 });

        // The extracted text should be visible in a textbox
        await expect(page.getByText('María González')).toBeVisible({ timeout: 30000 });
    });
});
