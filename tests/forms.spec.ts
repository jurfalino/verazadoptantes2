import { test, expect } from '@playwright/test';

test.describe('External Form & Notifications Lifecycle', () => {

    test('Share form link, anonymous submit, and owner receives notification', async ({ browser }) => {
        // --- Context A: Organization Owner (Admin user) ---
        const contextA = await browser.newContext({ storageState: '.auth/admin.json' });
        const pageA = await contextA.newPage();
        
        await pageA.goto('/my-animals');

        // 1. Open the "Share application form" menu
        const shareBtn = pageA.getByRole('button', { name: /Share application form|Compartir formulario/i, exact: true });
        await expect(shareBtn).toBeVisible({ timeout: 30000 });
        await shareBtn.click();

        // 2. Extract the user ID from the "Open in new tab" link
        const openLink = pageA.getByRole('link', { name: /Open in new tab|Abrir en nueva pestaña/i });
        await expect(openLink).toBeVisible({ timeout: 30000 });
        const href = await openLink.getAttribute('href');
        expect(href).toContain('u=');
        
        const urlParams = new URL(href!).searchParams;
        const userId = urlParams.get('u');
        expect(userId).toBeTruthy();

        // Close the share modal properly using Escape to ensure the animation finishes
        await pageA.keyboard.press('Escape');
        await expect(pageA.locator('.fixed.inset-0')).not.toBeVisible({ timeout: 10000 });

        // --- Context B: Anonymous User (API Level) ---
        const contextB = await browser.newContext(); // completely new unauthenticated context
        const apiRequest = contextB.request;
        
        const testName = `E2E Form Submitter ${Date.now()}`;
        const testEmail = `e2e-form-${Date.now()}@example.com`;

        // 3. Make the API request to submit the form pretending to be the Vite SPA
        const submitResponse = await apiRequest.post(`/api/form/${userId}/submit`, {
            data: {
                name: testName,
                email: testEmail,
                phone: '555-0100',
                address: '123 E2E Street',
                intent: 'Adopt a pet',
            }
        });
        
        const bodyText = await submitResponse.text();
        expect(submitResponse.ok(), `Response not ok: ${bodyText}`).toBeTruthy();
        const result = JSON.parse(bodyText);
        expect(result.success).toBe(true);
        const submissionId = result.submissionId;
        expect(submissionId).toBeTruthy();

        // --- Context A: Owner verification ---
        // 4. Verify notification bell lights up
        // Hard refresh to ensure layout fetches notifications (since websocket/polling might delay)
        // 5. Navigate the owner to a lighter page with the bell to avoid DB deadlocks
        await pageA.goto('/terms');
        await pageA.waitForLoadState('networkidle');

        const bell = pageA.getByRole('button', { name: /Notifications|Notificaciones/i });
        // The bell should have a red dot (or unread count)
        const unreadBadge = bell.locator('.bg-red-500');
        await expect(unreadBadge).toBeVisible({ timeout: 30000 });

        // 5. Open notifications and click the form result notification
        await expect(async () => {
            // Ensure the bell is clicked and dropdown is open
            if (!await pageA.locator('.max-h-80.overflow-y-auto').isVisible()) {
                await bell.click();
                // Wait for the fetch to complete
                await pageA.waitForLoadState('networkidle');
            }
            
            const dropdownPanel = pageA.locator('div').filter({ hasText: /Notificaciones|Notifications/ }).filter({ hasText: /Marcar todo leído|Mark all read|Sin notificaciones|No notifications/ }).first();
            const panelText = await dropdownPanel.textContent().catch(() => 'NOT FOUND');
            console.log('Dropdown panel full text:', panelText);
            
            const notificationItem = pageA.locator(`text=${testName}`).first();
            await expect(notificationItem).toBeVisible({ timeout: 5000 });
            await notificationItem.click();
        }).toPass({ timeout: 30000 });

        // 7. Assert the form results page displays the submitted data properly
        await expect(pageA).toHaveURL(new RegExp(`/form-results/${submissionId}`), { timeout: 30000 });
        await expect(pageA.getByText(testName).first()).toBeVisible({ timeout: 30000 });
        await expect(pageA.getByText(testEmail).first()).toBeVisible({ timeout: 30000 });
        
        // Ensure "Create new profile" link is visible, proving it's an actionable form result
        const createProfileLink = pageA.getByRole('link', { name: /Create new profile|Crear nuevo perfil/i }).first();
        await expect(createProfileLink).toBeVisible({ timeout: 30000 });
    });
});
