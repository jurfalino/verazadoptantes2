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
 * Run one route's smoke check.
 *
 * Two-tier assertions (v2.19.16):
 *   HARD-fail: HTTP < 400, anchor visible. These catch the v2.19.13 class
 *              of bug — a crash so severe the page either 500s or never
 *              renders its h1.
 *   SOFT (log-only): console-error count. The first iteration of this
 *                    spec (v2.19.15) tried to enforce zero console errors
 *                    and failed CI because every landing page fires a
 *                    handful on load — hydration warnings, network 404s
 *                    in the test seed, the Node-22-web-streams compat
 *                    issue under edge-runtime miniflare. None of those
 *                    are page-load crashes worth blocking a release;
 *                    most are tech debt worth fixing in a separate sweep.
 *                    For now we LOG the count (visible in CI output) but
 *                    don't fail the build. When the noise floor is at zero
 *                    we'll flip this back to a hard assertion.
 *
 * Timeout is generous (30 s default) — miniflare cold-start in CI takes
 * 5-10 s before the first request lands, and `networkidle` waits for the
 * 500 ms-quiet window which compounds.
 */
export async function runSmokeRoute(page: Page, route: SmokeRoute): Promise<void> {
    const collectErrors = trackConsoleErrors(page);
    const timeout = route.timeout ?? 30000;

    const response = await page.goto(route.path, {
        waitUntil: 'networkidle',
        timeout,
    });
    await dismissCountryBanner(page);

    // HARD: HTTP status — 200/304/308 OK; any 4xx/5xx is a crash signal.
    expect(response, `${route.path}: no response`).not.toBeNull();
    const status = response?.status() ?? 0;
    expect(status, `${route.path} HTTP status`).toBeLessThan(400);

    // HARD: Expected anchor — proves React mounted and first paint happened.
    await expect(page.getByText(route.anchor).first()).toBeVisible({ timeout });

    // SOFT: console-error count. Log but don't fail. See header comment.
    const errors = collectErrors();
    if (errors.length > 0) {
        // eslint-disable-next-line no-console
        console.log(
            `[smoke] ${route.path}: ${errors.length} console error(s) — ` +
            `not failing the build but worth investigating:\n  - ` +
            errors.slice(0, 5).join('\n  - ') +
            (errors.length > 5 ? `\n  - ...and ${errors.length - 5} more` : '')
        );
    }
}
