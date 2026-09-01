import { test, expect } from '@playwright/test';

/**
 * SCOPE — read before trusting this file. This asserts the OFF-state only, and
 * CI gets that state for free: the flag defaults false AND there is no
 * POSTHOG_PROJECT_KEY in CI, so the provider returns early on two independent
 * conditions. This test therefore passes even if the provider is completely
 * broken. Its real value is narrow: it catches a flag inversion, and it catches
 * PostHog loading when it should not.
 *
 * The feature's only genuine test is manual — plan Task 8 Step 5 on staging,
 * with a real project key and the admin toggle on. Do not read this spec as
 * coverage.
 */
test('does not load PostHog when the flag is off', async ({ page }) => {
    const ingestRequests: string[] = [];
    page.on('request', (r) => {
        if (r.url().includes('/ingest')) ingestRequests.push(r.url());
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    // The provider defers init by up to 3s; wait past that window.
    await page.waitForTimeout(4000);

    expect(ingestRequests).toEqual([]);
    const loaded = await page.evaluate(
        () => (window as unknown as { posthog?: { __loaded?: boolean } }).posthog?.__loaded ?? false
    );
    expect(loaded).toBe(false);
});
