import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test';
import { dismissCountryBanner } from './helpers';
import {
    ADMIN_EMAIL, USER_EMAIL, cleanupProfiles, createProfileViaApi, execD1, fillAddForm, housemates, insertHousehold, insertProfile, memberMenu, memberMenuPanel, profileNamed, rows, saveAsNew,
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
 *      «¿Es este perfil?»; «Sí» links that profile (no new one), and its row
 *      counts its active foster as «Actividad» does. On that profile's page
 *      (one home, someone else's) there is no «Hogar con …» title and no
 *      «¿En qué hogar?»; its add goes into that home.
 *   4. A stranger's rename: the owner is told and «Deshacer» puts the name back.
 *   5. A minor's profile is tagged and has «¿Qué pasó con …?» like anyone's
 *      (marker only — Jon, 2026-10-28); the homepage picker picks them.
 *   6. «Quitar del hogar» → «No vive acá» removes the person on every profile.
 *   7. At 390px nothing scrolls sideways.
 *   8. On the viewer's own household: «Eliminar perfil», «Pedir eliminación»
 *      and «Quitar del hogar» → «Lo cargué por error».
 *   9. A person in two homes: a small divider per home, and «+ Agregar» asks
 *      «¿En qué hogar?» and adds into the home picked (compact section,
 *      addendum 2026-10-27).
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
const HUGO_NAME = `Hugo Existe ${stamp}`;
const PEDRO_PHONE = `11 4${s.slice(-3)}-${s.slice(-7, -3)}`;
const MARTA_PHONE = `11 5${s.slice(-3)}-${s.slice(-7, -3)}`;
const ROSA_PHONE = `11 6${s.slice(-3)}-${s.slice(-7, -3)}`;

const FOSTER_ANIMAL = `test-hh-fixture-an-${stamp}`;
let PEDRO = '';
let ROSA = '';
let admin: APIRequestContext;

const card = (page: Page, name: string) => page.getByTestId('household-member').filter({ hasText: name });

test.describe.serial('households as profiles (Task 8), by a non-owner', () => {
    test.beforeAll(async ({ baseURL }) => {
        admin = await playwrightRequest.newContext({ baseURL, storageState: '.auth/admin.json' });
        PEDRO = await createProfileViaApi(admin, { name: PEDRO_NAME, phone: PEDRO_PHONE });
        ROSA = await createProfileViaApi(admin, { name: ROSA_NAME, phone: ROSA_PHONE });
        // Pedro is rated 1 with an open alert: the line a relative's card carries.
        execD1(`INSERT INTO adopter_events (id, adopter_id, event_type, rating, recorded_by, created_at) VALUES ('test-hh-fixture-ev-${stamp}', '${PEDRO}', 'observation', 1, '${ADMIN_EMAIL}', strftime('%s','now','-3 days'))`);
        execD1(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason, created_at) VALUES ('test-hh-fixture-fl-${stamp}', '${PEDRO}', '${ADMIN_EMAIL}', 'inaccurate_information', strftime('%s','now','-3 days'))`);
        // Rosa fosters an animal right now: a transit on her «Actividad», so on her household row too.
        execD1(`INSERT INTO animals (id, name, species, added_by, created_at, updated_at) VALUES ('${FOSTER_ANIMAL}', 'Michi ${stamp}', 'cat', '${ADMIN_EMAIL}', strftime('%s','now','-3 days'), strftime('%s','now','-3 days'))`);
        execD1(`INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at, recorded_by) VALUES ('test-hh-fixture-pl-${stamp}', '${FOSTER_ANIMAL}', '${ROSA}', 'foster', strftime('%s','now','-2 days'), '${ADMIN_EMAIL}')`);
    });
    test.afterAll(async () => {
        const made = [MARTA_NAME, `Marta P. ${stamp}`, TOMAS_NAME, HUGO_NAME].map(n => profileNamed(n)?.id).filter(Boolean) as string[];
        cleanupProfiles([PEDRO, ROSA, ...made]);
        execD1(`DELETE FROM animals WHERE id = '${FOSTER_ANIMAL}'`);
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
        // Its bottom edge too: the contacts toggle's padded hit area sits just below and must never take the tap.
        const link = card(page, MARTA_NAME).getByTestId('household-member-profile-link');
        const box = (await link.boundingBox())!;
        await link.click({ position: { x: Math.min(10, box.width / 2), y: box.height - 2 } });
        await expect(page).toHaveURL(new RegExp(`/adopter/${marta!.id}`), { timeout: 30_000 });
        const pedroCard = card(page, PEDRO_NAME);
        await expect(pedroCard).toHaveCount(1, { timeout: 30_000 });
        // His row: rating and his open alert, no «Perfil cargado por …»; one attribution at most.
        await expect(pedroCard).toContainText('1.0');
        await expect(pedroCard.getByTestId('household-member-alerts')).toBeVisible();
        await expect(pedroCard.locator('[data-activity="observation"]')).toHaveAttribute('data-count', '1');
        // «Editar» on everyone's card, the anchor's too — no relationship field there (his row has none);
        // taking Pedro out of his own home is not this viewer's to do.
        await memberMenu(pedroCard, 'edit');
        const edit = page.getByTestId('hh-edit-form');
        await expect(edit.getByTestId('hh-person-name')).toHaveValue(PEDRO_NAME);
        await expect(edit.getByTestId('hh-person-rel')).toHaveCount(0);
        await edit.getByTestId('hh-form-cancel').click();
        await pedroCard.getByTestId('household-member-menu').click();
        await expect(memberMenuPanel(pedroCard).getByTestId('household-member-menu-edit')).toBeVisible();
        await expect(memberMenuPanel(pedroCard).getByTestId('household-member-menu-remove')).toHaveCount(0);
        await page.mouse.click(5, 300);
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

    test('2b. while a contact is being written, «Sí» / «No» and the form\'s «Guardar» can\'t save the person without it', async ({ page }) => {
        test.setTimeout(150_000);
        await page.goto(`/adopter/${PEDRO}`);
        await dismissCountryBanner(page);
        const form = await fillAddForm(page, { name: `Rosa ${stamp}`, phone: ROSA_PHONE });
        await form.getByTestId('hh-form-save').click();
        const candidate = form.getByTestId('hh-candidate').filter({ hasText: ROSA_NAME });
        await expect(candidate).toBeVisible({ timeout: 30_000 });
        await expect(candidate.getByTestId('hh-candidate-yes')).toBeEnabled();

        // A second phone typed but not added yet: no «Sí», no «No», no form «Guardar».
        await form.getByTestId('hh-add-contact-add-trigger').click();
        await form.getByTestId('hh-add-contact-type-phone').click();
        await form.getByTestId('hh-add-contact-composer-input').fill('11 4999-0000');
        await expect(candidate.getByTestId('hh-candidate-yes')).toBeDisabled();
        await expect(candidate.getByTestId('hh-candidate-no')).toBeDisabled();
        await expect(form.getByTestId('hh-form-save')).toHaveCount(0);
        await form.getByTestId('hh-add-contact-composer-cancel').click();
        await expect(candidate.getByTestId('hh-candidate-yes')).toBeEnabled();

        // Editing the added phone in place counts as writing too.
        await form.getByTestId('hh-add-contact-edit-btn').click();
        await expect(candidate.getByTestId('hh-candidate-yes')).toBeDisabled();
        await expect(form.getByTestId('hh-form-save')).toHaveCount(0);
        await form.getByTestId('hh-add-contact-chip').getByRole('textbox').press('Escape');
        await expect(candidate.getByTestId('hh-candidate-yes')).toBeEnabled();

        // Nothing was saved.
        await form.getByTestId('hh-form-cancel').click();
        await expect(form).toHaveCount(0);
        expect(housemates(PEDRO).map(h => h.profileId)).not.toContain(ROSA);
        expect(profileNamed(`Rosa ${stamp}`)).toBeUndefined();
    });

    test('3. a phone that matches an existing profile offers «¿Es este perfil?»; «Sí» links that profile', async ({ page }) => {
        test.setTimeout(150_000);
        await page.goto(`/adopter/${PEDRO}`);
        await dismissCountryBanner(page);
        const form = await fillAddForm(page, { name: `Rosa ${stamp}`, phone: ROSA_PHONE });
        await form.getByTestId('hh-form-save').click();
        const candidate = form.getByTestId('hh-candidate').filter({ hasText: ROSA_NAME });
        await expect(candidate).toBeVisible({ timeout: 30_000 });
        // «¿Es este perfil?» counts her activity as her household row will (the foster too), not «0 adopciones».
        await expect(candidate.locator('[data-activity="foster"]')).toHaveAttribute('data-count', '1');
        await candidate.getByTestId('hh-candidate-yes').click();
        await expect(form).toHaveCount(0, { timeout: 30_000 });
        await expect(card(page, ROSA_NAME)).toHaveCount(1, { timeout: 30_000 });
        expect(housemates(PEDRO).map(h => h.profileId)).toContain(ROSA);
        // Her row counts what her own «Actividad» counts: the foster too.
        await expect(card(page, ROSA_NAME).locator('[data-activity="foster"]')).toHaveAttribute('data-count', '1');
        expect(profileNamed(`Rosa ${stamp}`), 'no second profile').toBeUndefined();
    });

    test("3b. from Rosa's page (linked into Pedro's home only): no «Hogar con …» title, no «¿En qué hogar?», and «Agregar» adds into Pedro's home", async ({ page }) => {
        test.setTimeout(150_000);
        await page.goto(`/adopter/${ROSA}`);
        await dismissCountryBanner(page);
        await expect(card(page, PEDRO_NAME)).toHaveCount(1, { timeout: 30_000 });
        await expect(page.getByTestId('household-home-divider')).toHaveCount(0);
        await expect(page.getByTestId('household-section').locator('h4')).toHaveCount(0);
        await fillAddForm(page, { name: HUGO_NAME, relationship: 'sibling' });
        await expect(page.getByTestId('household-add-which')).toHaveCount(0);
        await saveAsNew(page);
        const hugo = String(profileNamed(HUGO_NAME)!.id);
        expect(housemates(PEDRO).map(h => h.profileId)).toContain(hugo);
        await expect(card(page, HUGO_NAME)).toHaveCount(1, { timeout: 30_000 });
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

    test('5. a minor added to the household: tagged, and «¿Qué pasó con …?» on the profile like anyone\'s', async ({ page }) => {
        test.setTimeout(150_000);
        await page.goto(`/adopter/${PEDRO}`);
        await dismissCountryBanner(page);
        const form = await fillAddForm(page, { name: TOMAS_NAME, relationship: 'child', age: 12 });
        // The box follows the age: ticked and locked.
        const box = form.getByTestId('hh-minor-checkbox').locator('input');
        await expect(box).toBeChecked();
        await expect(box).toHaveAttribute('aria-readonly', 'true');
        await box.click(); // locked by the age: stays ticked
        await expect(box).toBeChecked();
        await saveAsNew(page);
        const tomasCard = card(page, TOMAS_NAME);
        await expect(tomasCard).toHaveCount(1, { timeout: 30_000 });
        await expect(tomasCard.getByTestId('minor-tag')).toBeVisible();

        const tomas = profileNamed(TOMAS_NAME)!;
        expect(Number(tomas.is_minor)).toBe(1);
        await page.goto(`/adopter/${tomas.id}`);
        await dismissCountryBanner(page);
        // «Menor de edad» is a marker only (Jon, 2026-10-28): tagged, nothing hidden.
        await expect(page.getByTestId('minor-tag')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('visit-intent-adoption_request')).toBeVisible();
        await expect(page.getByTestId('minor-note')).toHaveCount(0);
    });

    test('5b. the homepage picker shows the minor tagged and picks them for a record', async ({ page }) => {
        test.setTimeout(150_000);
        const tomas = profileNamed(TOMAS_NAME)!;
        await page.goto('/');
        await dismissCountryBanner(page);
        await page.getByTestId('adoption-wizard-btn').click();
        await page.getByTestId('picker-search').fill(TOMAS_NAME);
        const row = page.getByTestId('picker-result').filter({ hasText: TOMAS_NAME });
        await expect(row).toHaveCount(1, { timeout: 30_000 });
        await expect(row.getByTestId('picker-minor-tag')).toBeVisible();
        await row.getByTestId('picker-pick').click();
        await page.waitForURL(new RegExp(`/adopter/${tomas.id}\\?newAdoption=adoption`), { timeout: 30_000 });
        await expect(page.getByTestId('wizard-next-step1')).toBeVisible({ timeout: 30_000 });
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

    test('8. member card on the viewer\'s own household: «Eliminar perfil» (D2), «Pedir eliminación» (D1), «Lo cargué por error» (Q1)', async ({ page }) => {
        test.setTimeout(240_000);
        const OWN = await createProfileViaApi(page.request, { name: `Duena Propia ${stamp}` });
        const [UNO, DOS, TRES] = ['Borrar Uno', 'Pedir Dos', 'Error Tres'].map(n => `${n} ${stamp}`);
        let dos = '';
        try {
            await page.goto(`/adopter/${OWN}`);
            await dismissCountryBanner(page);
            for (const n of [UNO, DOS, TRES]) {
                await fillAddForm(page, { name: n });
                await saveAsNew(page);
                await expect(card(page, n)).toHaveCount(1, { timeout: 30_000 });
            }
            const uno = String(profileNamed(UNO)!.id);
            dos = String(profileNamed(DOS)!.id);
            const tres = String(profileNamed(TRES)!.id);

            // D2 — nobody else contributed to Uno: the owner deletes the profile; it leaves the household.
            await memberMenu(card(page, UNO), 'delete');
            const del = page.getByTestId('hh-delete-dialog');
            await expect(del).toBeVisible();
            await del.getByTestId('hh-delete-confirm').click();
            await expect(card(page, UNO)).toHaveCount(0, { timeout: 30_000 });
            expect(rows(`SELECT id FROM adopters WHERE id = '${uno}'`)).toHaveLength(0);
            expect(rows(`SELECT id FROM household_memberships WHERE adopter_id = '${uno}'`)).toHaveLength(0);

            // D1 — another rescuer edited Dos: the owner may only ask the admins.
            execD1(`INSERT INTO adopter_history (id, adopter_id, changed_by, changes, changed_at) VALUES ('test-hh-fixture-h-${stamp}', '${dos}', 'otra-${stamp}@example.com', '{"notes":{"from":"","to":"x"}}', strftime('%s','now'))`);
            await page.reload();
            await dismissCountryBanner(page);
            await memberMenu(card(page, DOS), 'request');
            const req = page.getByTestId('hh-request-dialog');
            await expect(req).toContainText('1');
            await req.getByTestId('hh-request-confirm').click();
            await expect(req).toHaveCount(0, { timeout: 30_000 });
            await expect.poll(() => rows(`SELECT status FROM data_requests WHERE adopter_id = '${dos}' AND request_type = 'deletion'`).map(r => r.status), { timeout: 15_000 }).toEqual(['pending']);
            await expect(card(page, DOS)).toHaveCount(1);

            // Q1 «Lo cargué por error»: out of the household, no correction remembered.
            await memberMenu(card(page, TRES), 'remove');
            const dialog = page.getByTestId('hh-remove-dialog');
            await dialog.getByTestId('hh-remove-why-mistake').click();
            await expect(dialog.getByTestId('hh-remove-why-mistake').locator('[data-checked="true"]')).toHaveCount(1);
            await dialog.getByTestId('hh-remove-confirm').click();
            await expect(card(page, TRES)).toHaveCount(0, { timeout: 30_000 });
            expect(housemates(OWN).map(h => h.profileId)).not.toContain(tres);
            expect(rows(`SELECT id FROM household_corrections WHERE adopter_id = '${tres}'`)).toHaveLength(0);
            expect(rows(`SELECT id FROM adopters WHERE id = '${tres}' AND deleted_at IS NULL`)).toHaveLength(1); // the profile stays
        } finally {
            if (dos) execD1(`DELETE FROM data_requests WHERE adopter_id = '${dos}'`);
            const made = [UNO, DOS, TRES].map(n => profileNamed(n)?.id).filter(Boolean).map(String);
            cleanupProfiles([OWN, ...made]);
        }
    });

    test('9. a person in two homes: a divider per home; «+ Agregar» asks «¿En qué hogar?» and adds into the home picked', async ({ page }) => {
        test.setTimeout(150_000);
        const [KID, MOM, DAD] = ['kid', 'mom', 'dad'].map(r => `test-hh-fixture-two-${r}-${stamp}`);
        const [HH_MOM, HH_DAD] = [`test-hh-fixture-two-hm-${stamp}`, `test-hh-fixture-two-hd-${stamp}`];
        const NEW = `Nuevo Dos ${stamp}`;
        try {
            insertProfile({ id: KID, name: `Lucas Dos ${stamp}`, owner: ADMIN_EMAIL, age: 16 });
            insertProfile({ id: MOM, name: `Ana Dos ${stamp}`, owner: ADMIN_EMAIL });
            insertProfile({ id: DAD, name: `Pablo Dos ${stamp}`, owner: ADMIN_EMAIL });
            insertHousehold(HH_MOM, MOM, [{ id: `${HH_MOM}-k`, adopterId: KID, relationship: 'child', addedBy: ADMIN_EMAIL }]);
            insertHousehold(HH_DAD, DAD, [{ id: `${HH_DAD}-k`, adopterId: KID, relationship: 'child', addedBy: ADMIN_EMAIL }]);

            await page.goto(`/adopter/${KID}`);
            await dismissCountryBanner(page);
            await expect(page.getByTestId('household-member')).toHaveCount(2, { timeout: 30_000 });
            await expect(page.getByTestId('household-home-divider')).toHaveCount(2);
            // Ana has no contacts: no «N datos ▾» to open — the standard «Agregar dato de contacto» right there.
            const mom = page.locator(`[data-testid="household-member"][data-profile-id="${MOM}"]`);
            await expect(mom.getByTestId('household-member-contacts-toggle')).toHaveCount(0);
            await expect(mom.getByTestId('linked-contact-add-trigger')).toBeVisible();
            await mom.getByTestId('linked-contact-add-trigger').click();
            await expect(mom.getByTestId('linked-contact-type-phone')).toBeVisible();
            await mom.getByTestId('linked-contact-pick-type-cancel').click();
            await expect(mom.getByTestId('linked-contact-add-trigger')).toBeVisible();
            // The chooser lists both homes, each by its people.
            await page.getByTestId('household-add-member').click();
            const which = page.getByTestId('household-add-which');
            await expect(which.getByTestId('household-add-which-option')).toHaveCount(2);
            await expect(which.locator(`[data-household-id="${HH_DAD}"]`)).toContainText('Pablo');
            await page.mouse.click(5, 300); // outside: it closes
            await expect(which).toHaveCount(0);

            await fillAddForm(page, { name: NEW }, HH_DAD);
            await saveAsNew(page);
            await expect(card(page, NEW)).toHaveCount(1, { timeout: 30_000 });
            const made = String(profileNamed(NEW)!.id);
            expect(housemates(made).map(h => String(h.householdId))).toEqual([HH_DAD, HH_DAD]);

            // On Ana's page (one home): no divider, and «+ Agregar» goes straight to the form.
            await page.goto(`/adopter/${MOM}`);
            await dismissCountryBanner(page);
            await expect(card(page, `Lucas Dos ${stamp}`)).toHaveCount(1, { timeout: 30_000 });
            await expect(page.getByTestId('household-home-divider')).toHaveCount(0);
            await page.getByTestId('household-add-member').click();
            await expect(page.getByTestId('hh-add-form')).toBeVisible({ timeout: 15_000 });
            await expect(page.getByTestId('household-add-which')).toHaveCount(0);
        } finally {
            const made = profileNamed(NEW)?.id;
            cleanupProfiles([KID, MOM, DAD, ...(made ? [String(made)] : [])]);
        }
    });

    test('10. the last row\'s «⋯» and «¿En qué hogar?» open above the «¿Qué pasó con …?» card: their last item takes a real tap (audit A1)', async ({ page }) => {
        test.setTimeout(180_000);
        const [OWN, M1, M2, A, B] = ['own', 'm1', 'm2', 'a', 'b'].map(r => `test-hh-fixture-a1-${r}-${stamp}`);
        const [HH_OWN, HH_A, HH_B] = ['own', 'ha', 'hb'].map(r => `test-hh-fixture-a1-${r}-${stamp}`);
        try {
            insertProfile({ id: OWN, name: `Dueno Menu ${stamp}`, owner: USER_EMAIL });
            insertProfile({ id: M1, name: `Primero Menu ${stamp}`, owner: USER_EMAIL });
            insertProfile({ id: M2, name: `Segundo Menu ${stamp}`, owner: USER_EMAIL });
            insertHousehold(HH_OWN, OWN, [
                { id: `${HH_OWN}-1`, adopterId: M1, relationship: 'sibling', addedBy: USER_EMAIL },
                { id: `${HH_OWN}-2`, adopterId: M2, relationship: 'sibling', addedBy: USER_EMAIL },
            ]);
            // Also in two more homes (so «+ Agregar» asks «¿En qué hogar?»); an adult, so «¿Qué pasó con …?» shows.
            insertProfile({ id: A, name: `Ana Menu ${stamp}`, owner: USER_EMAIL });
            insertProfile({ id: B, name: `Beto Menu ${stamp}`, owner: USER_EMAIL });
            insertHousehold(HH_A, A, [{ id: `${HH_A}-x`, adopterId: OWN, relationship: 'sibling', addedBy: USER_EMAIL }]);
            insertHousehold(HH_B, B, [{ id: `${HH_B}-x`, adopterId: OWN, relationship: 'sibling', addedBy: USER_EMAIL }]);

            for (const size of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
                await page.setViewportSize(size);
                await page.goto(`/adopter/${OWN}`);
                await dismissCountryBanner(page);
                const memberRows = page.getByTestId('household-member');
                await expect(memberRows).toHaveCount(4, { timeout: 30_000 });
                await expect(page.getByTestId('visit-intent-other')).toBeVisible();

                // The last row's ⋯ near the bottom of the screen, the «¿Qué pasó?» card right under it.
                const last = memberRows.last();
                const button = last.getByTestId('household-member-menu');
                await button.scrollIntoViewIfNeeded();
                await page.evaluate((y) => window.scrollBy(0, y), await button.evaluate(el => el.getBoundingClientRect().bottom - window.innerHeight + 80));
                await button.click();
                const del = memberMenuPanel(last).getByTestId('household-member-menu-delete');
                await expect(del).toBeEnabled({ timeout: 15_000 });
                // A real tap (no force): Playwright refuses it if anything (the «¿Qué pasó?» buttons) covers the item.
                await del.click();
                const dialog = page.getByTestId('hh-delete-dialog');
                await expect(dialog).toBeVisible();
                await dialog.getByTestId('hh-dialog-cancel').click();
                await expect(dialog).toHaveCount(0);

                // Keyboard: the panel lives on <body>, so it takes the focus itself; Tab leaves it, back on ⋯.
                await button.focus();
                await page.keyboard.press('Enter');
                await expect(memberMenuPanel(last).getByTestId('household-member-menu-edit')).toBeFocused();
                await page.keyboard.press('Tab');
                await expect(memberMenuPanel(last)).toHaveCount(0);
                await expect(button).toBeFocused();

                // Arrow keys reach every item (roving focus): ArrowDown to «Eliminar perfil», Enter opens its dialog.
                await page.keyboard.press('Enter');
                const delKey = memberMenuPanel(last).getByTestId('household-member-menu-delete');
                await expect(delKey).toBeEnabled({ timeout: 15_000 });
                for (let i = 0; i < 8 && !(await delKey.evaluate(el => el === document.activeElement)); i++) await page.keyboard.press('ArrowDown');
                await expect(delKey).toBeFocused();
                await page.keyboard.press('Enter');
                const delDialog = page.getByTestId('hh-delete-dialog');
                await expect(delDialog).toBeVisible();
                // The focus moved into the dialog, not stranded on the ⋯ behind it.
                await expect.poll(() => delDialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
                await delDialog.getByTestId('hh-dialog-cancel').click();
                await expect(delDialog).toHaveCount(0);

                // «¿En qué hogar?» right above the same card: its last home takes the tap too.
                const add = page.getByTestId('household-add-member');
                await add.scrollIntoViewIfNeeded();
                await page.evaluate((y) => window.scrollBy(0, y), await add.evaluate(el => el.getBoundingClientRect().bottom - window.innerHeight + 80));
                await add.click();
                const options = page.getByTestId('household-add-which').getByTestId('household-add-which-option');
                await expect(options).toHaveCount(3);
                await options.last().click();
                await expect(page.getByTestId('hh-add-form')).toBeVisible({ timeout: 15_000 });
                await page.getByTestId('hh-add-form').getByTestId('hh-form-cancel').click();

                const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
                expect(overflow).toBeLessThanOrEqual(0);
            }
            for (const id of [M1, M2, A, B]) expect(rows(`SELECT id FROM adopters WHERE id = '${id}'`)).toHaveLength(1); // only ever cancelled
        } finally {
            cleanupProfiles([OWN, M1, M2, A, B]);
        }
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
