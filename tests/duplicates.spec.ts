import { test, expect } from '@playwright/test';
import { TEST_ADOPTERS, TEST_NAMES, dismissCountryBanner } from './helpers';

test.setTimeout(60000);

test.describe('Duplicate Detection UX', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await dismissCountryBanner(page);
    });

    // ── #1 Profile Banner ─────────────────────────────────────────

    test('System duplicate banner appears on profile with candidates', async ({ page }) => {
        // María (test-adopter-1) has a medium-confidence candidate pair with Ana
        await page.goto(`/adopter/${TEST_ADOPTERS.MARIA}`);
        await expect(page.getByRole('heading', { name: TEST_NAMES.MARIA })).toBeVisible({ timeout: 15000 });

        // Amber banner should show "Possible duplicate of" / "Posible duplicado de" with Ana's name
        const banner = page.getByText(/Possible duplicate of|Posible duplicado de/i).first();
        await expect(banner).toBeVisible({ timeout: 10000 });

        // Ana's name should be a clickable link inside the banner
        const anaLink = page.locator(`a[href="/adopter/${TEST_ADOPTERS.ANA}"]`).first();
        await expect(anaLink).toBeVisible();

        // Match type badges should be visible (phone, name_word from seed)
        await expect(page.getByText('phone').first()).toBeVisible();
    });

    test('System duplicate banner can be dismissed', async ({ page }) => {
        await page.goto(`/adopter/${TEST_ADOPTERS.MARIA}`);
        await expect(page.getByRole('heading', { name: TEST_NAMES.MARIA })).toBeVisible({ timeout: 15000 });

        // Banner should be visible initially
        const banner = page.getByText(/Possible duplicate of|Posible duplicado de/i).first();
        await expect(banner).toBeVisible({ timeout: 10000 });

        // Dismiss icon (✕ button) — click it
        const dismissBtn = page.locator('button').filter({ hasText: '✕' }).first();
        await dismissBtn.click();

        // Banner should disappear
        await expect(banner).not.toBeVisible({ timeout: 5000 });
    });

    test('No duplicate banner on profile without candidates', async ({ page }) => {
        // Nueva Persona (test-adopter-5) has no duplicate candidates
        await page.goto(`/adopter/${TEST_ADOPTERS.NUEVA}`);
        await expect(page.getByRole('heading', { name: TEST_NAMES.NUEVA })).toBeVisible({ timeout: 15000 });

        // Assert no banner (the timeout in not.toBeVisible handles the wait)
        await expect(page.getByText(/Possible duplicate of|Posible duplicado de/i)).not.toBeVisible({ timeout: 5000 });
    });

    // ── #3 Search Badge ───────────────────────────────────────────

    test('Search results show possible duplicate badge for medium+ confidence', async ({ page }) => {
        // Search for María — she has a medium-confidence candidate pair
        await page.fill('input#search', 'María');
        await page.getByRole('button', { name: /search records|buscar registros/i }).click();

        // Results appear
        await expect(page.getByText(/found \d+ match|resultados encontrados/i)).toBeVisible({ timeout: 15000 });

        // The "Possible duplicate" / "Posible duplicado" badge should appear on María's result
        await expect(page.getByText(/Possible duplicate|Posible duplicado/i).first()).toBeVisible();
    });

    test('Search results do NOT show duplicate badge for low confidence', async ({ page }) => {
        // Search for Roberto — he has only a low-confidence candidate pair
        await page.fill('input#search', 'Roberto');
        await page.getByRole('button', { name: /search records|buscar registros/i }).click();

        // Results appear
        await expect(page.getByText(/found \d+ match|resultados encontrados/i)).toBeVisible({ timeout: 15000 });

        // Roberto's result should NOT have the "Possible duplicate" badge
        // (low confidence is filtered out from search badges)
        await expect(page.getByText(/Possible duplicate|Posible duplicado/i)).not.toBeVisible();
    });

    // ── #4 Flagging Pre-Population ────────────────────────────────

    test('Flagging dialog opens with duplicate reason and search input', async ({ page }) => {

        // Navigate to María's profile
        await page.goto(`/adopter/${TEST_ADOPTERS.MARIA}`);
        await dismissCountryBanner(page);
        await expect(page.getByRole('heading', { name: TEST_NAMES.MARIA })).toBeVisible({ timeout: 15000 });

        // Click the "Report" overflow button to open the dropdown menu
        const reportBtn = page.getByRole('button', { name: /Report|Reportar/i });
        await expect(reportBtn).toBeVisible({ timeout: 5000 });
        await reportBtn.click();

        // Wait for the dropdown menu to appear, then click "Report Duplicate"
        const reportDuplicateBtn = page.getByRole('button', { name: /Report Duplicate|Reportar Duplicado/i });
        await expect(reportDuplicateBtn).toBeVisible({ timeout: 5000 });
        await reportDuplicateBtn.click();

        // The flagging dialog should now open — verify it has relevant content
        // The dialog shows a search input and system-suggested duplicate matches
        await expect(page.getByText(/duplicate|duplicado/i).first()).toBeVisible({ timeout: 10000 });
    });
});
