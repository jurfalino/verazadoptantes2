import { test, expect } from '@playwright/test';

test.describe('External Form & Notifications Lifecycle', () => {

    test('Share form link, anonymous submit, and owner receives notification', async ({ browser }) => {
        // --- Context A: Organization Owner (Admin user) ---
        const contextA = await browser.newContext({ storageState: '.auth/admin.json' });
        const pageA = await contextA.newPage();
        
        await pageA.goto('/my-animals');

        // 1. Open the "Share application form" menu
        const shareBtn = pageA.getByRole('button', { name: /Share application form|Compartir/i });
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

        // Close the share modal
        await pageA.click('.fixed.inset-0', { position: { x: 10, y: 10 } }); // click outside

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
        
        expect(submitResponse.ok()).toBeTruthy();
        const result = await submitResponse.json();
        expect(result.success).toBe(true);
        const submissionId = result.submissionId;
        expect(submissionId).toBeTruthy();

        // --- Context A: Owner verification ---
        // 4. Verify notification bell lights up
        // Hard refresh to ensure layout fetches notifications (since websocket/polling might delay)
        await pageA.goto('/my-adopters');

        const bell = pageA.getByRole('button', { name: /Notifications|Notificaciones/i });
        // The bell should have a red dot (or unread count)
        const unreadBadge = bell.locator('.bg-red-500');
        await expect(unreadBadge).toBeVisible({ timeout: 30000 });

        // 5. Open notifications and click the form result notification
        await bell.click();
        
        const notificationItem = pageA.getByRole('button', { name: new RegExp(testName, 'i') });
        await expect(notificationItem).toBeVisible({ timeout: 30000 });
        
        // 6. Navigate to the form results page
        await notificationItem.click();

        // 7. Assert the form results page displays the submitted data properly
        await expect(pageA).toHaveURL(new RegExp(`/form-results/${submissionId}`));
        await expect(pageA.getByRole('heading', { name: testName })).toBeVisible({ timeout: 30000 });
        await expect(pageA.getByText(testEmail)).toBeVisible({ timeout: 30000 });
        
        // Ensure "Convert to Adopter" button is visible, proving it's an actionable form result
        const convertBtn = pageA.getByRole('button', { name: /Convert to Adopter|Convertir/i });
        await expect(convertBtn).toBeVisible({ timeout: 30000 });
    });
});
