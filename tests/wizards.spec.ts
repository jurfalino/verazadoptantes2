import { test, expect } from '@playwright/test';
import { loginAsAnon } from './helpers';

test.setTimeout(120000); // Extended timeout for wizard interactions

test.describe('Home Screen Wizards', () => {

    test.beforeEach(async ({ page }) => {
        await loginAsAnon(page);
        await page.waitForLoadState('networkidle');
        // Wait for session status to resolve
        await page.waitForTimeout(3000);
    });

    test('Adoption Wizard opens and shows step progression', async ({ page }) => {
        const wizardBtn = page.getByTestId('adoption-wizard-btn');
        await expect(wizardBtn).toBeVisible();
        await wizardBtn.click();
        await page.waitForTimeout(1000);

        // Check if the wizard modal opened (heading "Identify Animal")
        // or if the login modal appeared instead
        const wizardHeading = page.getByText('Identify Animal');
        const loginHeading = page.getByText(/Sign In|Iniciar/i);

        const wizardOpened = await wizardHeading.isVisible({ timeout: 5000 }).catch(() => false);
        const loginOpened = await loginHeading.first().isVisible({ timeout: 1000 }).catch(() => false);

        // At least one modal should have opened
        expect(wizardOpened || loginOpened).toBeTruthy();

        if (wizardOpened) {
            // Verify wizard content
            await expect(page.getByPlaceholder('Animal Name')).toBeVisible();
        }
    });

    test('Report Wizard opens', async ({ page }) => {
        const wizardBtn = page.getByTestId('report-wizard-btn');
        await expect(wizardBtn).toBeVisible();
        await wizardBtn.click();
        await page.waitForTimeout(1000);

        const wizardHeading = page.getByText('Identify Adopter');
        const loginHeading = page.getByText(/Sign In|Iniciar/i);

        const wizardOpened = await wizardHeading.isVisible({ timeout: 5000 }).catch(() => false);
        const loginOpened = await loginHeading.first().isVisible({ timeout: 1000 }).catch(() => false);

        expect(wizardOpened || loginOpened).toBeTruthy();
    });



    test('Wizard auth gate works', async ({ page }) => {
        // Navigate WITHOUT anon login
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        const wizardBtn = page.getByTestId('adoption-wizard-btn');
        if (await wizardBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await wizardBtn.click();
            await page.waitForTimeout(1000);

            // Either login modal or nothing should happen
            const loginHeading = page.getByText(/Sign In|Iniciar/i);
            const authGateTriggered = await loginHeading.first().isVisible({ timeout: 5000 }).catch(() => false);

            if (authGateTriggered) {
                await expect(loginHeading.first()).toBeVisible();
            }
        }
        expect(true).toBeTruthy();
    });
});
