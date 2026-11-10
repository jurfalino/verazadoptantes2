import { test, expect } from '@playwright/test';
import { dismissCountryBanner } from './helpers';
import { rows } from './db';

/**
 * Mis adoptantes — sort, filter, pin, clear (Jon 2026-11-10, option E;
 * src/domain/adopterListView.ts). Runs as the admin. It pins one EXTRA filter
 * («Sin calificar») and unpins it at the end — it never touches the default
 * pins other specs click («Por formulario», «Desde un post»).
 * Selectors are data-testids: Chromium renders English.
 */

const ADMIN_USER_ID = 'test-admin-id';
/** The admin's stored pins, straight from the DB (the screen shows the defaults until its read returns). */
const storedPins = (): string => String(rows(`SELECT adopter_list_pins AS p FROM user_profiles WHERE user_id = '${ADMIN_USER_ID}'`)[0]?.p ?? '');

const numberOf = async (text: Promise<string>) => Number((await text).match(/\d+/)?.[0] ?? NaN);

test('Mis adoptantes: headers sort, the panel filters, a pinned filter stays after a reload, «Quitar filtros» resets', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/my-adopters');
    await dismissCountryBanner(page);
    const count = page.getByTestId('adopter-list-count');
    await expect(count).toBeVisible({ timeout: 60_000 });
    const total = await numberOf(page.getByTestId('filter-all-count').innerText());
    expect(total).toBeGreaterThan(1);

    // Sort by name with the header: A–Z, in the URL.
    await page.getByTestId('sort-name').click();
    await expect(page).toHaveURL(/orden=nombre/);
    const names = await page.locator('[data-testid="my-adopters-row"]:visible [data-testid="my-adopters-name"]').evaluateAll(
        (links) => links.slice(0, 6).map(a => (a.textContent ?? '').trim()));
    expect(names.length).toBeGreaterThan(1);
    expect([...names].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))).toEqual(names);

    // The panel: «Sin calificar» on, and pinned onto the screen.
    await page.getByTestId('adopter-list-filters').click();
    const panel = page.getByTestId('adopter-filters-panel');
    await expect(panel).toBeVisible();
    await panel.getByTestId('filter-check-rating-none').check();
    const pin = panel.getByTestId('filter-pin-toggle-rating-none');
    if ((await pin.getAttribute('aria-pressed')) !== 'true') await pin.click();
    await expect(pin).toHaveAttribute('aria-pressed', 'true');
    // Stored before anything reloads (the DB, not the screen: the screen shows the defaults until its read returns).
    await expect.poll(storedPins, { timeout: 30_000 }).toContain('rating:none');
    await panel.getByTestId('adopter-filters-done').click();
    await expect(panel).toHaveCount(0);

    // «Mostrando X de Y»: Y is still everyone; the pinned button is on.
    await expect(page).toHaveURL(/calificacion=sin/);
    await expect(count).toContainText(String(total));
    const shown = await numberOf(count.innerText());
    expect(shown).toBeLessThanOrEqual(total);
    const pinned = page.getByTestId('filter-pin-rating-none');
    await expect(pinned).toHaveAttribute('aria-pressed', 'true');

    // A reload keeps both: the filter (URL) and the pin (the person's own preference).
    await page.reload();
    await dismissCountryBanner(page);
    await expect(page.getByTestId('filter-pin-rating-none')).toHaveAttribute('aria-pressed', 'true', { timeout: 60_000 });

    // «Quitar filtros»: everyone again, the order kept.
    await page.getByTestId('adopter-list-clear').click();
    await expect(page).not.toHaveURL(/calificacion=/);
    await expect(page).toHaveURL(/orden=nombre/);
    await expect(page.getByTestId('adopter-list-clear')).toHaveCount(0);

    // Leave the pins as they were.
    await page.getByTestId('adopter-list-filters').click();
    const unpin = page.getByTestId('adopter-filters-panel').getByTestId('filter-pin-toggle-rating-none');
    await unpin.click();
    await expect(unpin).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('adopter-filters-panel').getByTestId('adopter-filters-done').click();
    // Saved, not just shown: the stored value no longer has it.
    await expect.poll(storedPins, { timeout: 30_000 }).not.toContain('rating:none');
});
