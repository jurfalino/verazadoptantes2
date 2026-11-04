import { test, expect } from '@playwright/test';
import { TEST_ADOPTERS, TEST_NAMES, TEST_ANIMALS, dismissCountryBanner } from './helpers';
import { cleanupProfiles, insertProfile, USER_EMAIL } from './householdFixtures';

test.setTimeout(60000);

test.describe('Flags and Adoption History', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('Duplicate flag banner is displayed', async ({ page }) => {
        // Ana (test-adopter-3) is flagged as duplicate of María
        await page.goto(`/adopter/${TEST_ADOPTERS.ANA}`);

        // Wait for the profile to load — name in view mode is h2
        await expect(page.getByRole('heading', { name: TEST_NAMES.ANA })).toBeVisible({ timeout: 30000 });

        // Duplicate flag banner should be visible
        await expect(page.getByText(/duplicate|duplicado/i).first()).toBeVisible({ timeout: 30000 });
    });

    test('Adoption history displays correctly', async ({ page }) => {
        // Roberto (test-adopter-4) has 3 adoption records
        await page.goto(`/adopter/${TEST_ADOPTERS.ROBERTO}`);

        // Wait for profile to load
        await expect(page.getByRole('heading', { name: TEST_NAMES.ROBERTO })).toBeVisible({ timeout: 30000 });

        // Adoptions section should be visible
        await expect(page.getByTestId('adoptions-list')).toBeVisible({ timeout: 30000 });

        // Animal names from Roberto's 3 records should appear
        await expect(page.getByText(TEST_ANIMALS.FIRULAIS)).toBeVisible({ timeout: 30000 });
        await expect(page.getByText(TEST_ANIMALS.PELUSA)).toBeVisible({ timeout: 30000 });
        await expect(page.getByText(TEST_ANIMALS.ROCKY)).toBeVisible({ timeout: 30000 });

        // Species labels should be visible (may be English or Spanish depending on browser locale)
        // 'dog' → 'Dog'/'Perro', 'cat' → 'Cat'/'Gato'
        await expect(page.getByText(/Perro|Dog/i).first()).toBeVisible({ timeout: 30000 });
        await expect(page.getByText(/Gato|Cat/i).first()).toBeVisible({ timeout: 30000 });

        // Source URL: Firulais record has a Facebook source_url — link should be present
        const sourceLink = page.locator('a[href="https://www.facebook.com/groups/123/posts/456"]');
        await expect(sourceLink).toBeVisible({ timeout: 30000 });

        // Admin email hiding: Pelusa was added by admin (gatitosolivos@gmail.com) — should NOT appear
        await expect(page.getByText('gatitosolivos@gmail.com')).not.toBeVisible({ timeout: 30000 });
    });
});

/**
 * «Reportar inexactitud» in the profile's «⋯» menu is only for people who can't
 * fix the profile themselves (Jon 2026-10-31; EM review I5): hidden for its
 * owner, shown to a signed-in non-editor. Runs as the `user` project
 * (testuser@example.com: not an admin, in no org). Own rows
 * (test-inaccuracy-fixture-*), removed after. Selectors are data-testids:
 * Chromium renders English.
 */
test.describe('«Reportar inexactitud» in the «⋯» menu', () => {
    const stamp = Date.now();
    const OWN = `test-inaccuracy-fixture-own-${stamp}`;
    const OTHERS = `test-inaccuracy-fixture-other-${stamp}`;
    const OTHER_OWNER = `inaccuracy-owner-${stamp}@example.com`;

    test.beforeAll(() => {
        cleanupProfiles([OWN, OTHERS]);
        insertProfile({ id: OWN, name: `Inexactitud Propio ${stamp}`, owner: USER_EMAIL, contacts: [{ id: 'ce-own-1', type: 'phone', value: '11 4300-0001', addedBy: USER_EMAIL }] });
        insertProfile({ id: OTHERS, name: `Inexactitud Ajeno ${stamp}`, owner: OTHER_OWNER, contacts: [{ id: 'ce-oth-1', type: 'phone', value: '11 4300-0002', addedBy: OTHER_OWNER }] });
    });
    test.afterAll(() => cleanupProfiles([OWN, OTHERS]));

    test('absent for the profile\'s owner, present for a non-editor', async ({ page }) => {
        test.setTimeout(120_000);
        const openMenu = async (id: string) => {
            await page.goto(`/adopter/${id}`);
            await dismissCountryBanner(page);
            await page.getByTestId('profile-overflow').click();
            // The menu is open: «Solicitar eliminación» is there for everyone.
            await expect(page.getByTestId('profile-overflow-panel').getByTestId('profile-request-removal')).toBeVisible({ timeout: 30_000 });
        };

        await openMenu(OWN);
        await expect(page.getByTestId('profile-report-inaccuracy')).toHaveCount(0);

        await openMenu(OTHERS);
        await expect(page.getByTestId('profile-overflow-panel').getByTestId('profile-report-inaccuracy')).toBeVisible();
    });
});
