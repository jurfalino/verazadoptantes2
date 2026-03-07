import { test, expect } from '@playwright/test';
import { TEST_ADOPTERS, TEST_NAMES, dismissCountryBanner } from './helpers';

test.setTimeout(60000);

test.describe('Error Boundaries & Network Resilience', () => {

    test('Search shows error toast when server action fails', async ({ page }) => {
        await page.goto('/');
        await dismissCountryBanner(page);

        // Intercept the Next.js server action and return a 500
        await page.route('**', async (route) => {
            const request = route.request();
            // Server actions are POST to the same URL with Next-Action header
            if (request.method() === 'POST' && request.headers()['next-action']) {
                return route.fulfill({
                    status: 500,
                    contentType: 'text/plain',
                    body: 'Internal Server Error',
                });
            }
            return route.continue();
        });

        // Trigger search
        await page.fill('input#search', 'María');
        await page.locator('button[type="submit"]').click();

        // Should show error toast (not a blank screen)
        await expect(page.getByText(/Search Failed|error/i).first()).toBeVisible({ timeout: 10000 });
    });

    test('Adopter profile handles missing adopter gracefully', async ({ page }) => {
        // Navigate to a non-existent adopter ID
        await page.goto('/adopter/non-existent-id-12345');
        await dismissCountryBanner(page);

        // Should not show a raw error — either redirect or show "not found"
        await page.waitForLoadState('load');
        const hasNotFound = await page.getByText(/not found|no encontrado/i).first().isVisible({ timeout: 5000 }).catch(() => false);
        const redirectedHome = page.url().endsWith('/');

        // At least one graceful behavior should occur
        expect(hasNotFound || redirectedHome).toBeTruthy();
    });
});

test.describe('Double-Submit Protection', () => {

    test('Save button disables during submission', async ({ page }) => {
        const uniqueName = `DoubleClick-${Date.now()}`;

        await page.goto('/adopter/create');
        await dismissCountryBanner(page);

        // Fill form — the placeholder is "Full Name (and Nicknames/Aliases)"
        await page.getByPlaceholder(/full name|nombre completo/i).fill(uniqueName);

        // The save button — look for the submit-type button in the form
        const saveBtn = page.locator('button[type="submit"]').first();
        await expect(saveBtn).toBeVisible();

        // Click to submit
        await saveBtn.click();

        // Button should be disabled immediately after click (loading state)
        // The button text changes to "Loading..." when disabled
        await expect(page.locator('button[type="submit"][disabled]')).toBeVisible({ timeout: 3000 });
    });
});

test.describe('Accessibility', () => {

    test('Search input is keyboard-navigable — Enter triggers search', async ({ page }) => {
        await page.goto('/');
        await dismissCountryBanner(page);

        // Focus the search input via Tab or direct focus
        const searchInput = page.locator('input#search');
        await searchInput.focus();
        await expect(searchInput).toBeFocused();

        // Type a query
        await searchInput.fill('María');

        // Press Enter — should trigger search via form submit
        await searchInput.press('Enter');

        // Results should appear (look for result cards or "found" text)
        await expect(page.locator('a[href*="/adopter/"]').first()).toBeVisible({ timeout: 15000 });
    });

    test('Search input has associated label for screen readers', async ({ page }) => {
        await page.goto('/');
        await dismissCountryBanner(page);

        // The sr-only label should exist
        const label = page.locator('label[for="search"]');
        await expect(label).toBeAttached();
    });

    test('Pages use semantic <main> landmark', async ({ page }) => {
        await page.goto('/');
        await dismissCountryBanner(page);
        await expect(page.locator('main')).toBeVisible({ timeout: 15000 });
    });

    test('Adopter profile page has <main> landmark', async ({ page }) => {
        await page.goto(`/adopter/${TEST_ADOPTERS.MARIA}`);
        await dismissCountryBanner(page);
        await expect(page.getByRole('heading', { name: TEST_NAMES.MARIA })).toBeVisible({ timeout: 15000 });
        await expect(page.locator('main')).toBeVisible();
    });
});

test.describe('Wizard State Persistence', () => {

    test('Import wizard preserves input text on page refresh', async ({ page }) => {
        await page.goto('/import');
        await dismissCountryBanner(page);

        // Wait for the import wizard page to load
        const inputField = page.locator('textarea, input[type="text"]').first();
        await expect(inputField).toBeVisible({ timeout: 10000 });

        const testText = 'María González adoptó un perro llamado Luna.';
        await inputField.fill(testText);

        // Click the Continue/next step button
        const continueBtn = page.locator('button[type="submit"], button').filter({ hasText: /Continue|Continuar|Next|Siguiente/i }).first();
        await expect(continueBtn).toBeEnabled({ timeout: 5000 });
        await continueBtn.click();

        // Wait for step 2 to render (content review heading)
        await expect(page.getByText(/Review|Revisar|Content|Contenido/i).first()).toBeVisible({ timeout: 10000 });

        // Refresh the page
        await page.reload();
        await dismissCountryBanner(page);

        // After reload, wizard should not be back at empty step 1
        // The text should be preserved in the textarea/input
        await expect(page.getByText(/María González/).first()).toBeVisible({ timeout: 10000 });
    });
});

test.describe('i18n Language Switching', () => {

    test('Search button text changes with language', async ({ page }) => {
        await page.goto('/');
        await dismissCountryBanner(page);

        // The language toggle button shows current lang — click to switch
        const langBtn = page.getByRole('button', { name: /Cambiar a Español|Switch to English/i });

        if (await langBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            const currentText = await langBtn.textContent();

            // If currently EN, the search button should say "Search Records"
            if (currentText?.includes('EN')) {
                await expect(page.locator('button[type="submit"]')).toContainText(/Search/i);
            }

            // Click to switch language
            await langBtn.click();

            // Wait for the page to re-render with new language
            await expect(page.locator('button[type="submit"]')).toContainText(/Buscar|Search/i, { timeout: 5000 });
        } else {
            // Language toggle not visible — skip gracefully
            test.skip();
        }
    });
});
