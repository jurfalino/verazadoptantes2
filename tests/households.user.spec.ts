import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test';
import { dismissCountryBanner } from './helpers';
import {
    ADMIN_EMAIL, USER_EMAIL, cleanupProfiles, createProfileViaApi, execD1, fillAddForm, housemates, memberMenu, profileNamed, rows,
} from './householdFixtures';

/**
 * Households as profiles, end to end (spec 2026-10-26-households-as-profiles,
 * Task 8), as a regular rescuer (the `user` project: testuser@example.com, in
 * no org, not an admin) on a profile ANOTHER rescuer owns (the admin):
 *
 *   1. A non-owner adds «Marta Paez» with a phone to Pedro's household: Marta's
 *      profile exists (owned by Pedro's owner, the add credited to the viewer)
 *      and her profile shows Pedro.
 *   2. Searching Marta's phone shows only Marta's card, with Pedro's rating line.
 *   3. Adding a person whose phone matches an existing profile offers
 *      «¿Es este perfil?»; «Sí» links that profile (no new one).
 *   4. A stranger's rename: the owner is told and «Deshacer» puts the name back.
 *   5. A minor's profile has no «¿Qué pasó con …?».
 *   6. «Quitar del hogar» → «No vive acá» removes the person on every profile.
 *   7. At 390px nothing scrolls sideways.
 *
 * Own rows (made through the app so search finds them, names carry a stamp),
 * removed after. Selectors are data-testids: Chromium renders English.
 */

const stamp = Date.now();
const s = String(stamp);
const PEDRO_NAME = `Pedro Paez ${stamp}`;
const MARTA_NAME = `Marta Paez ${stamp}`;
const ROSA_NAME = `Rosa Existe ${stamp}`;
const TOMAS_NAME = `Tomas Paez ${stamp}`;
const PEDRO_PHONE = `11 4${s.slice(-3)}-${s.slice(-7, -3)}`;
const MARTA_PHONE = `11 5${s.slice(-3)}-${s.slice(-7, -3)}`;
const ROSA_PHONE = `11 6${s.slice(-3)}-${s.slice(-7, -3)}`;

let PEDRO = '';
let ROSA = '';
let admin: APIRequestContext;

const card = (page: Page, name: string) => page.getByTestId('household-member').filter({ hasText: name });

/** «Guardar» on the add form; a weak «¿Es este perfil?» on someone unrelated is answered «No». */
async function saveAsNew(page: Page) {
    const form = page.getByTestId('hh-add-form');
    await form.getByTestId('hh-form-save').click();
    for (let i = 0; i < 4; i++) {
        const candidate = form.getByTestId('hh-candidate');
        const done = form.waitFor({ state: 'detached', timeout: 20_000 }).then(() => 'done' as const).catch(() => 'timeout' as const);
        const asked = candidate.waitFor({ state: 'visible', timeout: 20_000 }).then(() => 'asked' as const).catch(() => 'timeout' as const);
        const first = await Promise.race([done, asked]);
        if (first !== 'asked') break;
        await candidate.getByTestId('hh-candidate-no').click();
    }
    await expect(form).toHaveCount(0, { timeout: 30_000 });
}

