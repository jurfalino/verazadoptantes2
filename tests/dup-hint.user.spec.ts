import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { dismissCountryBanner } from './helpers';
import { ADMIN_EMAIL, cleanupProfiles, createProfileViaApi, execD1, insertHousehold, insertProfile, rows } from './householdFixtures';

/**
 * «Ya está en otro perfil», option B (Jon 2026-10-29), as a regular rescuer
 * (the `user` project) adding a phone on someone else's profile, where the
 * phone already sits on two profiles the admin owns (masked for this viewer):
 *
 *   1. The compact inline box: two rows (name, rating, «Ver perfil»), the
 *      household line only on the one whose housemate is 1★, the typed phone
 *      never repeated.
 *   2. «Ver perfil» opens a window over the page: the match card, the phone
 *      that matched marked «coincide»; «No es esta persona» closes it and that
 *      row is gone — the typed phone still in the field.
 *   3. «Es la misma persona» in the other's window flags the pair (adopter_flags,
 *      reason duplicate) and its row reads «Marcado».
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
        // Dos lives with someone rated 1★: the problem that brings the household line.
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

    test('compact box → window → «No es esta persona» hides the row → «Es la misma persona» flags the pair', async ({ page }) => {
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
        await expect(dos.getByTestId('card-household-line')).toHaveCount(1);
        await expect(uno.getByTestId('card-household-line')).toHaveCount(0);
        // (The names carry the stamp, so look for the number as written.)
        await expect(box).not.toContainText(PHONE);
        await expect(box).not.toContainText(`-${PHONE.slice(-4)}`);

        // 2. The window, then «No es esta persona».
        await dos.getByTestId('dup-hint-view').click();
        const win = page.getByTestId('dup-hint-window');
        await expect(win).toBeVisible();
        await expect(win.getByTestId('dup-hint-window-head')).toContainText(DOS);
        await expect(win.getByTestId('card-household-line')).toHaveCount(1);
        await expect(win.getByTestId('dup-hint-contact').getByTestId('contact-matches')).toHaveCount(1);
        await expect(win.getByTestId('dup-hint-same')).toBeVisible();
        await expect(win.getByTestId('dup-hint-open-full')).toBeVisible();
        await win.getByTestId('dup-hint-not-this').click();
        await expect(win).toHaveCount(0);
        await expect(rowsInBox).toHaveCount(1);
        await expect(dos).toHaveCount(0);
        await expect(input).toHaveValue(PHONE);
        // Nothing was written for «No es esta persona».
        expect(rows(`SELECT id FROM adopter_flags WHERE adopter_id = '${ANCHOR}'`)).toHaveLength(0);

        // 3. «Es la misma persona» on the other one.
        await uno.getByTestId('dup-hint-view').click();
        await expect(win).toBeVisible();
        await win.getByTestId('dup-hint-same').click();
        await expect(win).toHaveCount(0, { timeout: 15_000 });
        await expect(uno.getByTestId('dup-hint-flagged')).toBeVisible();
        await expect.poll(() => rows(`SELECT reason, target_adopter_id AS t FROM adopter_flags WHERE adopter_id = '${ANCHOR}'`), { timeout: 15_000 })
            .toEqual([expect.objectContaining({ reason: 'duplicate', t: UNO_ID })]);
        await expect(input).toHaveValue(PHONE);
    });
});
