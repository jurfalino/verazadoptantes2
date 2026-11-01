import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { dismissCountryBanner } from './helpers';
import { ADMIN_EMAIL, USER_EMAIL, cleanupProfiles, createProfileViaApi, execD1, insertHousehold, insertProfile, rows } from './householdFixtures';

/**
 * «Ya está en otro perfil», option B (Jon 2026-10-29), as a regular rescuer
 * (the `user` project). First adding a phone on someone else's profile, where
 * the phone already sits on two profiles the admin owns (masked for this
 * viewer) — case 2, «Marcar como posible duplicado»:
 *
 *   1. The compact inline box: two rows (name, rating, «Ver perfil»), no
 *      household line — not even on the one whose housemate is 1★ (Jon
 *      2026-10-31) — the typed phone never repeated.
 *   2. «Ver perfil» opens a window over the page: the match card, the phone
 *      that matched marked «coincide»; «No es esta persona» closes it and that
 *      row is gone — the typed phone still in the field.
 *   3. «Marcar como posible duplicado» in the other's window (it says someone
 *      else loaded the profile) flags the pair (adopter_flags, reason
 *      duplicate) and its row reads «Marcado».
 *
 * Then case 1, on a profile this rescuer loaded: «Continuar con este perfil»
 * → the confirmation (absorb mode: «deja de existir», the rating after, who is told) → «Sí, unirlos» lands
 * on the matched profile with «Listo», once; the edited profile is absorbed
 * and the typed phone is on the match.
 *
 * Selectors are data-testids: Chromium renders English.
 */

const stamp = Date.now();
const s = String(stamp);
const PHONE = `11 7${s.slice(-3)}-${s.slice(-7, -3)}`;
const OWNER = `duphint-owner-${stamp}@example.com`;
const ANCHOR = `test-duphint-fixture-anchor-${stamp}`;
const HOUSEMATE = `test-duphint-fixture-mate-${stamp}`;
const HH = `test-duphint-fixture-hh-${stamp}`;
const UNO = `Duphint Uno ${stamp}`;
const DOS = `Duphint Dos ${stamp}`;
let UNO_ID = '';
let DOS_ID = '';
let admin: APIRequestContext;
let hadGating = false;

