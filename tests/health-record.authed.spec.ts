import { test, expect } from '@playwright/test';

/**
 * v2.56.123 — the RESCUER's half of the shareable veterinary record: the
 * button on the animal's page and the handover modal behind it.
 *
 * What the family actually receives is asserted in
 * tests/health-record.unauthed.spec.ts, which hits the API with no session —
 * the way a WhatsApp link is opened. The two files have to agree on one thing,
 * and it is tested on both sides: the button appears exactly when the record
 * exists, so a rescuer can never send a link to a page that 404s.
 *
 * The /salud/:id page itself is a Vite app the Next dev server does not serve,
 * so it is out of reach here; its label helpers are unit-tested in
 * contract-app/src/lib/animalLabels.test.ts.
 *
 * Selectors are locale-agnostic (CI Chromium renders English).
 */

const ADOPTED = 'test-animal-fixture-1';          // Timon: adopted, one vaccination
const NOTE_ONLY = 'test-animal-fixture-note';     // Soloanota: fostered, nothing clinical
/** The shared address belongs to the ADOPTION, not the animal (v2.56.126). */
const ADOPTED_TOKEN = 'tok-fixture-1a-open';

test.describe('Health record handover', () => {

    test('the rescuer hands the record over without leaving the animal', async ({ page }) => {
        await page.goto(`/my-animals/${ADOPTED}`);
        await expect(page.getByTestId('animal-name')).toHaveText('Timon', { timeout: 30000 });

        // Timon is adopted AND has a vaccination, so the handover is offered.
        const button = page.getByTestId('profile-health-record');
        await expect(button).toBeVisible();
        await button.click();

        // The rescuer is told what leaves the app before they send it.
        const contents = page.getByTestId('health-share-contents');
        await expect(contents).toBeVisible();
        await expect(contents).toContainText(/Nothing about their adoption|Nada sobre su adopción/);

        // The message is prefilled with the public link and is editable.
        const message = page.getByTestId('health-share-message');
        await expect(message).toHaveValue(new RegExp(`/salud/${ADOPTED_TOKEN}`));
        // The animal's own id is public; it must not be the address.
        await expect(message).not.toHaveValue(new RegExp(`/salud/${ADOPTED}`));
        await message.fill('Mensaje propio');
        await expect(message).toHaveValue('Mensaje propio');

        // The preview opens the page the family will see — same id, /salud.
        await expect(page.getByTestId('health-share-preview'))
            .toHaveAttribute('href', new RegExp(`/salud/${ADOPTED_TOKEN}`));

        // And the rescuer is told the link is not forever.
        await expect(page.getByTestId('health-share-expires'))
            .toContainText(/stops working if you record a return|deja de funcionar si registrás una devolución/);

        // Still on the animal: the handover never navigates away.
        expect(page.url()).toContain(`/my-animals/${ADOPTED}`);
    });

    test('an animal with nothing clinical is never offered for handover', async ({ page }) => {
        // The button and the API agree by construction — both ask "is there a
        // clinical event?" — so the rescuer can never send a link that 404s.
        await page.goto(`/my-animals/${NOTE_ONLY}`);
        await expect(page.getByTestId('animal-name')).toHaveText('Soloanota', { timeout: 30000 });
        await expect(page.getByTestId('profile-health-record')).toHaveCount(0);
    });
});
