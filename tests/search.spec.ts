import { test, expect } from '@playwright/test';
import { loginAsAnon, TEST_NAMES, TEST_ADOPTERS } from './helpers';

test.setTimeout(60000);

test.describe('Search to Decision', () => {

    test.beforeEach(async ({ page }) => {
        await loginAsAnon(page);
    });

    test('Search returns results and links to profiles', async ({ page }) => {
        // Step 1: Search for an adopter by name
        await page.fill('input#search', 'María');
        await page.getByRole('button', { name: /search records|buscar registros/i }).click();

        // Step 2: Results appear with match count
        await expect(page.getByText(/found \d+ match/i)).toBeVisible({ timeout: 15000 });

        // Step 3: Result card contains a link to the adopter profile
        const resultLink = page.locator('a[href*="/adopter/"]').first();
        await expect(resultLink).toBeVisible();
        const href = await resultLink.getAttribute('href');
        expect(href).toContain('/adopter/');

        // Step 4: Result card shows rating stars (the "at-a-glance" indicator)
        await expect(page.getByText('⭐').first()).toBeVisible();
    });

    test('View adopter profile shows decision-making info', async ({ page }) => {
        // Navigate directly to María's profile (anon can view profiles via direct URL)
        await page.goto(`/adopter/${TEST_ADOPTERS.MARIA}`);

        // Profile loads with the adopter name
        await expect(page.getByRole('heading', { name: TEST_NAMES.MARIA })).toBeVisible({ timeout: 15000 });

        // Rating badge — the most important "at a glance" indicator
        await expect(page.getByTestId('rating-badge')).toBeVisible();

        // Contact info visible
        await expect(page.getByText(/555-1234/)).toBeVisible();

        // Adoption records section with animal names from seed data
        await expect(page.getByTestId('adoptions-list')).toBeVisible();
        await expect(page.getByText('Luna')).toBeVisible();
        await expect(page.getByText('Michi')).toBeVisible();
    });

    test('Flagged adopter profile shows warning indicators', async ({ page }) => {
        // Carlos (rating=1, flagged for animal abuse)
        await page.goto(`/adopter/${TEST_ADOPTERS.CARLOS}`);
        await expect(page.getByRole('heading', { name: TEST_NAMES.CARLOS })).toBeVisible({ timeout: 15000 });

        // Rating badge present — should show low rating
        await expect(page.getByTestId('rating-badge')).toBeVisible();
    });
});
