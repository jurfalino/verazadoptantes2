import { test, expect } from '@playwright/test';

test.setTimeout(60000);

async function loginAsAnon(page: any) {
    await page.goto('/?enable_anon=true');
    const skipButton = page.getByRole('button', { name: /Skip|guest|invitado|omitir/i });
    if (await skipButton.isVisible()) {
        await skipButton.click();
    }
    await expect(page.locator('input#search')).toBeVisible();
}

test.describe('Deep Search Functionality', () => {

    test.beforeEach(async ({ page }) => {
        await loginAsAnon(page);
    });

    test('Search by Main Name', async ({ page }) => {
        // Create
        const uniqueName = `SearchTarget_${Date.now()}`;
        await page.goto('/adopter/create');
        await page.getByPlaceholder(/Name/i).fill(uniqueName);
        await page.click('button[type="submit"]');
        await expect(page.getByText(uniqueName)).toBeVisible();

        // Search
        await page.goto('/');
        await page.fill('input#search', uniqueName);
        await page.click('button:has-text("Search")');

        // Context should NOT be visible (direct match)
        await expect(page.getByText(uniqueName).first()).toBeVisible();
        await expect(page.getByText('Matches history log')).not.toBeVisible();
    });

    test('Search by Family Member', async ({ page }) => {
        // Create
        const uniqueName = `FamilyHead_${Date.now()}`;
        const familyMember = `Spouse_${Date.now()}`;

        await page.goto('/adopter/create');
        await page.getByPlaceholder(/Name/i).fill(uniqueName);
        await page.getByPlaceholder(/List other family/i).fill(familyMember);
        await page.click('button[type="submit"]');

        // Search by Family Member name
        await page.goto('/');
        await page.fill('input#search', familyMember);
        await page.click('button:has-text("Search")');

        // Should find the HEAD profile
        await expect(page.getByText(uniqueName).first()).toBeVisible();
        // Should have context tag
        await expect(page.getByText('Matches family members')).toBeVisible();
    });

    test('Search by History (Old Name)', async ({ page }) => {
        // Create
        const oldName = `OldName_${Date.now()}`;
        await page.goto('/adopter/create');
        await page.getByPlaceholder(/Name/i).fill(oldName);
        await page.click('button[type="submit"]');

        // Edit name
        await page.click('button:has-text("Edit Details")');
        const newName = `NewName_${Date.now()}`;
        await page.getByPlaceholder(/Name/i).fill(newName);
        await page.click('button:has-text("Save")');

        // Search by OLD name
        await page.goto('/');
        await page.fill('input#search', oldName);
        await page.click('button:has-text("Search")');

        // Should find the NEW profile
        await expect(page.getByText(newName).first()).toBeVisible();
        // Should have context tag
        await expect(page.getByText('Matches history log')).toBeVisible();
    });

    test('Search by Adoption (Animal Name)', async ({ page }) => {
        // Create
        const adopterName = `AdopterWithDog_${Date.now()}`;
        await page.goto('/adopter/create');
        await page.getByPlaceholder(/Name/i).fill(adopterName);
        await page.click('button[type="submit"]');

        // Add adoption
        const animalName = `Rex_${Date.now()}`;
        await page.getByPlaceholder(/Luna/i).fill(animalName);
        // Select status 'Completed' (index 1)
        await page.selectOption('select', { index: 1 });
        await page.click('button:has-text("Record")');

        // Search by ANIMAL name
        await page.goto('/');
        await page.fill('input#search', animalName);
        await page.click('button:has-text("Search")');

        // Should find the adopter
        await expect(page.getByText(adopterName).first()).toBeVisible();
        // Should have context tag
        await expect(page.getByText('Matches adoption records')).toBeVisible();
    });

});
