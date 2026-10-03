import { test, expect } from '@playwright/test';

/**
 * v2.56.128 — the rescuer's switch for the public catalogue.
 *
 * What the stranger sees is asserted in catalogue.unauthed.spec.ts. This is
 * the half the rescuer touches: the switch is where they already are (the
 * animal's page and its card), it says what is actually true rather than just
 * on/off, and flipping it changes what the catalogue serves — which is the
 * only thing that makes it worth having.
 */

const FOSTERED = 'test-animal-fixture-cat';       // in a foster home, photo, switch on
const HIDDEN = 'test-animal-fixture-hidden';      // available, photo, switch off
const NO_PHOTO = 'test-animal-fixture-note';      // fostered, no photo at all
const ADOPTED = 'test-animal-fixture-1';          // has a home

test.describe('The public-catalogue switch', () => {

    test('is on the animal\'s page, and says what is actually true', async ({ page }) => {
        await page.goto(`/my-animals/${FOSTERED}`);
        await expect(page.getByTestId('animal-name')).toHaveText('Catalogo', { timeout: 30000 });

        const toggle = page.getByTestId(`listing-toggle-${FOSTERED}`);
        await expect(toggle).toBeVisible();
        await expect(toggle).toHaveAttribute('aria-checked', 'true');
        await expect(page.getByTestId(`listing-hint-${FOSTERED}`))
            .toContainText(/apply to adopt|postularse para adoptarlo/);
    });

    test('names the missing photo instead of silently doing nothing', async ({ page }) => {
        // The failure this prevents: the rescuer turns it on, nothing appears
        // in the catalogue, and nothing on screen explains why.
        await page.goto(`/my-animals/${NO_PHOTO}`);
        await expect(page.getByTestId('animal-name')).toHaveText('Soloanota', { timeout: 30000 });
        await expect(page.getByTestId(`listing-toggle-${NO_PHOTO}`)).toHaveAttribute('aria-checked', 'true');
        await expect(page.getByTestId(`listing-hint-${NO_PHOTO}`))
            .toContainText(/No photo yet|Le falta una foto/);
    });

    test('reads as off for an animal the rescuer took out', async ({ page }) => {
        await page.goto(`/my-animals/${HIDDEN}`);
        await expect(page.getByTestId('animal-name')).toHaveText('Escondido', { timeout: 30000 });
        await expect(page.getByTestId(`listing-toggle-${HIDDEN}`)).toHaveAttribute('aria-checked', 'false');
        await expect(page.getByTestId(`listing-hint-${HIDDEN}`))
            .toContainText(/under treatment|en tratamiento/);
    });

    test('is not offered for an animal that already has a home', async ({ page }) => {
        await page.goto(`/my-animals/${ADOPTED}`);
        await expect(page.getByTestId('animal-name')).toHaveText('Timon', { timeout: 30000 });
        await expect(page.getByTestId(`listing-toggle-${ADOPTED}`)).toHaveCount(0);
    });

    test('is on the card too, and flipping it changes what strangers see', async ({ page, request }) => {
        // Its own fixture, because this test writes: a sibling asserting on
        // the catalogue must not depend on the order it ran in.
        const OWN = 'test-animal-fixture-cat';

        await page.goto('/my-animals?view=available');
        const card = page.getByTestId(`animal-card-${OWN}`);
        await expect(card).toBeVisible({ timeout: 30000 });

        const toggle = page.getByTestId(`listing-toggle-${OWN}`);
        await expect(toggle).toBeVisible();
        await expect(toggle).toHaveAttribute('aria-checked', 'true');

        // Before: a stranger can open it.
        expect((await request.get(`/api/showcase/animal/${OWN}`)).status()).toBe(200);

        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 15000 });
        // The switch only means something if the catalogue agrees.
        await expect(async () => {
            expect((await request.get(`/api/showcase/animal/${OWN}`)).status()).toBe(404);
        }).toPass({ timeout: 20000, intervals: [500, 1000, 2000] });

        // Tapping the switch must not open the animal — the card navigates.
        expect(page.url()).toContain('/my-animals');

        // Put it back, and confirm the catalogue follows in both directions.
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 15000 });
        await expect(async () => {
            expect((await request.get(`/api/showcase/animal/${OWN}`)).status()).toBe(200);
        }).toPass({ timeout: 20000, intervals: [500, 1000, 2000] });
    });
});