test.describe.serial('composer duplicate hint (option B)', () => {
    test.beforeAll(async ({ baseURL }) => {
        hadGating = rows(`SELECT value FROM app_config WHERE key = 'ENABLE_PII_ACCESS_GATING'`).length > 0;
        if (!hadGating) execD1(`INSERT INTO app_config (key, value, updated_at, updated_by) VALUES ('ENABLE_PII_ACCESS_GATING', 'true', strftime('%s','now'), 'e2e')`);
        admin = await playwrightRequest.newContext({ baseURL, storageState: '.auth/admin.json' });
        UNO_ID = await createProfileViaApi(admin, { name: UNO, phone: PHONE });
        DOS_ID = await createProfileViaApi(admin, { name: DOS, phone: PHONE });
        insertProfile({ id: ANCHOR, name: `Duphint Ana ${stamp}`, owner: OWNER });
        // Dos lives with someone rated 1★: the problem that would bring the household line on a search card — never here.
        insertProfile({ id: HOUSEMATE, name: `Duphint Pedro ${stamp}`, owner: ADMIN_EMAIL });
        insertHousehold(HH, DOS_ID, [{ id: `${HH}-m1`, adopterId: HOUSEMATE, addedBy: ADMIN_EMAIL }]);
        execD1(`INSERT INTO adopter_events (id, adopter_id, event_type, rating, recorded_by, created_at) VALUES ('test-duphint-fixture-ev-${stamp}', '${HOUSEMATE}', 'observation', 1, '${ADMIN_EMAIL}', strftime('%s','now','-3 days'))`);
    });
    test.afterAll(async () => {
        cleanupProfiles([ANCHOR, HOUSEMATE, UNO_ID, DOS_ID]);
        execD1(`DELETE FROM adopter_events WHERE id = 'test-duphint-fixture-ev-${stamp}'`);
        if (!hadGating) execD1(`DELETE FROM app_config WHERE key = 'ENABLE_PII_ACCESS_GATING'`);
        await admin?.dispose();
    });

    test('compact box → window → «No es esta persona» hides the row → «Marcar como posible duplicado» flags the pair', async ({ page, browser, baseURL }) => {
        test.setTimeout(180_000);
        await page.goto(`/adopter/${ANCHOR}`);
        await dismissCountryBanner(page);
        await page.getByTestId('ce-add-trigger').click();
        await page.getByTestId('ce-type-phone').click();
        const input = page.getByTestId('ce-composer-input');
        await input.fill(PHONE);

        // 1. The inline box.
        const box = page.getByTestId('dup-hint');
        await expect(box).toBeVisible({ timeout: 30_000 });
        const rowsInBox = box.getByTestId('dup-hint-row');
        await expect(rowsInBox).toHaveCount(2);
        await expect(box.getByTestId('dup-hint-view')).toHaveCount(2);
        const dos = box.locator(`[data-adopter-id="${DOS_ID}"]`);
        const uno = box.locator(`[data-adopter-id="${UNO_ID}"]`);
        await expect(box.getByTestId('card-household-line')).toHaveCount(0);
        // (The names carry the stamp, so look for the number as written.)
        await expect(box).not.toContainText(PHONE);
        await expect(box).not.toContainText(`-${PHONE.slice(-4)}`);

        // 2. The window, then «No es esta persona».
        await dos.getByTestId('dup-hint-view').click();
        const win = page.getByTestId('dup-hint-window');
        await expect(win).toBeVisible();
        await expect(win.getByTestId('dup-hint-window-head')).toContainText(DOS);
        await expect(win.getByTestId('card-household-line')).toHaveCount(0);
        await expect(win.getByTestId('dup-hint-contact').getByTestId('contact-matches')).toHaveCount(1);
        // Case 2: someone else loaded the profile being edited — flag, never continue.
        // The sentence names the profile being edited, not the match above it (UX I5).
        await expect(win.getByTestId('dup-hint-cant-join')).toContainText(`Duphint Ana ${stamp}`);
        await expect(win.getByTestId('dup-hint-flag')).toBeVisible();
        await expect(win.getByTestId('dup-hint-flag-told')).toBeVisible();
        await expect(win.getByTestId('dup-hint-open-to-add')).toBeVisible();
        await expect(win.getByTestId('dup-hint-continue')).toHaveCount(0);
        await win.getByTestId('dup-hint-not-this').click();
        await expect(win).toHaveCount(0);
        await expect(rowsInBox).toHaveCount(1);
        await expect(dos).toHaveCount(0);
        await expect(input).toHaveValue(PHONE);
        // Nothing was written for «No es esta persona».
        expect(rows(`SELECT id FROM adopter_flags WHERE adopter_id = '${ANCHOR}'`)).toHaveLength(0);

        // 3. «Marcar como posible duplicado» on the other one.
        await uno.getByTestId('dup-hint-view').click();
        await expect(win).toBeVisible();
        await win.getByTestId('dup-hint-flag').click();
        await expect(win).toHaveCount(0, { timeout: 15_000 });
        await expect(uno.getByTestId('dup-hint-flagged')).toBeVisible();
        await expect.poll(() => rows(`SELECT reason, target_adopter_id AS t FROM adopter_flags WHERE adopter_id = '${ANCHOR}'`), { timeout: 15_000 })
            .toEqual([expect.objectContaining({ reason: 'duplicate', t: UNO_ID })]);
        await expect(input).toHaveValue(PHONE);

        // 4. Whoever added each profile is told (never the flagger), and «Revisar» opens the
        //    match owner's «Pendientes» at that pair.
        const flagId = String(rows(`SELECT id FROM adopter_flags WHERE adopter_id = '${ANCHOR}'`)[0].id);
        const told = () => rows(`SELECT user_id AS u, url FROM notifications WHERE type = 'duplicate_flagged' AND metadata LIKE '%${ANCHOR}%'`);
        // Whoever added each profile only — not the admin's org teammate in the seed, never the flagger.
        await expect.poll(() => told().map(r => String(r.u)).sort(), { timeout: 15_000 }).toEqual([ADMIN_EMAIL, OWNER].sort());
        const url = String(told()[0].url);
        expect(url).toContain('#pendientes');
        const adminCtx = await browser.newContext({ storageState: '.auth/admin.json', baseURL });
        const adminPage = await adminCtx.newPage();
        await adminPage.goto(url);
        const focused = adminPage.locator(`[data-testid="dedup-row"][data-candidate-id="${flagId}"]`);
        await expect(focused).toBeVisible({ timeout: 30_000 });
        await expect(focused).toHaveAttribute('data-highlight', /.+/);
        await adminCtx.close();
    });
});

const PHONE_C1 = `11 6${s.slice(-3)}-${s.slice(-7, -3)}`;
const MINE = `test-duphint-fixture-mine-${stamp}`;
const MINE_NAME = `Duphint Maria ${stamp}`;
const MATCH_NAME = `Duphint Jonatan ${stamp}`;
let MATCH_ID = '';

