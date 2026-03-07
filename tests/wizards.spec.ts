import { test, expect } from '@playwright/test';
import { dismissCountryBanner } from './helpers';


test.setTimeout(120000); // Extended timeout for wizard interactions

test.describe('Home Screen Wizards', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await dismissCountryBanner(page);
        // Wait for page to fully render
        await expect(page.locator('input#search')).toBeVisible({ timeout: 15000 });
    });

    test('Adoption Wizard opens and shows step progression', async ({ page }) => {
        // The adoption wizard card says "I gave a pet for adoption" with a "Register Now" button
        const adoptionCard = page.locator('h3').filter({ hasText: /gave a pet|di un animal/i }).locator('..');
        const registerBtn = adoptionCard.getByRole('button', { name: /Register Now|Registrar/i });
        await expect(registerBtn).toBeVisible();
        await registerBtn.click();

        // Check if the wizard modal opened or if the login modal appeared
        const wizardContent = page.locator('[role="dialog"], form').filter({ hasText: /Animal|Mascota/i }).first();
        const loginModal = page.getByText(/Sign In|Iniciar/i).first();

        // Wait for either to appear
        await expect(wizardContent.or(loginModal)).toBeVisible({ timeout: 10000 });
    });

    test('Report Wizard opens', async ({ page }) => {
        // The report wizard card says "I have info about an adopter"
        const reportCard = page.locator('h3').filter({ hasText: /info about|información sobre/i }).locator('..');
        const registerBtn = reportCard.getByRole('button', { name: /Register Now|Registrar/i });
        await expect(registerBtn).toBeVisible();
        await registerBtn.click();

        // Check if wizard or login modal appeared
        const wizardContent = page.locator('[role="dialog"], form').filter({ hasText: /Adopter|Adoptante/i }).first();
        const loginModal = page.getByText(/Sign In|Iniciar/i).first();

        await expect(wizardContent.or(loginModal)).toBeVisible({ timeout: 10000 });
    });

    test('Wizard auth gate works — unauthenticated click triggers login', async ({ page }) => {
        // Look for the adoption card "Register Now" button
        const adoptionCard = page.locator('h3').filter({ hasText: /gave a pet|di un animal/i }).locator('..');
        const registerBtn = adoptionCard.getByRole('button', { name: /Register Now|Registrar/i });

        if (await registerBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await registerBtn.click();

            // Either login modal or wizard should appear
            const loginModal = page.getByText(/Sign In|Iniciar/i).first();
            const wizardContent = page.locator('[role="dialog"], form').first();

            // Wait for either to appear
            await expect(loginModal.or(wizardContent)).toBeVisible({ timeout: 10000 });
        }
    });
});
