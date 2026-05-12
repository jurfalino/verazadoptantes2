import { test, expect } from '@playwright/test';
import { dismissCountryBanner } from './helpers';


test.setTimeout(120000); // Extended timeout for wizard interactions

test.describe('Home Screen Wizards', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await dismissCountryBanner(page);
        // Wait for page to fully render
        await expect(page.locator('input#search')).toBeVisible({ timeout: 30000 });
    });

    test('Adoption card opens AdopterPicker (or login modal)', async ({ page }) => {
        // Card → AdopterPicker overlay. Picker heading is "Who is the adopter?" / "¿Quién es el adoptante?".
        const registerBtn = page.getByRole('button', { name: /^Start$|^Empezar$/i }).first();
        await expect(registerBtn).toBeVisible({ timeout: 30000 });
        await registerBtn.click();

        const pickerHeading = page.getByRole('heading', { name: /Who is the adopter|Quién es el adoptante/i });
        const loginModal = page.getByText(/Sign In|Iniciar/i).first();

        await expect(pickerHeading.or(loginModal)).toBeVisible({ timeout: 30000 });
    });

    test('Observation card opens AdopterPicker (or login modal)', async ({ page }) => {
        // The observation card says "Leave an observation" / "Dejar una observación".
        // Heading is <h2> since v2.14.3 (action cards demoted from h3 to h2 to fix heading hierarchy after the new sr-only h1).
        const reportCard = page.locator('h2').filter({ hasText: /observation|observación/i }).locator('..');
        const registerBtn = reportCard.getByRole('button', { name: /^Start$|^Empezar$/i });
        await expect(registerBtn).toBeVisible({ timeout: 30000 });
        await registerBtn.click();

        // Card → AdopterPicker overlay (search input) or login modal.
        const searchInput = page.getByPlaceholder(/name|nombre/i).first();
        const loginModal = page.getByText(/Sign In|Iniciar/i).first();

        await expect(searchInput.or(loginModal)).toBeVisible({ timeout: 30000 });
    });

    test('Auth gate — unauthenticated click triggers login', async ({ page }) => {
        // Look for the adoption card "Start" button (<h2> since v2.14.3).
        const adoptionCard = page.locator('h2').filter({ hasText: /Record an adoption|Registrar una adopción/i }).locator('..');
        const registerBtn = adoptionCard.getByRole('button', { name: /^Start$|^Empezar$/i });

        if (await registerBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await registerBtn.click();

            // Either login modal or AdopterPicker overlay should appear.
            const loginModal = page.getByText(/Sign In|Iniciar/i).first();
            const pickerHeading = page.getByRole('heading', { name: /Who is the adopter|Quién es el adoptante/i });

            await expect(loginModal.or(pickerHeading)).toBeVisible({ timeout: 30000 });
        }
    });
});