test.describe.serial('composer duplicate hint — «Continuar con este perfil» on my own profile (case 1)', () => {
    test.beforeAll(async ({ baseURL }) => {
        const adminCtx = await playwrightRequest.newContext({ baseURL, storageState: '.auth/admin.json' });
        MATCH_ID = await createProfileViaApi(adminCtx, { name: MATCH_NAME, phone: `+54 9 ${PHONE_C1}` });
        await adminCtx.dispose();
        insertProfile({ id: MINE, name: MINE_NAME, owner: USER_EMAIL, contacts: [{ id: `${MINE}-e`, type: 'email', value: `duphint-${stamp}@example.org`, addedBy: USER_EMAIL }] });
        execD1(`INSERT INTO adopter_events (id, adopter_id, event_type, rating, recorded_by, created_at) VALUES ('test-duphint-fixture-ev-mine-${stamp}', '${MINE}', 'observation', 4, '${USER_EMAIL}', strftime('%s','now','-2 days'))`);
    });
    test.afterAll(async () => {
        cleanupProfiles([MINE, MATCH_ID]);
        execD1(`DELETE FROM adopter_events WHERE id = 'test-duphint-fixture-ev-mine-${stamp}'`);
    });

    test('continue → the confirmation → lands on the match with «Listo», once; mine absorbed, the phone not doubled', async ({ page }) => {
        test.setTimeout(180_000);
        await page.goto(`/adopter/${MINE}`);
        await dismissCountryBanner(page);
        await page.getByTestId('ce-add-trigger').click();
        await page.getByTestId('ce-type-phone').click();
        await page.getByTestId('ce-composer-input').fill(PHONE_C1);

        const row = page.getByTestId('dup-hint').locator(`[data-adopter-id="${MATCH_ID}"]`);
        await expect(row).toBeVisible({ timeout: 30_000 });
        await row.getByTestId('dup-hint-view').click();
        const win = page.getByTestId('dup-hint-window');
        await expect(win.getByTestId('dup-hint-continue')).toBeVisible();
        await expect(win.getByTestId('dup-hint-flag')).toHaveCount(0);
        await win.getByTestId('dup-hint-continue').click();

        const confirm = page.getByTestId('dup-hint-confirm');
        await expect(confirm).toBeVisible();
        // Absorb mode (UX C1): it says my profile goes away, and never «Solo abriremos el perfil existente».
        await expect(confirm.getByTestId('continue-merge-absorbed')).toContainText(MINE_NAME);
        await expect(confirm.getByTestId('continue-merge-nothing-new')).toHaveCount(0);
        await expect(confirm.getByTestId('continue-merge-new')).toContainText(`duphint-${stamp}@example.org`);
        // The typed phone is already on the match (+54 9 …, the same phone as the matcher compares it): not «added».
        await expect(confirm.getByTestId('continue-merge-new')).not.toContainText(PHONE_C1);
        await expect(confirm.getByTestId('continue-merge-records')).toBeVisible();
        await expect(confirm.getByTestId('dup-hint-rating-after').getByTestId('rating-value')).toBeVisible();
        // The admin loaded the match: they are told.
        await expect(confirm.getByTestId('dup-hint-confirm-told')).toBeVisible();
        await confirm.getByTestId('dup-hint-confirm-yes').click();

        await page.waitForURL(new RegExp(`/adopter/${MATCH_ID}$`), { timeout: 30_000 });
        const banner = page.getByTestId('continued-profile-banner');
        await expect(banner).toBeVisible({ timeout: 15_000 });
        await expect(banner).toContainText(MINE_NAME);
        expect(rows(`SELECT deleted_at AS d FROM adopters WHERE id = '${MINE}'`)[0].d).not.toBeNull();
        const entries = JSON.parse(String(rows(`SELECT contact_entries AS c FROM adopters WHERE id = '${MATCH_ID}'`)[0].c)) as Array<{ type: string; value: string }>;
        // One copy of the phone (no «11 …» beside «+54 9 11 …»), and my email moved over.
        expect(entries.filter(e => e.type === 'phone').map(e => e.value)).toEqual([`+54 9 ${PHONE_C1}`]);
        expect(entries.map(e => e.value)).toContain(`duphint-${stamp}@example.org`);

        // One-shot: a reload doesn't show it again.
        await page.reload();
        await expect(page.getByTestId('ce-add-trigger')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('continued-profile-banner')).toHaveCount(0);
    });
});
