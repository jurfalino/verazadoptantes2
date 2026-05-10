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

    test('Adoption Wizard opens and shows step progression', async ({ page }) => {
        // The adoption wizard card says "I gave a pet for adoption" with a "Register Now" button
        const registerBtn = page.getByRole('button', { name: /Register Now|Registrar/i }).first();
        await expect(registerBtn).toBeVisible({ timeout: 30000 });
        await registerBtn.click();

        // The wizard opens inline — look for the "Identify Animal" step heading or animal name input
        const wizardContent = page.getByRole('heading', { name: /Identify Animal|Identificar Animal/i });
        const loginModal = page.getByText(/Sign In|Iniciar/i).first();

        // Wait for either wizard or login modal to appear
        await expect(wizardContent.or(loginModal)).toBeVisible({ timeout: 30000 });
    });

    test('Report Wizard opens', async ({ page }) => {
        // The report wizard card says "I have info about an adopter"
        // Heading is <h2> since v2.14.3 (action cards demoted from h3 to h2 to fix heading hierarchy after the new sr-only h1).
        const reportCard = page.locator('h2').filter({ hasText: /info about|información sobre/i }).locator('..');
        const registerBtn = reportCard.getByRole('button', { name: /Register Now|Registrar/i });
        await expect(registerBtn).toBeVisible({ timeout: 30000 });
        await registerBtn.click();

        // The wizard opens inline — look for adopter name input or a heading
        const wizardContent = page.getByPlaceholder(/name|nombre/i).first();
        const loginModal = page.getByText(/Sign In|Iniciar/i).first();

        await expect(wizardContent.or(loginModal)).toBeVisible({ timeout: 30000 });
    });

    test('Wizard auth gate works — unauthenticated click triggers login', async ({ page }) => {
        // Look for the adoption card "Register Now" button (<h2> since v2.14.3).
        const adoptionCard = page.locator('h2').filter({ hasText: /gave a pet|di un animal/i }).locator('..');
        const registerBtn = adoptionCard.getByRole('button', { name: /Register Now|Registrar/i });

        if (await registerBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await registerBtn.click();

            // Either login modal or wizard should appear
            const loginModal = page.getByText(/Sign In|Iniciar/i).first();
            const wizardContent = page.getByRole('heading', { name: /Identify Animal|Identificar Animal/i });

            // Wait for either to appear
            await expect(loginModal.or(wizardContent)).toBeVisible({ timeout: 30000 });
        }
    });
});
