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
        // Force Spanish: LanguageContext hydrates from navigator.language, and
        // Playwright's Chromium defaults to en — which would render the client
        // dashboard's i18n'd labels in English and miss the Spanish assertions
        // below. es-AR matches the app's default locale (and the real audience).
        const context = await browser.newContext({ storageState: '.auth/admin.json', locale: 'es-AR' });
        // The admin storage state was captured under Playwright's default `en`
        // locale, so it carries `app-locale='en'` in localStorage — which
        // LanguageContext prefers over navigator.language. Overwrite it before any
        // app script runs so the client dashboard renders the Spanish labels below.
        await context.addInitScript(() => {
            try { window.localStorage.setItem('app-locale', 'es'); } catch { /* noop */ }
        });
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

        // Middleware redirects an unauthenticated visit off /admin/metrics to the
        // home page before any admin check runs. A non-redirect (no-op goto) would
        // leave the URL on /admin/metrics and fail the negative check, so the
        // redirect-to-home assertion below proves the gate actually fired.
        expect(page.url()).not.toContain('/admin/metrics');
        expect(new URL(page.url()).pathname).toBe('/');

        await context.close();
    });
});
