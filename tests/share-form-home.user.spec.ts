import { test, expect } from '@playwright/test';
import { dismissCountryBanner } from './helpers';
import { execD1Batch, rows } from './db';

/**
 * «Compartir formulario» from the home (Jon 2026-11-13, option B): the row
 * under the search opens the share window; «¿Para qué animal?» opens a list
 * that, from 7 animals, can be searched by colour; the link then names the
 * animal, and the public form's config names it too — but never another
 * team's animal (a forged `&animal=`).
 *
 * Runs as the `user` project (testuser@example.com). Fixtures carry
 * `test-sf-fixture-*` ids and are removed after. Selectors are data-testids:
 * Chromium renders English.
 */

const USER = 'testuser@example.com';
const stamp = Date.now();
const ID = (k: string) => `test-sf-fixture-${k}-${stamp}`;
// Seven animals, so the search box shows; one has a colour nobody else has.
const ANIMALS = Array.from({ length: 7 }, (_, i) => ({ id: ID(`an${i}`), name: `Compartible ${i} ${stamp}` }));
const NEEDLE = ANIMALS[3];
const NEEDLE_COLOR = `azabache${stamp}`;
const STRANGER_ANIMAL = { id: ID('stranger'), name: `Ajeno ${stamp}` };

test.describe.serial('Compartir formulario from the home', () => {
    test.beforeAll(() => {
        execD1Batch([
            ...ANIMALS.map((a, i) => `INSERT INTO animals (id, name, species, color, added_by, created_at, updated_at) VALUES ('${a.id}', '${a.name}', '${i % 2 ? 'cat' : 'dog'}', '${a === NEEDLE ? NEEDLE_COLOR : 'gris'}', '${USER}', strftime('%s','now','-${i} minutes'), strftime('%s','now'))`),
            `INSERT INTO animals (id, name, species, added_by, created_at, updated_at) VALUES ('${STRANGER_ANIMAL.id}', '${STRANGER_ANIMAL.name}', 'dog', 'stranger-sf@example.com', strftime('%s','now'), strftime('%s','now'))`,
        ]);
    });

    test.afterAll(() => {
        execD1Batch([`DELETE FROM animals WHERE id IN (${[...ANIMALS, STRANGER_ANIMAL].map(a => `'${a.id}'`).join(', ')})`]);
    });

    test('the row opens the window; the list finds an animal by colour; the link names it', async ({ page }) => {
        await page.goto('/');
        await dismissCountryBanner(page);
        await page.getByTestId('home-share-form').click();

        const pick = page.getByTestId('share-form-pick-animal');
        await expect(pick).toBeVisible({ timeout: 30_000 });
        await pick.click();

        await expect(page.getByTestId('share-animal-picker')).toBeVisible();
        await page.getByTestId('share-animal-search').fill(NEEDLE_COLOR.slice(0, 12));
        const only = page.getByTestId(`share-animal-${NEEDLE.id}`);
        await expect(only).toBeVisible();
        await expect(page.locator('[data-testid^="share-animal-test-sf-fixture-"]')).toHaveCount(1);
        await only.click();

        // Back in the window: the row and the link carry the animal.
        await expect(pick).toContainText(NEEDLE.name);
        const openLink = page.getByRole('link', { name: /Open in new tab|Abrir en nueva pestaña/i });
        await expect.poll(async () => (await openLink.getAttribute('href')) ?? '', { timeout: 15_000 }).toContain(`animal=${encodeURIComponent(NEEDLE.id)}`);

        // «Ninguno en particular» takes the animal off the link again.
        await pick.click();
        await page.getByTestId('share-animal-none').click();
        await expect.poll(async () => (await openLink.getAttribute('href')) ?? '').not.toContain('animal=');
    });

    test('the public form names the link\'s animal, never another team\'s', async ({ request }) => {
        const [{ id: userId }] = rows(`SELECT id FROM user WHERE email = '${USER}'`) as Array<{ id: string }>;
        const own = await (await request.get(`/api/form/${userId}?animalId=${encodeURIComponent(NEEDLE.id)}`)).json();
        expect(own.animal).toEqual({ name: NEEDLE.name, photo: null });
        const forged = await (await request.get(`/api/form/${userId}?animalId=${encodeURIComponent(STRANGER_ANIMAL.id)}`)).json();
        expect(forged.animal).toBeNull();
        const general = await (await request.get(`/api/form/${userId}`)).json();
        expect(general.animal).toBeNull();
    });
});
