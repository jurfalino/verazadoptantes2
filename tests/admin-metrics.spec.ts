import { test, expect } from '@playwright/test';

/**
 * /admin/metrics E2E (v-admin-metrics).
 *
 * This file's name doesn't match the `authed` project's filename convention
 * (`(?<![a-z])authed\.spec\.ts` — see playwright.config.ts), so it runs
 * under the default `user` (non-admin) project. Since /admin/metrics
 * requires an admin session (src/app/admin/layout.tsx redirects non-admins
 * to '/'), the admin scenario opens its own browser context with the admin
 * storage state — the same pattern forms.spec.ts and organizations.spec.ts
 * use for admin-only flows within a non-`authed`-named file.
 *
 * The access test needs a truly unauthenticated context (no session cookie
 * at all), so it also opens a fresh context rather than relying on the
 * `user` project's non-admin-but-still-logged-in session.
 */

test.describe('admin metrics dashboard', () => {
    test('admin sees the dashboard and can toggle the period', async ({ browser }) => {
        const context = await browser.newContext({ storageState: '.auth/admin.json' });
        const page = await context.newPage();

        await page.goto('/admin/metrics');

        await expect(page.getByRole('heading', { name: 'Métricas' })).toBeVisible({ timeout: 30000 });
        await expect(page.getByText('Salud operacional')).toBeVisible({ timeout: 30000 });
        await expect(page.getByText('Uso del producto')).toBeVisible({ timeout: 30000 });

        // Toggle to 30d — the button becomes the selected pill and the page doesn't crash.
        const thirtyDayBtn = page.getByRole('button', { name: '30d', exact: true });
        await expect(thirtyDayBtn).toBeVisible({ timeout: 30000 });
        await thirtyDayBtn.click();
        await expect(thirtyDayBtn).toHaveClass(/bg-teal-700/, { timeout: 30000 });

        // Errors card label is present (MetricCard renders whether Axiom returns
        // data or "no disponible" — assert on the label, not on a metric value).
        await expect(page.getByText('Errores')).toBeVisible({ timeout: 30000 });

        await context.close();
    });
});

test.describe('admin metrics — access', () => {
    test('unauthenticated is redirected away from /admin/metrics', async ({ browser }) => {
        // Completely fresh, unauthenticated context — no session cookie at all.
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.goto('/admin/metrics');

        // Middleware redirects to '/?callbackUrl=...&authRequired=true' before any
        // session/admin check runs — the final URL is never the metrics page.
        // (callbackUrl percent-encodes the path, so the negative check alone
        // would also pass on a no-op goto — assert the redirect actually fired.)
        expect(page.url()).not.toContain('/admin/metrics');
        expect(page.url()).toContain('authRequired=true');

        await context.close();
    });
});
