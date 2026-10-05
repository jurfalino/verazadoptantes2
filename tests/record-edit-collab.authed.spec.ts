import { test, expect, type Page, type Browser } from '@playwright/test';
import { execSync } from 'child_process';
import { dismissCountryBanner } from './helpers';

/**
 * Everyday record edits by two people at once (src/domain/fieldCollab.ts):
 *
 *  - Two teammates editing the same animal: different fields both land; the
 *    same field is refused with «<Nombre> cambió … mientras editabas» until
 *    the editor chooses — here «Guardar la mía igual».
 *  - The adopter profile in two tabs: the stale tab's save never reverts the
 *    field it didn't touch, and shows the other value «Actualizado por …».
 *
 * Admin = Ana (the page fixture), test user = Beto (second context), in a
 * fixture org that is removed again at the end — left behind, it would make
 * them teammates for every later spec (the PII masking specs rely on them
 * being strangers). The animal and adopter are this spec's own rows.
 */

const ADMIN_EMAIL = 'gatitosolivos@gmail.com';
const USER_EMAIL = 'testuser@example.com';

function execD1(sql: string): string {
    return execSync(
        `npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`,
        { cwd: process.cwd(), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
}
function one(sql: string): Record<string, unknown> {
    const w = JSON.parse(execD1(sql));
    return ((Array.isArray(w) ? w[0] : w)?.results ?? [])[0] ?? {};
}

async function openAnimalEditor(page: Page, animalId: string) {
    await page.goto(`/my-animals/${animalId}`);
    await dismissCountryBanner(page);
    await expect(page.getByTestId('animal-name')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('profile-edit').click();
    await expect(page.getByTestId('inline-edit-form')).toBeVisible({ timeout: 30_000 });
}

test('two teammates on the same animal: different fields both land; the same field asks first', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const stamp = Date.now();
    const orgId = `test-record-collab-org-${stamp}`;
    const animalId = `test-animal-collab-${stamp}`;
    execD1(`INSERT INTO organizations (id, name, created_by) VALUES ('${orgId}', 'Collab ${stamp}', '${ADMIN_EMAIL}')`);
    execD1(`INSERT INTO org_members (id, org_id, user_email, role) VALUES ('${orgId}-a', '${orgId}', '${ADMIN_EMAIL}', 'owner'), ('${orgId}-b', '${orgId}', '${USER_EMAIL}', 'member')`);
    execD1(`INSERT INTO animals (id, name, species, color, details, added_by, created_at, updated_at) VALUES ('${animalId}', 'Collab${stamp}', 'cat', 'gris', 'Tímida', '${ADMIN_EMAIL}', strftime('%s','now'), strftime('%s','now'))`);
    try {
        await animalScenario(page, browser, animalId, stamp);
    } finally {
        execD1(`DELETE FROM animals WHERE id = '${animalId}'`);
        execD1(`DELETE FROM org_members WHERE org_id = '${orgId}'`);
        execD1(`DELETE FROM organizations WHERE id = '${orgId}'`);
    }
});

async function animalScenario(page: Page, browser: Browser, animalId: string, stamp: number) {
    const betoCtx = await browser.newContext({ storageState: '.auth/user.json' });
    const beto = await betoCtx.newPage();
    const animal = () => one(`SELECT name, color, details FROM animals WHERE id = '${animalId}'`);

    // Both open the editor on the same version.
    await openAnimalEditor(page, animalId);
    await openAnimalEditor(beto, animalId);

    // Different fields: Ana changes the color, then Beto (still on the old
    // version) changes the name. Both land; Beto's save didn't revert the color.
    await page.locator('#ae-color').fill(`atigrada-${stamp}`);
    await page.getByTestId('inline-edit-save').click();
    await expect(page.getByTestId('inline-edit-form')).not.toBeVisible({ timeout: 30_000 });
    await beto.locator('#ae-name').fill(`Beto${stamp}`);
    await beto.getByTestId('inline-edit-save').click();
    await expect(beto.getByTestId('inline-edit-form')).not.toBeVisible({ timeout: 30_000 });
    await expect.poll(() => animal().name, { timeout: 15_000 }).toBe(`Beto${stamp}`);
    expect(animal().color).toBe(`atigrada-${stamp}`);

    // Same field: both open again; Ana saves the description first.
    await openAnimalEditor(page, animalId);
    await openAnimalEditor(beto, animalId);
    await page.locator('#ae-details').fill(`ANA-${stamp}`);
    await page.getByTestId('inline-edit-save').click();
    await expect(page.getByTestId('inline-edit-form')).not.toBeVisible({ timeout: 30_000 });

    // Beto's save of the same field is refused, with Ana's name; nothing of hers is overwritten.
    await beto.locator('#ae-details').fill(`BETO-${stamp}`);
    await beto.getByTestId('inline-edit-save').click();
    const notice = beto.getByTestId('animal-details-conflict');
    await expect(notice).toBeVisible({ timeout: 30_000 });
    // The same name the animal card shows for her (animal-profile spec: «Test Admin»).
    await expect(notice).toContainText('Test Admin');
    await expect(beto.getByTestId('inline-edit-form')).toBeVisible();
    expect(animal().details).toBe(`ANA-${stamp}`);

    // «Ver su versión» shows hers; «Guardar la mía igual» writes his.
    await beto.getByTestId('animal-details-conflict-view').click();
    await expect(beto.getByTestId('animal-details-conflict-theirs')).toContainText(`ANA-${stamp}`);
    await beto.getByTestId('animal-details-conflict-keep-mine').click();
    await expect(beto.getByTestId('inline-edit-form')).not.toBeVisible({ timeout: 30_000 });
    await expect.poll(() => animal().details, { timeout: 15_000 }).toBe(`BETO-${stamp}`);
    await betoCtx.close();
}

test('adopter profile in two tabs: the stale tab never reverts the other field', async ({ page, context }) => {
    test.setTimeout(150_000);
    const stamp = Date.now();
    const adopterId = `test-adopter-collab-${stamp}`;
    execD1(`INSERT INTO adopters (id, name, status, family_members, added_by, country, created_at, updated_at) VALUES ('${adopterId}', 'Collab ${stamp}', '5', 'Hijo', '${ADMIN_EMAIL}', 'AR', strftime('%s','now'), strftime('%s','now'))`);
    const row = () => one(`SELECT name, family_members AS fam FROM adopters WHERE id = '${adopterId}'`);
    const open = async (p: Page) => {
        await p.goto(`/adopter/${adopterId}`);
        await dismissCountryBanner(p);
        await expect(p.getByTestId('name-edit-btn')).toBeVisible({ timeout: 30_000 });
    };
    try {
        const tabA = page;
        const tabB = await context.newPage();
        await open(tabA);
        await open(tabB);

        // Tab A changes the family text.
        await tabA.getByTestId('family-edit-btn').click();
        await tabA.getByTestId('family-edit-btn-input').fill('Hijo y perro');
        await tabA.getByTestId('family-edit-btn-save').click();
        await expect(tabA.getByTestId('family-edit-btn-input')).toHaveCount(0, { timeout: 30_000 });
        await expect.poll(() => row().fam, { timeout: 15_000 }).toBe('Hijo y perro');

        // Tab B — still showing «Hijo» — renames. The family text stays A's,
        // and B now shows it, marked as updated by someone else.
        await tabB.getByTestId('name-edit-btn').click();
        await tabB.getByTestId('name-edit-btn-input').fill(`Renombrada ${stamp}`);
        await tabB.getByTestId('name-edit-btn-save').click();
        await expect(tabB.getByTestId('name-edit-btn-input')).toHaveCount(0, { timeout: 30_000 });
        await expect.poll(() => row().name, { timeout: 15_000 }).toBe(`Renombrada ${stamp}`);
        expect(row().fam).toBe('Hijo y perro');
        await expect(tabB.getByTestId('adopter-familyMembers-updated-by')).toBeVisible();
        await expect(tabB.getByText('Hijo y perro')).toBeVisible();

        // Same field: tab A (which never saw the rename) renames too — refused.
        await tabA.getByTestId('name-edit-btn').click();
        await tabA.getByTestId('name-edit-btn-input').fill(`Otra ${stamp}`);
        await tabA.getByTestId('name-edit-btn-save').click();
        await expect(tabA.getByTestId('adopter-name-conflict')).toBeVisible({ timeout: 30_000 });
        expect(row().name).toBe(`Renombrada ${stamp}`);
        await tabA.getByTestId('adopter-name-conflict-keep-mine').click();
        await expect.poll(() => row().name, { timeout: 15_000 }).toBe(`Otra ${stamp}`);
        await expect(tabA.getByTestId('adopter-name-conflict')).toHaveCount(0);
        await tabB.close();
    } finally {
        execD1(`DELETE FROM adopter_history WHERE adopter_id = '${adopterId}'`);
        execD1(`DELETE FROM duplicate_tokens WHERE adopter_id = '${adopterId}'`);
        execD1(`DELETE FROM adopters WHERE id = '${adopterId}'`);
    }
});

test('household: a new member shows once; a rename a teammate beat is refused, not overwritten', async ({ page, context }) => {
    test.setTimeout(150_000);
    const stamp = Date.now();
    const adopterId = `test-adopter-hh-collab-${stamp}`;
    execD1(`INSERT INTO adopters (id, name, status, household_members, added_by, country, created_at, updated_at) VALUES ('${adopterId}', 'Hogar ${stamp}', '5', '[]', '${ADMIN_EMAIL}', 'AR', strftime('%s','now'), strftime('%s','now'))`);
    const stored = () => JSON.parse(String(one(`SELECT household_members AS h FROM adopters WHERE id = '${adopterId}'`).h ?? '[]')) as Array<{ name: string }>;
    const open = async (p: Page) => {
        await p.goto(`/adopter/${adopterId}`);
        await dismissCountryBanner(p);
        await expect(p.getByTestId('household-add-member')).toBeVisible({ timeout: 30_000 });
    };
    try {
        await open(page);
        await page.getByTestId('household-add-member').click();
        await page.getByTestId('household-member-name-input').fill('Ana Hija');
        await page.getByTestId('household-member-save').click();
        await expect.poll(() => stored().map(m => m.name), { timeout: 15_000 }).toEqual(['Ana Hija']);
        // After the refresh lands: exactly one row, and it is editable as a saved member.
        await page.waitForTimeout(2_000);
        await expect(page.getByTestId('household-member')).toHaveCount(1);

        // Tab B renames her first; tab A (never refreshed) renames too.
        const tabB = await context.newPage();
        await open(tabB);
        await tabB.getByTestId('household-member-edit').click();
        await tabB.getByTestId('household-member-name-input').fill('Ana María');
        await tabB.getByTestId('household-member-save').click();
        await expect.poll(() => stored().map(m => m.name), { timeout: 15_000 }).toEqual(['Ana María']);

        await page.getByTestId('household-member-edit').click();
        await page.getByTestId('household-member-name-input').fill('Anita');
        await page.getByTestId('household-member-save').click();
        await expect(page.getByText(/changed this while you were editing|cambió este dato mientras lo editabas/).first()).toBeVisible({ timeout: 30_000 });
        expect(stored().map(m => m.name)).toEqual(['Ana María']);
        await expect(page.getByTestId('household-member')).toHaveCount(1);
        await tabB.close();
    } finally {
        execD1(`DELETE FROM adopter_history WHERE adopter_id = '${adopterId}'`);
        execD1(`DELETE FROM duplicate_tokens WHERE adopter_id = '${adopterId}'`);
        execD1(`DELETE FROM adopters WHERE id = '${adopterId}'`);
    }
});
