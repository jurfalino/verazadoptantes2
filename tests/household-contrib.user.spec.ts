import { test, expect } from '@playwright/test';
import { dismissCountryBanner } from './helpers';
import { cleanupProfiles, execD1, fillAddForm, housemates, insertHousehold, insertProfile, memberMenuPanel, profileNamed, rows, saveAsNew } from './householdFixtures';

/**
 * Household contributions (D54 + D55) on households as profiles (Task 8), as a
 * regular rescuer (the `user` project: testuser@example.com, in no org, not an
 * admin) on a household another rescuer owns:
 *
 *   - D54: anyone signed in adds a person (with a phone): a profile owned by
 *     the host's owner, the add and the phone credited to them; on what the
 *     owner added they get only «Editar» (no «Quitar del hogar», no deletion).
 *   - D55: «Agregar dato de contacto» on a housemate's card saves on THAT
 *     person's profile, never on the host's.
 *
 * PII gating ON (as in production). Own rows (test-hhcontrib-fixture-*),
 * removed after. Selectors are data-testids: Chromium renders English.
 */

const VIEWER = 'testuser@example.com';
const stamp = Date.now();
const OWNER = `hhcontrib-owner-${stamp}@example.com`;
const HOST = `test-hhcontrib-fixture-host-${stamp}`;
const MARTA = `test-hhcontrib-fixture-marta-${stamp}`;
const BRUNO = `test-hhcontrib-fixture-bruno-${stamp}`;
const HH = `test-hhcontrib-fixture-hh-${stamp}`;
const HOST_NAME = `Hhcontrib Ana ${stamp}`;
const MARTA_NAME = `Hhcontrib Marta ${stamp}`;
const BRUNO_NAME = `Hhcontrib Bruno ${stamp}`;
const NEW_MEMBER = `Pablo Contribuye ${stamp}`;
const NEW_MEMBER_PHONE = `11 5${String(stamp).slice(-3)}-0101`;
const BRUNO_PHONE = `11 6${String(stamp).slice(-3)}-0202`;

const contactsOf = (id: string) => JSON.parse(String(rows(`SELECT contact_entries AS c FROM adopters WHERE id = '${id}'`)[0]?.c ?? '[]')) as Array<{ value: string; addedBy?: string }>;

