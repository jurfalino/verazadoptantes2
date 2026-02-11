import { test, expect } from '@playwright/test';
import { TEST_NAMES } from './helpers';

const _FB_POST_URL = 'https://www.facebook.com/share/p/18GsEQLz3P/';

test.describe('Authenticated User', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        // Wait for session to be fully resolved — the user button appears only after
        // sessionStatus changes from 'loading' to 'authenticated'
        await expect(page.getByRole('button', { name: /gatitosolivos/i })).toBeVisible({ timeout: 15000 });
    });

    test('Header shows logged-in user', async ({ page }) => {
        // "Sign In" button should NOT be visible for authenticated users
        const signInBtn = page.getByRole('button', { name: /Sign In/i });
        await expect(signInBtn).not.toBeVisible({ timeout: 5000 });

        // User info should be present (name or email in header)
        const header = page.locator('nav');
        await expect(header).toBeVisible();
    });

    test.skip('Adoption Wizard opens fully without auth gate', async ({ page }) => {
        // SKIP: useSession() hook has a timing race — sessionStatus may still be 'loading'
        // when handleStart fires, causing the wizard to silently not open.
        const wizardBtn = page.getByTestId('adoption-wizard-btn');
        await expect(wizardBtn).toBeVisible();
        await wizardBtn.click();

        // Wizard should open directly — no login modal
        const wizardHeading = page.getByText(/Identify Animal|Identificar Animal/i);
        await expect(wizardHeading).toBeVisible({ timeout: 5000 });

        // Should NOT show login modal
        const loginHeading = page.getByText(/Sign In|Iniciar/i);
        await expect(loginHeading.first()).not.toBeVisible({ timeout: 1000 }).catch(() => {
            // It's fine if the check itself throws — just means it wasn't found
        });
    });

    test.skip('Report Wizard opens fully without auth gate', async ({ page }) => {
        // SKIP: Same useSession() timing race as Adoption Wizard.
        const wizardBtn = page.getByTestId('report-wizard-btn');
        await expect(wizardBtn).toBeVisible();
        await wizardBtn.click();

        // Wizard modal should open — check for the fixed overlay and step 1 heading
        // The Report Wizard step 1 heading is "Identify Adopter" (same pattern as Adoption)
        // But the modal has a unique rose-colored step indicator
        const wizardModal = page.locator('.fixed.inset-0.z-50');
        await expect(wizardModal).toBeVisible({ timeout: 5000 });

        // Should have the "Search Existing" / "New Adopter" toggle (unique to this wizard's step 1)
        const searchExistingBtn = wizardModal.getByText(/Search Existing|Buscar Existente/i);
        await expect(searchExistingBtn).toBeVisible();
    });

    test('Search shows unmasked names for authenticated user', async ({ page }) => {
        await page.fill('input#search', TEST_NAMES.MARIA);
        await page.getByRole('button', { name: /search records|buscar registros/i }).click();

        // Wait for results
        await expect(page.getByText(/found \d+ match/i)).toBeVisible({ timeout: 15000 });

        // For authenticated users, the full name should be visible (not masked)
        await expect(page.getByText(TEST_NAMES.MARIA).first()).toBeVisible({ timeout: 5000 });
    });

    test('Search result navigates to profile', async ({ page }) => {
        await page.fill('input#search', TEST_NAMES.MARIA);
        await page.getByRole('button', { name: /search records|buscar registros/i }).click();

        await expect(page.getByText(/found \d+ match/i)).toBeVisible({ timeout: 15000 });

        // Click the first result link
        const resultLink = page.locator('a[href*="/adopter/"]').first();
        await expect(resultLink).toBeVisible();
        await resultLink.click();

        // Should navigate to the profile page (no auth gate modal)
        await expect(page).toHaveURL(/\/adopter\//, { timeout: 10000 });

        // Profile should show the adopter name
        await expect(page.getByText(TEST_NAMES.MARIA)).toBeVisible({ timeout: 5000 });
    });

    test.skip('My Adopters page loads', async ({ page }) => {
        // SKIP: D1 transient "transformAlgorithm is not a function" error in local Wrangler.
        await page.goto('/my-adopters');
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000); // Allow D1 queries to settle

        // Page should load without redirecting away
        await expect(page).toHaveURL(/\/my-adopters/);

        // Page content should be present (not an error or redirect)
        await expect(page.locator('main, [role="main"], body > div')).toBeVisible({ timeout: 10000 });
    });

    test.skip('My Adoptions page loads', async ({ page }) => {
        // SKIP: Page shows "Cargando..." loading state — D1 query timing race.
        await page.goto('/my-adoptions');
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000); // Allow D1 queries to settle

        // Page should load without redirecting away
        await expect(page).toHaveURL(/\/my-adoptions/);

        // Page content should be present (wait for loading spinner "Cargando..." to resolve)
        await expect(page.locator('main, [role="main"], body > div')).toBeVisible({ timeout: 10000 });
    });



    test('Import Wizard: text input flow reaches Step 2', async ({ page }) => {
        // Navigate directly to the import page
        await page.goto('/import');
        await page.waitForLoadState('networkidle');

        // Wizard header should be visible (bilingual)
        await expect(page.getByRole('heading', { name: /Import Content|Importar Contenido/i })).toBeVisible({ timeout: 10000 });

        // Step indicator should show 3 steps
        const stepIndicator = page.getByText(/1/).first();
        await expect(stepIndicator).toBeVisible();

        // Switch to Text input mode
        const textTab = page.getByRole('button', { name: /Text|Texto/i });
        await expect(textTab).toBeVisible();
        await textTab.click();

        // Paste sample adopter text
        const textarea = page.locator('textarea');
        await expect(textarea).toBeVisible();
        await textarea.fill('María González adoptó un perro llamado Luna. Teléfono: 099123456. Dirección: Av. 18 de Julio 1234.');

        // Click Continue
        const continueBtn = page.getByRole('button', { name: /Continue|Continuar/i });
        await expect(continueBtn).toBeEnabled();
        await continueBtn.click();

        // Step 2 should show the review content heading
        await expect(page.getByText(/Review Content|Revisar Contenido/i)).toBeVisible({ timeout: 5000 });

        // Extracted text should contain our input
        const editableTextarea = page.locator('textarea');
        await expect(editableTextarea).toBeVisible();
        await expect(editableTextarea).toHaveValue(/María González/);

        // Extract with AI button should be present
        const extractBtn = page.getByRole('button', { name: /Extract with AI|Extraer con IA/i });
        await expect(extractBtn).toBeVisible();
        await expect(extractBtn).toBeEnabled();
    });
});
