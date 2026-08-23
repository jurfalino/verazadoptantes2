import { test, expect } from '@playwright/test';

/**
 * Metrics dashboard E2E (v-admin-metrics).
 *
 * The dashboard was folded from its own `/admin/metrics` page into a
 * collapsible "Métricas" section on the overview page (`/admin`) in v2.45.0.
 * It loads lazily — Axiom is only queried once the section is expanded.
 *
 * This file's name doesn't match the `authed` project's filename convention
 * (`(?<![a-z])authed\.spec\.ts` — see playwright.config.ts), so it runs under
 * the default `user` (non-admin) project. Since /admin requires an admin
 * session (src/app/admin/layout.tsx redirects non-mods/admins to '/'), the
 * admin scenario opens its own browser context with the admin storage state —
 * the same pattern forms.spec.ts and organizations.spec.ts use.
 */

test.describe('admin metrics dashboard (collapsible in overview)', () => {
    test('admin expands Métricas and can toggle the period', async ({ browser }) => {
        // Force Spanish: LanguageContext hydrates from navigator.language, and
        // Playwright's Chromium defaults to en — which would render the client
        // dashboard's i18n'd labels in English and miss the Spanish assertions.
        const context = await browser.newContext({ storageState: '.auth/admin.json', locale: 'es-AR' });
        // The admin storage state was captured under Playwright's default `en`
        // locale (localStorage app-locale='en'), which LanguageContext prefers
        // over navigator.language. Overwrite it before any app script runs.
        await context.addInitScript(() => {
            try { window.localStorage.setItem('app-locale', 'es'); } catch { /* noop */ }
        });
        const page = await context.newPage();

        await page.goto('/admin');

        // The Métricas section is collapsed and hasn't hit Axiom yet — expand it.
        const toggle = page.getByRole('button', { name: /Métricas/ });
        await expect(toggle).toBeVisible({ timeout: 30000 });
        await toggle.click();

        // Lazy fetch resolves → the dashboard's section labels appear.
        await expect(page.getByText('Salud operacional')).toBeVisible({ timeout: 30000 });
        await expect(page.getByText('Uso del producto')).toBeVisible({ timeout: 30000 });

        // Toggle to 30d — the button becomes the selected pill and nothing crashes.
        const thirtyDayBtn = page.getByRole('button', { name: '30d', exact: true });
        await expect(thirtyDayBtn).toBeVisible({ timeout: 30000 });
        await thirtyDayBtn.click();
        await expect(thirtyDayBtn).toHaveClass(/bg-teal-700/, { timeout: 30000 });

        // Errors card label is present (MetricCard renders whether Axiom returns
        // data or "no disponible" — assert on the label, not on a metric value).
        // exact:true so it doesn't also match the "Top errores (7 días)" heading.
        await expect(page.getByText('Errores', { exact: true })).toBeVisible({ timeout: 30000 });

        await context.close();
    });
});

test.describe('admin metrics — access', () => {
    test('unauthenticated is redirected away from /admin', async ({ browser }) => {
        // Completely fresh, unauthenticated context — no session cookie at all.
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.goto('/admin');

        // Middleware redirects an unauthenticated visit off /admin to the home
        // page before any admin check runs.
        expect(new URL(page.url()).pathname).toBe('/');

        await context.close();
    });
});
