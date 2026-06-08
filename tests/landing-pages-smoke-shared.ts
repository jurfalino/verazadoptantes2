/**
 * Shared smoke-spec primitives (v2.19.15).
 *
 * Lives in a non-`.spec.ts` file so neither Playwright project's testMatch
 * picks it up as a runnable spec. Both `landing-pages-smoke.spec.ts`
 * (user session) and `landing-pages-authed.spec.ts` (admin session) import
 * from here.
 */

import { expect, Page, ConsoleMessage } from '@playwright/test';
import { dismissCountryBanner } from './helpers';

export interface SmokeRoute {
    path: string;
    /** Text or regex that must be visible to count the page as rendered. */
    anchor: RegExp | string;
    /** Some routes are slow on first paint (admin/audit fetches a big query). */
    timeout?: number;
}

/**
 * Hook the page's console events and accumulate any `error` calls into an
 * array. Returns a function that returns the array — call it AFTER the
 * page has settled.
 *
 * Filters a small allow-list of well-known third-party noise (favicon 404s,
 * extensions, occasional SW registration errors) so the assertion stays
 * signal-only.
 */
function trackConsoleErrors(page: Page): () => string[] {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        if (/favicon\.ico/.test(text)) return;
        if (/extension/.test(text)) return;
        if (/serviceworker/i.test(text) && /registration/i.test(text)) return;
        errors.push(text);
    });
    return () => errors;
}

/**
 * Run one route's smoke check: navigate, assert no 5xx, assert the anchor
 * is visible, assert no console errors. `expect.soft` so all three asserts
 * report at the end instead of bailing on the first miss — more useful in
 * CI than a stop-at-first-failure walk.
 */
export async function runSmokeRoute(page: Page, route: SmokeRoute): Promise<void> {
    const collectErrors = trackConsoleErrors(page);

    const response = await page.goto(route.path, {
        waitUntil: 'networkidle',
        timeout: route.timeout ?? 15000,
    });
    await dismissCountryBanner(page);

    // 1. HTTP status — 200/304/308 OK; any 4xx/5xx is a crash signal.
    expect(response, `${route.path}: no response`).not.toBeNull();
    const status = response?.status() ?? 0;
    expect.soft(status, `${route.path} HTTP status`).toBeLessThan(400);

    // 2. Expected anchor — proves React mounted and first paint happened.
    await expect(page.getByText(route.anchor).first()).toBeVisible({
        timeout: route.timeout ?? 15000,
    });

    // 3. No console errors during render. This is the assertion that would
    // have caught v2.19.13's `TypeError: e.getTime is not a function` in
    // one shot.
    const errors = collectErrors();
    expect.soft(errors, `${route.path} console errors`).toEqual([]);
}
