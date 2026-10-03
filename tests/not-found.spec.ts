import { test, expect } from '@playwright/test';

test.describe('404 page', () => {
    test('an unknown URL shows the friendly 404 with both actions', async ({ page }) => {
        const res = await page.goto('/esta-ruta-no-existe-404');
        expect(res?.status()).toBe(404);
        const root = page.getByTestId('not-found-page');
        await expect(root).toBeVisible({ timeout: 30000 });
        await expect(root).toHaveAttribute('data-variant', /^(dog|cat)$/);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(
            /(dog ate|perro se comió|cachorro comeu|cat knocked|gato tiró|gato derrubou)/i,
        );
        await expect(root.getByRole('link', { name: /home|inicio|início/i })).toHaveAttribute('href', '/');
        await expect(root.getByRole('button', { name: /go back|volver atrás|voltar/i })).toBeVisible();
    });

    test('a missing adopter lands on the same 404', async ({ page }) => {
        await page.goto('/adopter/no-existe-404-fixture');
        await expect(page.getByTestId('not-found-page')).toBeVisible({ timeout: 30000 });
    });

    test('an unknown form result 404s instead of the old grey box', async ({ page }) => {
        await page.goto('/form-results/no-existe-404-fixture');
        await expect(page.getByTestId('not-found-page')).toBeVisible({ timeout: 30000 });
    });
});
