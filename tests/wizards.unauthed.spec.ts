import { test, expect } from '@playwright/test';
import { dismissCountryBanner } from './helpers';


test.setTimeout(120000); // Extended timeout for wizard interactions

/**
 * The homepage action cards are the GUEST homepage now: signed-in rescuers
 * get the homepage modules instead (2026-11-04), so this runs unauthenticated
 * and every «Start» must ask to sign in.
 */

test.describe('Home Screen Wizards', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await dismissCountryBanner(page);
        // Wait for page to fully render
        await expect(page.locator('input#search')).toBeVisible({ timeout: 30000 });
    });

    test('Adoption card asks a guest to sign in', async ({ page }) => {
        // Card → AdopterPicker overlay. Picker heading is "Who is the adopter?" / "¿Quién es el adoptante?".
        const registerBtn = page.getByRole('button', { name: /^Start$|^Empezar$/i }).first();
        await expect(registerBtn).toBeVisible({ timeout: 30000 });
        await registerBtn.click();

        await expect(page.getByText(/Sign In|Iniciar/i).first()).toBeVisible({ timeout: 30000 });
    });

    test('Observation card asks a guest to sign in', async ({ page }) => {
        // The observation card says "Leave an observation" / "Dejar una observación".
        // Heading is <h2> since v2.14.3 (action cards demoted from h3 to h2 to fix heading hierarchy after the new sr-only h1).
        const reportCard = page.locator('h2').filter({ hasText: /observation|observación/i }).locator('..');
        const registerBtn = reportCard.getByRole('button', { name: /^Start$|^Empezar$/i });
        await expect(registerBtn).toBeVisible({ timeout: 30000 });
        await registerBtn.click();

        // A guest gets the sign-in prompt (the homepage's own search box also says «name»).
        await expect(page.getByText(/Sign In|Iniciar/i).first()).toBeVisible({ timeout: 30000 });
    });

    test('Auth gate — unauthenticated click triggers login', async ({ page }) => {
        // Look for the adoption card "Start" button (<h2> since v2.14.3).
        const adoptionCard = page.locator('h2').filter({ hasText: /Record an adoption|Registrar una adopción/i }).locator('..');
        const registerBtn = adoptionCard.getByRole('button', { name: /^Start$|^Empezar$/i });

        await expect(registerBtn).toBeVisible({ timeout: 30000 });
        await registerBtn.click();

        // A guest gets the sign-in prompt, never the picker.
        await expect(page.getByText(/Sign In|Iniciar/i).first()).toBeVisible({ timeout: 30000 });
        await expect(page.getByRole('heading', { name: /Who is the adopter|Quién es el adoptante/i })).toHaveCount(0);
    });
});
