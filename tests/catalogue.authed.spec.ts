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

    test('on a card it reads as a sentence, and is a real tap target', async ({ page }) => {
        // ux-ui-guidelines §1.3, §1.5, §4.6. Two earlier attempts failed here:
        //   · a labelled switch inside the action row took 184px of 339 and
        //     squeezed the card's own date and «Actualizado por» to 31px — an
        //     ellipsis — without overflowing, so nothing LOOKED broken;
        //   · replacing it with a bare eye icon fixed the width and broke
        //     comprehension: colour plus glyph and no text (§1.5), an
        //     affordance matching nothing else on the card (§1.3), and 36px
        //     of tap target.
        // So this asserts the things that actually failed, not the pixels:
        // it says what it is, it is reachable with a thumb, and it leaves the
        // card's own information room to be read.
        for (const [w, h] of [[1280, 900], [375, 812]] as const) {
            await page.setViewportSize({ width: w, height: h });
            await page.goto('/my-animals?view=available');
            await page.waitForSelector('[data-testid^="listing-toggle-"]', { timeout: 30000 });

            const m = await page.evaluate(() => {
                const tg = document.querySelector('[data-testid^="listing-toggle-"]')!;
                const meta = document.querySelector('[data-testid^="last-update-"]');
                const r = tg.getBoundingClientRect();
                return {
                    h: Math.round(r.height),
                    text: (tg.textContent || '').trim(),
                    meta: meta ? Math.round(meta.getBoundingClientRect().width) : 0,
                    pageScrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                };
            });

            // It says what it means — never colour and a glyph alone (§1.5).
            expect(m.text, `label at ${w}px`).toMatch(/catalogue|catálogo|photo|foto/i);
            // Reachable with a thumb (§1.5, ≥44px).
            expect(m.h, `tap target at ${w}px`).toBeGreaterThanOrEqual(44);
            // The card still gets to say its own piece.
            expect(m.meta, `card meta at ${w}px`).toBeGreaterThan(120);
            expect(m.pageScrollX, `page scroll at ${w}px`).toBeLessThanOrEqual(0);
        }
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
