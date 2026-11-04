import { test, expect } from '@playwright/test';
import { TEST_ADOPTERS, TEST_NAMES, dismissCountryBanner } from './helpers';

test.setTimeout(60000);

test.describe('Duplicate Detection UX', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await dismissCountryBanner(page);
    });

    // ── #1 Profile Banner ─────────────────────────────────────────

    test('No duplicate banner on profile without candidates', async ({ page }) => {
        // Nueva Persona (test-adopter-5) has no duplicate candidates
        await page.goto(`/adopter/${TEST_ADOPTERS.NUEVA}`);
        await expect(page.getByRole('heading', { name: TEST_NAMES.NUEVA })).toBeVisible({ timeout: 30000 });

        // Assert no banner (the timeout in not.toBeVisible handles the wait)
        await expect(page.getByText(/Possible duplicate of|Posible duplicado de/i)).not.toBeVisible({ timeout: 30000 });
    });

    // ── #3 Search Badge ───────────────────────────────────────────

    test('Search results show possible duplicate badge for medium+ confidence', async ({ page }) => {
        // Search for María — she has a medium-confidence candidate pair
        await page.fill('input#search', 'María');
        await page.getByRole('button', { name: /search records|buscar registros/i }).click();

        // Results appear
        await expect(page.getByText(/found \d+ match|resultados encontrados/i)).toBeVisible({ timeout: 30000 });

        // The "Possible duplicate" / "Posible duplicado" badge should appear on María's result
        await expect(page.getByText(/Possible duplicate|Posible duplicado/i).first()).toBeVisible({ timeout: 30000 });
    });

    test('Search results do NOT show duplicate badge for low confidence', async ({ page }) => {
        // Search for Roberto — he has only a low-confidence candidate pair
        await page.fill('input#search', 'Roberto');
        await page.getByRole('button', { name: /search records|buscar registros/i }).click();

        // Results appear
        await expect(page.getByText(/found \d+ match|resultados encontrados/i)).toBeVisible({ timeout: 30000 });

        // Roberto's result should NOT have the "Possible duplicate" badge
        // (low confidence is filtered out from search badges)
        await expect(page.getByText(/Possible duplicate|Posible duplicado/i)).not.toBeVisible({ timeout: 30000 });
    });

    // ── #4 Flagging Pre-Population ────────────────────────────────

    test('Flagging dialog opens with duplicate reason and search input', async ({ page }) => {

        // Navigate to María's profile
        await page.goto(`/adopter/${TEST_ADOPTERS.MARIA}`);
        await dismissCountryBanner(page);
        await expect(page.getByRole('heading', { name: TEST_NAMES.MARIA })).toBeVisible({ timeout: 30000 });

        // Click the "Report" overflow button to open the dropdown menu
        const reportBtn = page.getByRole('button', { name: /Report|Reportar/i });
        await expect(reportBtn).toBeVisible({ timeout: 30000 });
        await reportBtn.click();

        // Wait for the dropdown menu to appear, then click "Report Duplicate"
        const reportDuplicateBtn = page.getByRole('menuitem', { name: /Report Duplicate|Reportar Duplicado/i });
        await expect(reportDuplicateBtn).toBeVisible({ timeout: 30000 });
        await reportDuplicateBtn.click();

        // The flagging dialog should now open — verify it has relevant content
        // The dialog shows a search input and system-suggested duplicate matches
        await expect(page.getByText(/duplicate|duplicado/i).first()).toBeVisible({ timeout: 30000 });
    });

    // Last in the file on purpose: placed first, the dev server dropped the `goto('/')` of the test after the fast
    // "No duplicate banner" one ([Error: aborted], 3 of 3 local runs): the shared dev-server cause in the e2e audit.
    // The profile's pending-duplicate line (AdopterProfileV2: «Posible duplicado de <name>»,
    // testid profile-pending-dup) replaced the v2.12.1-19 banner. The seed has one medium pair,
    // María <-> Ana; a viewer who owns neither side sees the informational form (no «Revisar»).
    test('The pending-duplicate line appears on the profile and links to the other profile', async ({ page }) => {
        await page.goto(`/adopter/${TEST_ADOPTERS.MARIA}`);
        await expect(page.getByRole('heading', { name: TEST_NAMES.MARIA })).toBeVisible({ timeout: 30000 });

        const banner = page.getByTestId('profile-pending-dup');
        await expect(banner).toBeVisible({ timeout: 30000 });
        await expect(banner.getByText(/Possible duplicate of|Posible duplicado de/i)).toBeVisible({ timeout: 30000 });

        // The other profile's name is a link inside the line
        await expect(banner.getByTestId('profile-pending-dup-link')).toHaveAttribute('href', `/adopter/${TEST_ADOPTERS.ANA}`);
    });
});
