import { test, expect, request as playwrightRequest } from '@playwright/test';
import { dismissCountryBanner } from './helpers';
import { cleanupProfiles, createProfileViaApi, rows } from './householdFixtures';

/**
 * The new-profile form's «Continuar con este perfil» with the same phone in
 * another format (round 4/5): the rescuer's own profile holds
 * «+54 9 11 6xxx-xxxx»; on /adopter/create they type «11 6xxx-xxxx», the form
 * finds that profile, they continue and confirm — and the profile keeps that
 * phone ONCE (the duplicate matcher's own rule, foldContactEntries), not a
 * second «11 …» copy. Locale-agnostic: data-testids only (Chromium renders English).
 */
const stamp = Date.now();
const s = String(stamp);
const PHONE = `11 6${s.slice(-3)}-${s.slice(-7, -3)}`;
let MATCH_ID = '';

test.describe.serial('new-profile form: «Continuar con este perfil» with the same phone in another format', () => {
    test.beforeAll(async ({ baseURL }) => {
        // appendToExistingAdopter needs the profile to be the viewer's (or their team's): the user project's own.
        const user = await playwrightRequest.newContext({ baseURL, storageState: '.auth/user.json' });
        MATCH_ID = await createProfileViaApi(user, { name: `Mismo Telefono ${stamp}`, phone: `+54 9 ${PHONE}` });
        await user.dispose();
    });
    test.afterAll(() => cleanupProfiles([MATCH_ID]));

    test('typed «11 …» against «+54 9 11 …»: continue, confirm, the phone shows once', async ({ page }) => {
        test.setTimeout(180_000);
        await page.goto('/adopter/create');
        await dismissCountryBanner(page);
        // The form searches once there is a name; the profile's own name finds it too.
        await page.getByTestId('adopter-name-input').fill(`Mismo Telefono ${stamp}`);
        // The fresh form opens the contact composer on a phone.
        await page.getByTestId('ce-composer-input').fill(PHONE);
        await page.getByTestId('ce-composer-submit').click();
        await expect(page.getByTestId('ce-chip')).toHaveCount(1, { timeout: 10_000 });

        // The form finds the profile; «Continuar con este perfil» (strip or peek, whichever shows it).
        const continueBtn = page.locator('[data-testid="strong-match-continue"], [data-testid="dup-peek-continue"]').first();
        await expect(continueBtn).toBeVisible({ timeout: 30_000 });
        await continueBtn.click();
        const dialog = page.getByTestId('continue-merge-dialog');
        await expect(dialog).toBeVisible();
        // Nothing new to add: the phone is already there.
        await expect(dialog.getByTestId('continue-merge-nothing-new')).toBeVisible();
        await dialog.getByTestId('continue-merge-confirm').click();

        await page.waitForURL(new RegExp(`/adopter/${MATCH_ID}$`), { timeout: 30_000 });
        await expect(page.getByTestId('ce-chip').first()).toBeVisible({ timeout: 30_000 });
        const digits = PHONE.replace(/\D/g, '').slice(-8);
        const shown = await page.getByTestId('ce-chip').allInnerTexts();
        expect(shown.filter(t => t.replace(/\D/g, '').includes(digits))).toHaveLength(1);
        const stored = JSON.parse(String(rows(`SELECT contact_entries AS c FROM adopters WHERE id = '${MATCH_ID}'`)[0].c)) as Array<{ type: string; value: string }>;
        expect(stored.filter(e => e.type === 'phone').map(e => e.value)).toEqual([`+54 9 ${PHONE}`]);
    });
});
