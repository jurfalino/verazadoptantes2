import { test, expect, request as playwrightRequest } from '@playwright/test';
import { dismissCountryBanner } from './helpers';
import { cleanupProfiles, createProfileViaApi, execD1 } from './householdFixtures';

/**
 * Three duplicate fixes (Jon, 2026-10-31), on his case: «Jonathan Urfalino»
 * (loaded first) and «Jonatan Urfalino» share a phone.
 *
 *   1. Pendientes and the admin «Unir perfiles» window propose keeping the
 *      same profile: the one loaded first (Jonathan).
 *   2. «⋯ Reportar duplicado» on Jonatan never lists Jonatan himself.
 *   3. A spreadsheet row identical to Jonathan also says «También coincide con
 *      Jonatan Urfalino», and «Actualizar este» makes Jonatan the one it updates.
 *
 * Admin project. SHOTS_DIR, when set, saves screenshots for the product owner.
 */
const stamp = Date.now();
const s = String(stamp);
const PHONE = `11 4${s.slice(-3)}-${s.slice(-7, -3)}`;
const PHONE_DIGITS = PHONE.replace(/\D/g, '');
const OLDER = `Jonathan Urfalino ${stamp}`;
const NEWER = `Jonatan Urfalino ${stamp}`;
const CAND = `test-dupfu-fixture-cand-${stamp}`;
let OLDER_ID = '';
let NEWER_ID = '';
const shot = (name: string) => (process.env.SHOTS_DIR ? { path: `${process.env.SHOTS_DIR}/${name}.png` } : undefined);

test.describe.serial('duplicate follow-ups: same survivor, no self, every sheet match', () => {
    test.beforeAll(async ({ baseURL }) => {
        const admin = await playwrightRequest.newContext({ baseURL, storageState: '.auth/admin.json' });
        OLDER_ID = await createProfileViaApi(admin, { name: OLDER, phone: PHONE });
        NEWER_ID = await createProfileViaApi(admin, { name: NEWER, phone: PHONE });
        await admin.dispose();
        execD1(`UPDATE adopters SET created_at = strftime('%s','now','-10 days') WHERE id = '${OLDER_ID}'`);
        // Stored in the order that used to make the admin window keep the NEWER one.
        execD1(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, match_values, score, confidence, status) VALUES ('${CAND}', '${NEWER_ID}', '${OLDER_ID}', '["phone","name_word"]', '{}', 90, 'high', 'pending')`);
    });
    // Screenshots for the product owner are in Spanish; the assertions are locale-agnostic.
    test.beforeEach(async ({ page }) => {
        if (process.env.SHOTS_DIR) await page.addInitScript(() => { try { localStorage.setItem('app-locale', 'es'); } catch { /* SSR-safe */ } });
    });
    test.afterAll(() => {
        execD1(`DELETE FROM duplicate_candidates WHERE id = '${CAND}' OR adopter1_id IN ('${OLDER_ID}','${NEWER_ID}') OR adopter2_id IN ('${OLDER_ID}','${NEWER_ID}')`);
        cleanupProfiles([OLDER_ID, NEWER_ID]);
    });

    test('1. Pendientes and the admin window propose keeping the profile loaded first', async ({ page }) => {
        test.setTimeout(180_000);
        await page.goto('/my-adopters#pendientes');
        await dismissCountryBanner(page);
        const row = page.locator(`[data-testid="dedup-row"][data-candidate-id="${CAND}"]`);
        await expect(row).toBeVisible({ timeout: 60_000 });
        const opener = row.locator('button[aria-expanded="false"]').first();
        if (await opener.count()) await opener.click();
        await expect(row.getByTestId('dedup-keep-existing')).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
        await row.screenshot(shot('fix1-pendientes'));

        await page.goto('/admin/data-quality');
        await page.getByRole('button', { name: /Duplicados/ }).click();
        const card = page.locator('div').filter({ hasText: OLDER }).filter({ hasText: NEWER }).filter({ has: page.getByRole('button', { name: /^(Unir|Merge)$/ }) }).last();
        await expect(card).toBeVisible({ timeout: 60_000 });
        await card.getByRole('button', { name: /^(Unir|Merge)$/ }).first().click();
        const olderCard = page.locator(`[data-testid="dmm-profile"][data-adopter-id="${OLDER_ID}"]`);
        await expect(olderCard).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
        await expect(page.locator(`[data-testid="dmm-profile"][data-adopter-id="${NEWER_ID}"]`)).toHaveAttribute('aria-pressed', 'false');
        await olderCard.locator('xpath=ancestor::div[contains(@class,"rounded")][last()]').screenshot(shot('fix1-admin'));
    });

    test('2. «Reportar duplicado» never lists the profile you are on', async ({ page }) => {
        test.setTimeout(120_000);
        await page.goto(`/adopter/${NEWER_ID}`);
        await dismissCountryBanner(page);
        await page.getByTestId('profile-overflow').click();
        await page.getByTestId('profile-report-duplicate').click();
        const dialog = page.getByTestId('flag-dialog');
        await expect(dialog).toBeVisible();
        await dialog.locator('input[type="text"], input:not([type])').first().fill(`Urfalino ${stamp}`);
        await expect(dialog.getByText(OLDER)).toBeVisible({ timeout: 30_000 });
        await expect(dialog.getByText(NEWER)).toHaveCount(0);
        await dialog.screenshot(shot('fix2-reportar'));
    });

    test('3. a sheet row matching two profiles lists the other and can update it instead', async ({ page }) => {
        test.setTimeout(180_000);
        await page.goto('/import/sheet');
        await dismissCountryBanner(page);
        await expect(page.getByTestId('sheet-dropzone')).toBeVisible({ timeout: 30_000 });
        const csv = `Nombre,Telefono\n${OLDER},${PHONE_DIGITS}\n`;
        await page.getByTestId('sheet-file-input').setInputFiles({ name: 'urfalino.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
        await expect(page.getByText(OLDER).first()).toBeVisible({ timeout: 30_000 });
        await page.getByRole('button', { name: /Continuar a duplicados/ }).click();
        const also = page.getByTestId('sheet-also-matches');
        await expect(also).toBeVisible({ timeout: 60_000 });
        await expect(also).toContainText(NEWER);
        await page.screenshot({ ...shot('fix3-sheet'), fullPage: true });
        await also.getByTestId('sheet-also-match-choose').first().click();
        // Jonatan is now the profile it updates; Jonathan moves to «También coincide con».
        await expect(page.getByTestId('sheet-also-matches')).toContainText(OLDER);
        await page.screenshot({ ...shot('fix3-sheet-chosen'), fullPage: true });
    });
});
