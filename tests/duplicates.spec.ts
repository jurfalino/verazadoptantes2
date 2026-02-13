import { test, expect } from '@playwright/test';
import { TEST_ADOPTERS, TEST_NAMES } from './helpers';

test.setTimeout(60000);

test.describe('Duplicate Detection UX', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
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

        // Wait for page to settle, then assert no banner
        await page.waitForTimeout(2000);
        await expect(page.getByText(/Possible duplicate of|Posible duplicado de/i)).not.toBeVisible();
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
        await expect(page.getByRole('heading', { name: TEST_NAMES.MARIA })).toBeVisible({ timeout: 15000 });

        // Open the flagging dialog — click the "Report / Merge" text
        await page.click('text=/Report \\/ Merge|Reportar \\/ Unir/i');

        // Wait for the report dialog modal to appear
        await expect(page.getByText(/Find Original|Buscar Perfil Original/i).first()).toBeVisible({ timeout: 10000 });

        // Search input for finding original profile should be present
        await expect(page.getByPlaceholder(/Search by name|Buscar por nombre/i)).toBeVisible();

        // System suggestions should show Ana Martínez as a suggested match
        await expect(page.getByText(/System-suggested matches|Coincidencias sugeridas/i).first()).toBeVisible({ timeout: 5000 });
        await expect(page.getByText('Ana Mart').first()).toBeVisible();
    });
});
