import { test, expect } from '@playwright/test';

// Configure 60s timeout for all tests
test.setTimeout(60000);

// Helper to ensure we are logged in
async function loginAsAnon(page: any) {
    // First, check if already logged in
    await page.goto('/');
    try {
        await expect(page.locator('input#search')).toBeVisible({ timeout: 5000 });
        console.log('Already logged in.');
        return;
    } catch (e) {
        console.log('Not logged in, attempting anon flow...');
    }

    await page.goto('/?enable_anon=true');
    const skipButton = page.getByRole('button', { name: /Skip|guest|invitado|omitir/i });
    if (await skipButton.isVisible()) {
        await skipButton.click();
    }

    // Wait longer for compilation/redirect
    await expect(page.locator('input#search')).toBeVisible({ timeout: 60000 });
}

test.describe('Adopter Lifecycle & Core Features', () => {

    test.beforeEach(async ({ page }) => {
        await loginAsAnon(page);
    });

    test('Create New Adopter', async ({ page }) => {
        await page.goto('/adopter/create');
        await expect(page.locator('h1')).toHaveText(/New Adopter|Nuevo Adoptante|Adopter Profile|Perfil de Adoptante/i);

        const testName = `Test User ${Date.now()}`;
        const testPhone = '555-0199';

        // Use placeholder selectors
        await page.getByPlaceholder(/John Doe|Juan Pérez/i).fill(testName);
        await page.getByPlaceholder(/Phone: 555-0123|Tel: 555-0123/i).fill(`Phone: ${testPhone}`);

        await page.click('button[type="submit"]');

        await expect(page).toHaveURL(/\/adopter\/\d+/);

        await expect(page.getByRole('heading', { name: /Adopter Profile|Perfil/i })).toBeVisible();
        await expect(page.getByText(testName)).toBeVisible();
    });

    test('Edit Adopter Profile', async ({ page }) => {
        const testName = `Edit Target ${Date.now()}`;
        await page.goto('/adopter/create');
        await page.getByPlaceholder(/John Doe|Juan Pérez/i).fill(testName);
        await page.click('button[type="submit"]');
        await expect(page.getByText(testName)).toBeVisible();

        await page.click('button:has-text("Edit Details"), button:has-text("Editar Detalles")');

        const newName = `${testName} Updated`;
        await page.getByPlaceholder(/John Doe|Juan Pérez/i).fill(newName);
        await page.click('button:has-text("Save"), button:has-text("Guardar")');

        await expect(page.getByText(newName)).toBeVisible();
    });

    test('Add and Edit Adoption Record', async ({ page }) => {
        await page.goto('/adopter/create');
        await page.getByPlaceholder(/John Doe|Juan Pérez/i).fill(`Adopter ${Date.now()}`);
        await page.click('button[type="submit"]');

        const animalName = 'Fluffy';

        await page.getByPlaceholder(/Luna/i).fill(animalName);
        await page.selectOption('select', { index: 1 });
        await page.click('button:has-text("Record Adoption"), button:has-text("Registrar Adopción")');

        await expect(page.getByText(animalName)).toBeVisible();
    });

    test('Upload Image (Mocked)', async ({ page }) => {
        await page.goto('/adopter/create');
        await page.getByPlaceholder(/John Doe|Juan Pérez/i).fill(`Image Target`);
        await page.click('button[type="submit"]');

        await expect(page.getByText(/No images uploaded|Aún no hay imágenes/i)).toBeVisible();
        await expect(page.locator('input[type="file"]')).toBeAttached();
    });

    test('Report Duplicate Profile', async ({ page }) => {
        // 1. Create a "Original" profile to search for
        const originalName = `Original User ${Date.now()}`;
        await page.goto('/adopter/create');
        await page.getByPlaceholder(/John Doe|Juan Pérez/i).fill(originalName);
        await page.click('button[type="submit"]');
        const originalId = page.url().split('/').pop();
        await expect(page.getByText(originalName)).toBeVisible();

        // 2. Create the "Duplicate" profile
        const duplicateName = `Duplicate User ${Date.now()}`;
        await page.goto('/adopter/create');
        await page.getByPlaceholder(/John Doe|Juan Pérez/i).fill(duplicateName);
        await page.click('button[type="submit"]');

        // 3. Open Report Modal - Use robust role selector
        // Note: The button has text "Report / Merge".
        const reportBtn = page.getByRole('button', { name: /Report|Merge|Reportar|Unir/i });
        await expect(reportBtn).toBeVisible();
        await reportBtn.click();

        // 4. Select Duplicate Reason (it is default)
        // Verify Modal Title
        await expect(page.locator('h3').filter({ hasText: /Report|Reportar/i })).toBeVisible();

        // 5. Search for Original
        const searchInput = page.getByPlaceholder(/Search by name|Buscar por nombre/i);
        await expect(searchInput).toBeVisible();
        await searchInput.fill(originalName);
        await page.waitForTimeout(1000); // 1s wait for debounce and network
        await searchInput.press('Enter');

        // 6. Select the result
        // Wait for results. We use .last() because sometimes input or other elements match text
        // Ideally use class or specific container
        const resultItem = page.locator('div').filter({ hasText: originalName }).last();
        await expect(resultItem).toBeVisible({ timeout: 10000 });
        await resultItem.click();

        // 7. Add Details
        await page.fill('textarea', 'This is a duplicate test.');

        // 8. Submit
        await page.click('button:has-text("Submit Report"), button:has-text("Enviar Reporte")');

        // 9. Verify Success/Banner
        await expect(page.getByText(/marked as a potential duplicate|marcado como posible duplicado/i)).toBeVisible();
        await expect(page.getByText(/Check if this profile is the original|Verifica si este perfil es el original/i)).toBeVisible();
    });

    test('Back to Search Navigation', async ({ page }) => {
        await page.goto('/adopter/create');
        await page.getByPlaceholder(/John Doe|Juan Pérez/i).fill(`Nav Tester`);
        await page.click('button[type="submit"]');
        await page.click('text=Back to Search');
        await expect(page).toHaveURL('/');
    });
});
