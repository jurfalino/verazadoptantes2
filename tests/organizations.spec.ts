import { test, expect } from '@playwright/test';
import { dismissCountryBanner } from './helpers';

test.describe('Organizations & Multi-Tenancy', () => {

    test('Create organization, invite user, and share context', async ({ browser }) => {
        // --- Context A: Organization Owner (Admin user) ---
        const contextA = await browser.newContext({ storageState: '.auth/admin.json' });
        const pageA = await contextA.newPage();
        await pageA.goto('/organizations');
        await dismissCountryBanner(pageA);

        // 1. Create the Organization
        const orgName = `Test Rescue Org ${Date.now()}`;
        
        // Wait for the UI to load
        await expect(pageA.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30000 });

        // Check if the "empty state" Create button is there, or the "Create" button
        // The list looks for text "🏢"
        const createInput = pageA.getByPlaceholder(/Organization Name|Nombre de la organización/i);
        
        // If the collapsible button is there, click it
        const createBtnCol = pageA.getByRole('button', { name: /＋ Create Organization|＋ Crear Organización/i });
        if (await createBtnCol.isVisible()) {
            await createBtnCol.click();
        }

        await expect(createInput).toBeVisible({ timeout: 30000 });
        await createInput.fill(orgName);
        await pageA.getByRole('button', { name: /Create|Crear/i, exact: true }).click();

        // Assert the organization appears in the list
        await expect(pageA.getByRole('heading', { name: orgName })).toBeVisible({ timeout: 30000 });

        // 2. Generate Invite Link
        // Click the invite button for this specific org card
        // We find the org card by its heading, then locate the invite button within it
        const orgCard = pageA.locator('.bg-white', { has: pageA.getByRole('heading', { name: orgName }) });
        await orgCard.getByRole('button', { name: /Invite|Invitar/i }).click();

        // The invite URL should appear in a readonly text input
        const inviteInput = orgCard.locator('input[readonly]');
        await expect(inviteInput).toBeVisible({ timeout: 30000 });
        const inviteUrl = await inviteInput.inputValue();
        expect(inviteUrl).toContain('/invite/');

        // --- Context B: Invited User (Standard user) ---
        const contextB = await browser.newContext({ storageState: '.auth/user.json' });
        const pageB = await contextB.newPage();
        
        // 3. Accept Invite
        // Navigate to the invite URL directly
        await pageB.goto(inviteUrl);
        await dismissCountryBanner(pageB);

        // Accept the invitation if prompted (Auto-joins if authenticated)
        // Just wait for the redirect to organizations page
        await expect(pageB).toHaveURL(/\/organizations/, { timeout: 30000 });

        // Assert redirect to orgs page and the new org appears
        await expect(pageB).toHaveURL(/\/organizations/);
        await expect(pageB.getByRole('heading', { name: orgName })).toBeVisible({ timeout: 30000 });

        // 4. Verify Cross-Context Data Modification (Activity Feed/Shared Data)
        // User B modifies or adds a record, User A should see it if necessary.
        // For now, let's verify User B can see the org in their list.
        
        // Cleanup - User A deletes the org
        await orgCard.getByRole('button', { name: /Delete|Eliminar/i }).click();
        // Handle JS confirm dialog automatically
        pageA.on('dialog', dialog => dialog.accept());
        await pageA.waitForTimeout(1000);
    });
});
