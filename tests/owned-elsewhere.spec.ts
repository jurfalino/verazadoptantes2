import { test, expect } from '@playwright/test';

// Runs as testuser@example.com (no org). Fixtures belong to e2e-teammate.
test.describe('Animal owned by another rescuer', () => {
    test('unlisted: owner + group, name tag, no public link, no email', async ({ page }) => {
        await page.goto('/my-animals/test-animal-fixture-owned-1');
        const root = page.getByTestId('owned-elsewhere');
        await expect(root).toBeVisible({ timeout: 30000 });
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Pirata (is in good hands|está en buenas manos|está em boas mãos)/);
        await expect(page.getByTestId('owned-elsewhere-owner')).toContainText('Vero E2E');
        await expect(page.getByTestId('owned-elsewhere-owner')).toContainText('Refugio E2E');
        await expect(page.getByTestId('owned-illustration')).toHaveAttribute('data-kind', 'tag');
        await expect(page.getByTestId('owned-elsewhere-public-link')).toHaveCount(0);
        await expect(page.locator('body')).not.toContainText('e2e-teammate@example.com');
    });

    test('listed: links to the public page in a new tab', async ({ page }) => {
        await page.goto('/my-animals/test-animal-fixture-owned-2');
        await expect(page.getByTestId('owned-elsewhere')).toBeVisible({ timeout: 30000 });
        await expect(page.getByTestId('owned-illustration')).toHaveAttribute('data-kind', 'dog');
        const link = page.getByTestId('owned-elsewhere-public-link');
        await expect(link).toHaveAttribute('href', /\/animal\/test-animal-fixture-owned-2$/);
        await expect(link).toHaveAttribute('target', '_blank');
    });

    test('a truly missing animal still gets the 404', async ({ page }) => {
        await page.goto('/my-animals/no-existe-404-fixture');
        await expect(page.getByTestId('not-found-page')).toBeVisible({ timeout: 30000 });
    });

    test('no horizontal scroll at phone width', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/my-animals/test-animal-fixture-owned-1');
        await expect(page.getByTestId('owned-elsewhere')).toBeVisible({ timeout: 30000 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
    });
});