test.describe('household contributions by a non-owner (D54, D55)', () => {
    test.beforeAll(() => {
        cleanupProfiles([HOST, MARTA, BRUNO]);
        execD1(`INSERT OR REPLACE INTO app_config (key, value, updated_at, updated_by) VALUES ('ENABLE_PII_ACCESS_GATING', 'true', strftime('%s','now'), 'e2e')`);
        insertProfile({ id: HOST, name: HOST_NAME, owner: OWNER, contacts: [{ id: 'ce-host-1', type: 'phone', value: '11 4100-0001', addedBy: OWNER }] });
        insertProfile({ id: MARTA, name: MARTA_NAME, owner: OWNER, contacts: [{ id: 'ce-m-1', type: 'phone', value: '11 4200-0002', addedBy: OWNER }] });
        insertProfile({ id: BRUNO, name: BRUNO_NAME, owner: OWNER, contacts: [{ id: 'ce-b-1', type: 'email', value: `bruno-${stamp}@example.com`, addedBy: OWNER }] });
        insertHousehold(HH, HOST, [
            { id: `${HH}-m`, adopterId: MARTA, relationship: 'partner', addedBy: OWNER },
            { id: `${HH}-b`, adopterId: BRUNO, relationship: 'sibling', addedBy: OWNER },
        ]);
    });
    test.afterAll(() => {
        const made = profileNamed(NEW_MEMBER)?.id;
        cleanupProfiles([HOST, MARTA, BRUNO, ...(made ? [String(made)] : [])]);
        execD1(`DELETE FROM notifications WHERE user_id = '${OWNER}'`);
        execD1(`DELETE FROM app_config WHERE key = 'ENABLE_PII_ACCESS_GATING'`);
    });

    test('adds a person with a phone, gets only «Editar» on what the owner added, and adds a phone to a housemate\'s own profile', async ({ page }) => {
        test.setTimeout(180_000);
        const hostContactsBefore = contactsOf(HOST);
        expect(hostContactsBefore.map(e => e.value)).toEqual(['11 4100-0001']);

        await page.goto(`/adopter/${HOST}`);
        await dismissCountryBanner(page);
        const cards = page.getByTestId('household-member');
        await expect(cards).toHaveCount(2, { timeout: 30_000 });

        // ── What the owner added: «Editar» (the same form for everyone signed in), but not theirs to take
        // out or delete; contacts masked.
        const martaCard = cards.filter({ hasText: MARTA_NAME });
        await martaCard.getByTestId('household-member-menu').click();
        await expect(memberMenuPanel(martaCard).getByTestId('household-member-menu-edit')).toBeVisible();
        await expect(memberMenuPanel(martaCard).getByTestId('household-member-menu-remove')).toHaveCount(0);
        await expect(memberMenuPanel(martaCard).getByTestId('household-member-menu-delete')).toHaveCount(0);
        await expect(memberMenuPanel(martaCard).getByTestId('household-member-menu-request')).toHaveCount(0);
        await page.mouse.click(5, 300);
        // Her contacts sit behind «1 dato ▾», with a padlock: masked for this viewer.
        const martaToggle = martaCard.getByTestId('household-member-contacts-toggle');
        await expect(martaToggle.getByTestId('household-member-contacts-locked')).toHaveCount(1);
        await martaToggle.click();
        await expect(martaCard.getByTestId('linked-summary')).toBeVisible();
        await expect(martaCard.getByTestId('linked-summary')).not.toContainText('11 4200-0002');

        // ── D54: anyone signed in adds someone, with a phone.
        await fillAddForm(page, { name: NEW_MEMBER, relationship: 'child', phone: NEW_MEMBER_PHONE });
        await saveAsNew(page);
        const mine = cards.filter({ hasText: NEW_MEMBER });
        await expect(mine).toHaveCount(1, { timeout: 30_000 });
        const made = profileNamed(NEW_MEMBER)!;
        expect(made.added_by, 'owned by the host\'s owner').toBe(OWNER);
        expect(housemates(HOST)).toContainEqual(expect.objectContaining({ profileId: made.id, addedBy: VIEWER }));
        expect(contactsOf(String(made.id)).map(e => [e.value, e.addedBy])).toEqual([[NEW_MEMBER_PHONE, VIEWER]]);

        // After a reload it is still theirs: their own phone readable, «Editar» + «Quitar del hogar» offered.
        await page.reload();
        await dismissCountryBanner(page);
        await expect(cards).toHaveCount(3, { timeout: 30_000 });
        await mine.getByTestId('household-member-contacts-toggle').click();
        await expect(mine.getByTestId('linked-summary')).toContainText(NEW_MEMBER_PHONE);
        await expect(mine.getByTestId('household-member-own')).toBeVisible();
        await mine.getByTestId('household-member-menu').click();
        await expect(memberMenuPanel(mine).getByTestId('household-member-menu-edit')).toBeVisible();
        await expect(memberMenuPanel(mine).getByTestId('household-member-menu-remove')).toBeVisible();
        // Not their profile: no deletion item.
        await expect(memberMenuPanel(mine).getByTestId('household-member-menu-delete')).toHaveCount(0);
        await expect(memberMenuPanel(mine).getByTestId('household-member-menu-request')).toHaveCount(0);
        await page.mouse.click(5, 300); // outside: the menu closes
        await expect(memberMenuPanel(mine)).toHaveCount(0);

        // ── D55: a phone added on a housemate's card goes to THEIR profile.
        const brunoCard = cards.filter({ hasText: BRUNO_NAME });
        await brunoCard.getByTestId('household-member-contacts-toggle').click();
        await brunoCard.getByTestId('linked-contact-add-trigger').click();
        await brunoCard.getByTestId('linked-contact-type-phone').click();
        await brunoCard.getByTestId('linked-contact-composer-input').fill(BRUNO_PHONE);
        await brunoCard.getByTestId('linked-contact-composer-submit').click();
        await expect.poll(() => contactsOf(BRUNO).map(e => [e.value, e.addedBy]), { timeout: 15_000 }).toContainEqual([BRUNO_PHONE, VIEWER]);
        await expect(brunoCard.getByTestId('linked-summary')).toContainText(BRUNO_PHONE, { timeout: 30_000 });
        expect(contactsOf(HOST)).toEqual(hostContactsBefore);

        // Edit/delete as on Bruno's own profile: on the phone this viewer added, not on the owner's entry.
        const brunoChips = brunoCard.getByTestId('linked-contact-chip');
        const minePhone = brunoChips.filter({ hasText: BRUNO_PHONE });
        await expect(minePhone.getByTestId('linked-contact-edit-btn')).toHaveCount(1);
        await expect(minePhone.getByTestId('linked-contact-delete-btn')).toHaveCount(1);
        await expect(brunoChips).toHaveCount(2);
        await expect(brunoCard.getByTestId('linked-contact-edit-btn')).toHaveCount(1);
        await expect(brunoCard.getByTestId('linked-contact-delete-btn')).toHaveCount(1);
        // Marta's list (all the owner's): none.
        await martaCard.getByTestId('household-member-contacts-toggle').click();
        await expect(martaCard.getByTestId('linked-contact-chip')).toHaveCount(1);
        await expect(martaCard.getByTestId('linked-contact-edit-btn')).toHaveCount(0);
        await expect(martaCard.getByTestId('linked-contact-delete-btn')).toHaveCount(0);

        // It fits a phone: no sideways scroll with the composer open; the ⋯ target is ≥ 44px.
        await page.setViewportSize({ width: 390, height: 844 });
        await brunoCard.getByTestId('linked-contact-add-trigger').click();
        await brunoCard.getByTestId('linked-contact-type-phone').click();
        await expect(brunoCard.getByTestId('linked-contact-composer-input')).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        const menuBox = await mine.getByTestId('household-member-menu').boundingBox();
        expect(menuBox && Math.min(menuBox.width, menuBox.height)).toBeGreaterThanOrEqual(44);

        // And on Bruno's own profile: the phone is there, and so is his household (the host).
        await page.goto(`/adopter/${BRUNO}`);
        await dismissCountryBanner(page);
        await expect(page.getByTestId('ce-chip').filter({ hasText: BRUNO_PHONE })).toHaveCount(1, { timeout: 30_000 });
        await expect(page.getByTestId('household-member').filter({ hasText: HOST_NAME })).toHaveCount(1);
    });
});
