import { test, expect, request as playwrightRequest } from '@playwright/test';
import { dismissCountryBanner } from './helpers';
import { cleanupProfiles, createProfileViaApi, rows } from './householdFixtures';

/**
 * The new-profile form's «No es esta persona» is the same answer as everywhere
 * else (spec 2026-11-06, consistency rule): once the new profile is saved, the
 * pair with the rejected profile is recorded as two people. The rescuer loaded
 * both, so it settles. Data-testids only (Chromium renders English).
 */
const stamp = Date.now();
const s = String(stamp);
const PHONE = `11 4${s.slice(-3)}-${s.slice(-7, -3)}`;
const made: string[] = [];
test.afterAll(() => cleanupProfiles(made));

test('«No es esta persona», then save: the pair is recorded as two people', async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    const user = await playwrightRequest.newContext({ baseURL, storageState: '.auth/user.json' });
    const existing = await createProfileViaApi(user, { name: `Ya Existe No ${stamp}`, phone: PHONE });
    await user.dispose();
    made.push(existing);

    await page.goto('/adopter/create');
    await dismissCountryBanner(page);
    await page.getByTestId('adopter-name-input').fill(`Otra Persona No ${stamp}`);
    await page.getByTestId('ce-composer-input').fill(PHONE);
    await page.getByTestId('ce-composer-submit').click();
    const notThis = page.locator('[data-testid="strong-match-not-this"], [data-testid="dup-peek-not-this"]').first();
    // The matches sit behind the sticky bar («N posibles coincidencias — Revisar») unless the strip shows one.
    const bar = page.getByRole('button', { name: /^(Possible matches|Posibles coincidencias|Possíveis correspondências)$/ });
    await expect(notThis.or(bar)).toBeVisible({ timeout: 30_000 });
    if (!(await notThis.isVisible())) await bar.click();
    await expect(notThis).toBeVisible({ timeout: 30_000 });
    await notThis.click();
    await page.getByTestId('adopter-form-submit').click();
    // A save-time check may still ask about others: «Crear de todas formas».
    const anyway = page.getByTestId('save-dup-create-anyway');
    if (await anyway.isVisible({ timeout: 5_000 }).catch(() => false)) await anyway.click();
    await expect(page).toHaveURL(/\/adopter\/(?!create)[^/?]+/, { timeout: 30_000 });
    const newId = page.url().split('/adopter/')[1].split(/[?#]/)[0];
    made.push(newId);
    await expect.poll(() => rows(`SELECT status FROM duplicate_candidates WHERE (adopter1_id = '${newId}' AND adopter2_id = '${existing}') OR (adopter1_id = '${existing}' AND adopter2_id = '${newId}')`).map(r => r.status), { timeout: 30_000 }).toEqual(['dismissed']);
});
