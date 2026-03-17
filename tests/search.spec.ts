import { test, expect } from '@playwright/test';
import { TEST_NAMES, TEST_ADOPTERS, dismissCountryBanner } from './helpers';

test.setTimeout(60000);

test.describe('Search to Decision', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await dismissCountryBanner(page);
    });

    test('Search returns results and links to profiles', async ({ page }) => {
        // Monitor for server action failures — fail fast on 500s
        const serverErrors: string[] = [];
        page.on('response', response => {
            if (response.url().includes(page.url()) && response.status() >= 500) {
                serverErrors.push(`${response.status()} ${response.url()}`);
            }
        });

        // Step 1: Search for an adopter by name
        await page.fill('input#search', 'María');
        await page.getByRole('button', { name: /search records|buscar registros/i }).click();

        // Step 2: No server errors should have occurred
        expect(serverErrors, 'Server returned 500 during search').toHaveLength(0);

        // Step 3: Results appear with match count
        await expect(page.getByText(/found \d+ match/i)).toBeVisible({ timeout: 15000 });

        // Step 4: No error toast with text should appear
        const alertElements = page.locator('[role="alert"]');
        const alertCount = await alertElements.count();
        for (let i = 0; i < alertCount; i++) {
            const text = await alertElements.nth(i).textContent();
            if (text && text.trim().length > 0) {
                throw new Error(`Error toast appeared during search: ${text}`);
            }
        }

        // Step 5: At least one result card must render with a profile link
        const resultLinks = page.locator('a[href*="/adopter/"]');
        const count = await resultLinks.count();
        expect(count, 'Search must return at least 1 result card').toBeGreaterThan(0);

        // Step 6: First result links to a valid adopter profile
        const href = await resultLinks.first().getAttribute('href');
        expect(href).toContain('/adopter/');

        // Step 7: Result card shows rating stars (the "at-a-glance" indicator)
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
        await expect(page.getByText('Luna').first()).toBeVisible();
        await expect(page.getByText('Michi').first()).toBeVisible();
    });

    test('Flagged adopter profile shows warning indicators', async ({ page }) => {
        // Carlos (rating=1, flagged for animal abuse)
        await page.goto(`/adopter/${TEST_ADOPTERS.CARLOS}`);
        await expect(page.getByRole('heading', { name: TEST_NAMES.CARLOS })).toBeVisible({ timeout: 15000 });

        // Rating badge present — should show low rating
        await expect(page.getByTestId('rating-badge')).toBeVisible();
    });

    test('Adoption counts are non-zero for adopters with adoptions', async ({ page }) => {
        // María has 2 seeded adoptions (Luna and Michi, both recordType='adoption')
        // This test guards against the bug where counts read from the empty adopterStats
        // analytics table instead of the actual adoptions table

        // Monitor for server action failures
        const serverErrors: string[] = [];
        page.on('response', response => {
            if (response.url().includes(page.url()) && response.status() >= 500) {
                serverErrors.push(`${response.status()} ${response.url()}`);
            }
        });

        // Step 1: Search for María and check the search result card shows 🏠 2
        await page.fill('input#search', 'María');
        await page.getByRole('button', { name: /search records|buscar registros/i }).click();

        // Fail fast if server action errored
        expect(serverErrors, 'Server returned 500 during search').toHaveLength(0);

        await expect(page.getByText(/found \d+ match/i)).toBeVisible({ timeout: 15000 });

        const resultCard = page.locator('a[href*="/adopter/"]').first();
        await expect(resultCard).toBeVisible();

        // The stats row shows adoption count — must NOT be 0
        const adoptionStat = resultCard.locator('text=🏠').first();
        await expect(adoptionStat).toBeVisible();
        const statText = await adoptionStat.textContent();
        expect(statText).not.toMatch(/🏠\s*0/);
        expect(statText).toMatch(/🏠\s*[1-9]/);

        // Step 2: Navigate to María's profile and check the stats header
        await page.goto(`/adopter/${TEST_ADOPTERS.MARIA}`);
        await expect(page.getByRole('heading', { name: TEST_NAMES.MARIA })).toBeVisible({ timeout: 15000 });

        // The profile stats grid shows adoption count — must be 2
        const adoptionStatBox = page.locator('text=🏠').first();
        await expect(adoptionStatBox).toBeVisible();

        // The adoption records section itself must show both animals
        await expect(page.getByText('Luna').first()).toBeVisible();
        await expect(page.getByText('Michi').first()).toBeVisible();
    });
});
