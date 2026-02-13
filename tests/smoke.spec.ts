import { test, expect } from '@playwright/test';


test.setTimeout(60000);

test.describe('Smoke Tests', () => {

    test('Homepage loads correctly', async ({ page }) => {
        await page.goto('/');
        // Page title from metadata
        await expect(page).toHaveTitle(/BuenAdoptante/i);
        // Main heading should be visible
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
    });

    test('Authenticated user has access', async ({ page }) => {
        await page.goto('/');
        // After JWT auth, search input should be visible
        await expect(page.locator('input#search')).toBeVisible({ timeout: 15000 });
        // Footer with version badge
        await expect(page.locator('footer')).toBeVisible();
    });

    test('Navigation between pages works', async ({ page }) => {
        await page.goto('/');

        // Home page has search
        await expect(page.locator('input#search')).toBeVisible();

        // Navigate to create adopter
        await page.goto('/adopter/create');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });

        // Navigate back home
        await page.goto('/');
        await expect(page.locator('input#search')).toBeVisible({ timeout: 15000 });

        // Footer visible
        await expect(page.locator('footer')).toBeVisible();
    });

    test('Database schema matches expected columns', async ({ request }) => {
        const response = await request.get('/api/health');
        const body = await response.json();

        if (body.status === 'schema_mismatch') {
            const details = body.mismatches
                .map((m: any) => {
                    const parts = [`Table "${m.table}":`];
                    if (m.missing.length) parts.push(`  missing: ${m.missing.join(', ')}`);
                    if (m.extra.length) parts.push(`  extra: ${m.extra.join(', ')}`);
                    return parts.join('\n');
                })
                .join('\n');
            throw new Error(`Schema mismatch detected!\n${details}`);
        }

        expect(response.status()).toBe(200);
        expect(body.status).toBe('ok');
    });
});