test.describe.serial('households as profiles (Task 8), by a non-owner', () => {
    test.beforeAll(async ({ baseURL }) => {
        admin = await playwrightRequest.newContext({ baseURL, storageState: '.auth/admin.json' });
        PEDRO = await createProfileViaApi(admin, { name: PEDRO_NAME, phone: PEDRO_PHONE });
        ROSA = await createProfileViaApi(admin, { name: ROSA_NAME, phone: ROSA_PHONE });
        // Pedro is rated 1 with an open alert: the line a relative's card carries.
        execD1(`INSERT INTO adopter_events (id, adopter_id, event_type, rating, recorded_by, created_at) VALUES ('test-hh-fixture-ev-${stamp}', '${PEDRO}', 'observation', 1, '${ADMIN_EMAIL}', strftime('%s','now','-3 days'))`);
        execD1(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason, created_at) VALUES ('test-hh-fixture-fl-${stamp}', '${PEDRO}', '${ADMIN_EMAIL}', 'inaccurate_information', strftime('%s','now','-3 days'))`);
    });
    test.afterAll(async () => {
        const made = [MARTA_NAME, `Marta P. ${stamp}`, TOMAS_NAME].map(n => profileNamed(n)?.id).filter(Boolean) as string[];
        cleanupProfiles([PEDRO, ROSA, ...made]);
        execD1(`DELETE FROM notifications WHERE type = 'profile_renamed' AND body LIKE '%${stamp}%'`);
        await admin?.dispose();
    });

    test('1. a non-owner adds «Marta Paez» with a phone: her own profile, owned by Pedro\'s owner, living with Pedro', async ({ page }) => {
        test.setTimeout(180_000);
        await page.goto(`/adopter/${PEDRO}`);
        await dismissCountryBanner(page);
        await expect(page.getByTestId('household-add-member')).toBeVisible({ timeout: 30_000 });

        const form = await fillAddForm(page, { name: MARTA_NAME, relationship: 'partner', phone: MARTA_PHONE });
        await expect(form.getByTestId('hh-minor-checkbox').locator('input')).not.toBeChecked();
        await saveAsNew(page);
        await expect(card(page, MARTA_NAME)).toHaveCount(1, { timeout: 30_000 });
        // The name is the link to her profile; the viewer added her (not their profile).
        await expect(card(page, MARTA_NAME).getByTestId('household-member-own')).toBeVisible();

        const marta = profileNamed(MARTA_NAME);
        expect(marta, 'Marta has a profile').toBeTruthy();
        expect(marta!.added_by).toBe(ADMIN_EMAIL);
        expect(housemates(PEDRO)).toContainEqual(expect.objectContaining({ profileId: marta!.id, addedBy: USER_EMAIL, relationship: 'partner' }));
        expect(JSON.parse(String(marta!.contact_entries))).toEqual([expect.objectContaining({ type: 'phone', addedBy: USER_EMAIL })]);

        // Her profile shows the household: Pedro, rated, with his alert.
        await card(page, MARTA_NAME).getByTestId('household-member-profile-link').click();
        await expect(page).toHaveURL(new RegExp(`/adopter/${marta!.id}`), { timeout: 30_000 });
        const pedroCard = card(page, PEDRO_NAME);
        await expect(pedroCard).toHaveCount(1, { timeout: 30_000 });
        await expect(pedroCard.getByTestId('linked-summary')).toContainText('1.0');
    });

    test('2. searching Marta\'s phone shows only Marta\'s card, with Pedro\'s rating line', async ({ page }) => {
        test.setTimeout(120_000);
        const marta = String(profileNamed(MARTA_NAME)!.id);
        await page.goto('/');
        await dismissCountryBanner(page);
        const box = page.locator('input#search');
        await box.fill(MARTA_PHONE);
        await box.press('Enter');
        const results = page.locator('[data-walkthrough="results"]');
        await results.waitFor({ state: 'attached', timeout: 60_000 });
        const martaCard = results.locator(`a[href^="/adopter/${marta}"]`);
        await expect(martaCard).toHaveCount(1, { timeout: 30_000 });
        await expect(results.locator(`a[href^="/adopter/${PEDRO}"]`)).toHaveCount(0);
        const line = martaCard.getByTestId('card-household-line');
        await expect(line).toContainText(PEDRO_NAME);
        await expect(line).toContainText('1.0');
    });

    test('3. a phone that matches an existing profile offers «¿Es este perfil?»; «Sí» links that profile', async ({ page }) => {
        test.setTimeout(150_000);
        await page.goto(`/adopter/${PEDRO}`);
        await dismissCountryBanner(page);
        const form = await fillAddForm(page, { name: `Rosa ${stamp}`, phone: ROSA_PHONE });
        await form.getByTestId('hh-form-save').click();
        const candidate = form.getByTestId('hh-candidate').filter({ hasText: ROSA_NAME });
        await expect(candidate).toBeVisible({ timeout: 30_000 });
        await candidate.getByTestId('hh-candidate-yes').click();
        await expect(form).toHaveCount(0, { timeout: 30_000 });
        await expect(card(page, ROSA_NAME)).toHaveCount(1, { timeout: 30_000 });
        expect(housemates(PEDRO).map(h => h.profileId)).toContain(ROSA);
        expect(profileNamed(`Rosa ${stamp}`), 'no second profile').toBeUndefined();
    });

    test('4. a stranger renames Marta: her owner is told and «Deshacer» puts the name back', async ({ page, browser }) => {
        test.setTimeout(180_000);
        const marta = String(profileNamed(MARTA_NAME)!.id);
        await page.goto(`/adopter/${PEDRO}`);
        await dismissCountryBanner(page);
        await memberMenu(card(page, MARTA_NAME), 'edit');
        const edit = page.getByTestId('hh-edit-form');
        await edit.getByTestId('hh-person-name').fill(`Marta P. ${stamp}`);
        await edit.getByTestId('hh-form-save').click();
        await expect(card(page, `Marta P. ${stamp}`)).toHaveCount(1, { timeout: 30_000 });

        // The owner's notice carries the undo.
        let historyId = '';
        await expect.poll(() => {
            const n = rows(`SELECT metadata FROM notifications WHERE user_id = '${ADMIN_EMAIL}' AND type = 'profile_renamed' AND metadata LIKE '%${marta}%' ORDER BY created_at DESC LIMIT 1`)[0];
            historyId = n ? String((JSON.parse(String(n.metadata)) as { undo?: { historyId?: string } }).undo?.historyId ?? '') : '';
            return historyId;
        }, { timeout: 30_000 }).not.toBe('');

        const ctx = await browser.newContext({ storageState: '.auth/admin.json' });
        try {
            const owner = await ctx.newPage();
            await owner.goto(`/adopter/${marta}?undoRename=${historyId}`);
            await dismissCountryBanner(owner);
            await owner.getByTestId('rename-undo-confirm').click();
            await expect.poll(() => String(rows(`SELECT name FROM adopters WHERE id = '${marta}'`)[0]?.name), { timeout: 30_000 }).toBe(MARTA_NAME);
        } finally {
            await ctx.close();
        }
    });

    test('5. a minor added to the household: tagged, and no «¿Qué pasó con …?» on the profile', async ({ page }) => {
        test.setTimeout(150_000);
        await page.goto(`/adopter/${PEDRO}`);
        await dismissCountryBanner(page);
        const form = await fillAddForm(page, { name: TOMAS_NAME, relationship: 'child', age: 12 });
        // The box follows the age: ticked and locked.
        const box = form.getByTestId('hh-minor-checkbox').locator('input');
        await expect(box).toBeChecked();
        await expect(box).toBeDisabled();
        await saveAsNew(page);
        const tomasCard = card(page, TOMAS_NAME);
        await expect(tomasCard).toHaveCount(1, { timeout: 30_000 });
        await expect(tomasCard.getByTestId('minor-tag')).toBeVisible();

        const tomas = profileNamed(TOMAS_NAME)!;
        expect(Number(tomas.is_minor)).toBe(1);
        await page.goto(`/adopter/${tomas.id}`);
        await dismissCountryBanner(page);
        await expect(page.getByTestId('minor-note')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('visit-intent-adoption_request')).toHaveCount(0);
    });

    test('6. «Quitar del hogar» → «No vive acá» removes Marta from the household on every profile', async ({ page }) => {
        test.setTimeout(150_000);
        const marta = String(profileNamed(MARTA_NAME)!.id);
        await page.goto(`/adopter/${PEDRO}`);
        await dismissCountryBanner(page);
        await memberMenu(card(page, MARTA_NAME), 'remove');
        const dialog = page.getByTestId('hh-remove-dialog');
        await expect(dialog).toBeVisible({ timeout: 15_000 });
        await expect(dialog.getByTestId('hh-remove-confirm')).toBeDisabled();
        await dialog.getByTestId('hh-remove-why-not_living').click();
        await dialog.getByTestId('hh-remove-confirm').click();
        await expect(card(page, MARTA_NAME)).toHaveCount(0, { timeout: 30_000 });

        expect(housemates(PEDRO).map(h => h.profileId)).not.toContain(marta);
        expect(housemates(marta)).toEqual([]);
        expect(rows(`SELECT corrected_by FROM household_corrections WHERE adopter_id = '${marta}'`)).toEqual([{ corrected_by: USER_EMAIL }]);
        await page.goto(`/adopter/${marta}`);
        await dismissCountryBanner(page);
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 30_000 });
        await expect(card(page, PEDRO_NAME)).toHaveCount(0);
    });

    test('7. at 390px the household (with the add form open) never scrolls sideways', async ({ page }) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`/adopter/${PEDRO}`);
        await dismissCountryBanner(page);
        await expect(page.getByTestId('household-member').first()).toBeVisible({ timeout: 30_000 });
        await fillAddForm(page, { name: `Ancho ${stamp}`, phone: '11 4000-0000' });
        await page.getByTestId('household-member').first().getByTestId('household-member-menu').click();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
    });
});
