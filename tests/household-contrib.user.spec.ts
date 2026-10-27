import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { dismissCountryBanner } from './helpers';

/**
 * Household contributions (spec docs/superpowers/specs/2026-10-25-pendientes-d-design.md,
 * D54 + D55), as a regular rescuer (the `user` project: testuser@example.com,
 * in no org, not an admin) on a profile another rescuer owns:
 *
 *   - D54: they add a household member and a phone on it, and see both; the
 *     owner's member shows them no edit or remove, its contact no edit/remove.
 *   - D55: «Agregar dato de contacto» on a linked conviviente's card saves on
 *     the LINKED profile (seen there), the host's own contacts and that
 *     member's household copy stay as they were.
 *
 * PII gating ON (as in production — the add button was hidden there for
 * non-team viewers). Own rows (test-hhcontrib-fixture-*), removed after.
 * Selectors are data-testids: Chromium renders English.
 */

function execD1(sql: string): string {
    return execSync(
        `npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`,
        { cwd: process.cwd(), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
}
const rows = (sql: string): Array<Record<string, unknown>> => {
    try {
        const wrapped = JSON.parse(execD1(sql));
        return (Array.isArray(wrapped) ? wrapped[0] : wrapped)?.results ?? [];
    } catch { return []; }
};
const sqlJson = (v: unknown) => JSON.stringify(v).replace(/'/g, "''");

const VIEWER = 'testuser@example.com';
const stamp = Date.now();
const OWNER = `hhcontrib-owner-${stamp}@example.com`;
const HOST = `test-hhcontrib-fixture-host-${stamp}`;
const LINKED = `test-hhcontrib-fixture-linked-${stamp}`;
const LINK = `test-hhcontrib-fixture-link-${stamp}`;
const HOST_NAME = `Hhcontrib Ana ${stamp}`;
const LINKED_NAME = `Hhcontrib Bruno ${stamp}`;

const HOST_CONTACTS = [{ id: 'ce-host-1', type: 'phone', value: '11 4100-0001', addedBy: OWNER }];
const HOST_MEMBERS = [
    { id: 'hm-owner', name: 'Marta Duena', relationship: 'partner', addedBy: OWNER, contactEntries: [{ id: 'ce-hm-1', type: 'phone', value: '11 4200-0002', addedBy: OWNER }] },
    { id: 'hm-link', name: LINKED_NAME, relationship: 'sibling', addedBy: OWNER, profileId: LINKED, contactEntries: [] },
];
const LINKED_CONTACTS = [{ id: 'ce-l-1', type: 'email', value: `bruno-${stamp}@example.com`, addedBy: OWNER }];

const NEW_MEMBER = 'Pablo Contribuye';
const NEW_MEMBER_PHONE = '11 5555-0101';
const LINKED_PHONE = '11 6666-0202';

function cleanup() {
    for (const id of [HOST, LINKED]) {
        execD1(`DELETE FROM adopter_history WHERE adopter_id = '${id}'`);
        execD1(`DELETE FROM pii_access_grants WHERE adopter_id = '${id}'`);
        execD1(`DELETE FROM pii_access_requests WHERE adopter_id = '${id}'`);
        execD1(`DELETE FROM duplicate_tokens WHERE adopter_id = '${id}'`);
        execD1(`DELETE FROM adopters WHERE id = '${id}'`);
        execD1(`DELETE FROM notifications WHERE url LIKE '%${id}%'`);
    }
    execD1(`DELETE FROM household_links WHERE host_adopter_id = '${HOST}' OR linked_adopter_id = '${LINKED}'`);
    execD1(`DELETE FROM notifications WHERE user_id = '${OWNER}'`);
}

test.describe('household contributions by a non-owner (D54, D55)', () => {
    test.beforeAll(() => {
        cleanup();
        execD1(`INSERT OR REPLACE INTO app_config (key, value, updated_at, updated_by) VALUES ('ENABLE_PII_ACCESS_GATING', 'true', strftime('%s','now'), 'e2e')`);
        execD1(
            `INSERT INTO adopters (id, name, contact_info, contact_entries, household_members, country, status, added_by, is_public, deleted_at, created_at, updated_at) ` +
            `VALUES ('${HOST}', '${HOST_NAME}', 'Tel: 11 4100-0001', '${sqlJson(HOST_CONTACTS)}', '${sqlJson(HOST_MEMBERS)}', 'AR', '5', '${OWNER}', 0, NULL, strftime('%s','now','-5 days'), strftime('%s','now'))`,
        );
        execD1(
            `INSERT INTO adopters (id, name, contact_info, contact_entries, household_members, country, status, added_by, is_public, deleted_at, created_at, updated_at) ` +
            `VALUES ('${LINKED}', '${LINKED_NAME}', '', '${sqlJson(LINKED_CONTACTS)}', '[]', 'AR', '5', '${OWNER}', 0, NULL, strftime('%s','now','-5 days'), strftime('%s','now'))`,
        );
        execD1(`INSERT INTO household_links (id, host_adopter_id, linked_adopter_id, member_id, created_by, created_at) VALUES ('${LINK}', '${HOST}', '${LINKED}', 'hm-link', '${OWNER}', strftime('%s','now','-5 days'))`);
    });
    test.afterAll(() => {
        cleanup();
        execD1(`DELETE FROM app_config WHERE key = 'ENABLE_PII_ACCESS_GATING'`);
    });

    test('adds a member with a phone, gets no controls on the owner\'s member, and adds a phone to the linked profile', async ({ page }) => {
        test.setTimeout(180_000);
        const hostMembers = () => JSON.parse(String(rows(`SELECT household_members AS h FROM adopters WHERE id = '${HOST}'`)[0]?.h ?? '[]')) as Array<{ id: string; name: string; addedBy?: string; contactEntries: Array<{ value: string; addedBy?: string }> }>;
        const contactsOf = (id: string) => JSON.parse(String(rows(`SELECT contact_entries AS c FROM adopters WHERE id = '${id}'`)[0]?.c ?? '[]')) as Array<{ value: string; addedBy?: string }>;
        const hostContactsBefore = contactsOf(HOST);
        // rows() answers [] on a failed query: make sure the baseline is the seeded contact.
        expect(hostContactsBefore.map(e => e.value)).toEqual(['11 4100-0001']);

        await page.goto(`/adopter/${HOST}`);
        await dismissCountryBanner(page);
        const cards = page.getByTestId('household-member');
        await expect(cards).toHaveCount(2, { timeout: 30_000 });

        // ── The owner's member: theirs, not this viewer's — nothing to change on it.
        const ownersCard = cards.nth(0);
        await expect(ownersCard.getByTestId('household-member-edit')).toHaveCount(0);
        await expect(ownersCard.getByTestId('household-member-remove')).toHaveCount(0);
        await expect(ownersCard.getByTestId('household-contact-edit')).toHaveCount(0);
        await expect(ownersCard.getByTestId('household-contact-remove')).toHaveCount(0);

        // ── D54: anyone signed in adds a member, then a phone on it.
        await page.getByTestId('household-add-member').click();
        await page.getByTestId('household-member-name-input').fill(NEW_MEMBER);
        await page.getByTestId('household-member-save').click();
        const mine = cards.filter({ hasText: NEW_MEMBER });
        await expect(mine).toHaveCount(1, { timeout: 30_000 });
        await expect.poll(() => hostMembers().find(m => m.name === NEW_MEMBER)?.addedBy, { timeout: 15_000 }).toBe(VIEWER);

        await mine.getByTestId('household-add-contact').click();
        await mine.getByTestId('household-contact-type-phone').click();
        await mine.getByTestId('household-contact-input').fill(NEW_MEMBER_PHONE);
        await mine.getByTestId('household-contact-save').click();
        await expect(mine).toContainText(NEW_MEMBER_PHONE, { timeout: 30_000 });
        await expect.poll(() => hostMembers().find(m => m.name === NEW_MEMBER)?.contactEntries.map(e => [e.value, e.addedBy]), { timeout: 15_000 })
            .toEqual([[NEW_MEMBER_PHONE, VIEWER]]);

        // After a reload it is still theirs: name and phone unmasked, edit + remove offered.
        await page.reload();
        await dismissCountryBanner(page);
        await expect(cards).toHaveCount(3, { timeout: 30_000 });
        await expect(mine).toContainText(NEW_MEMBER_PHONE);
        await expect(mine.getByTestId('household-member-edit')).toHaveCount(1);
        await expect(mine.getByTestId('household-member-remove')).toHaveCount(1);
        await expect(cards.nth(0).getByTestId('household-member-edit')).toHaveCount(0);

        // The same phone again: nothing appended — no second row, here or stored.
        await mine.getByTestId('household-add-contact').click();
        await mine.getByTestId('household-contact-type-phone').click();
        await mine.getByTestId('household-contact-input').fill(NEW_MEMBER_PHONE);
        await mine.getByTestId('household-contact-save').click();
        await expect(mine.getByTestId('household-contact-input')).toHaveCount(0, { timeout: 15_000 });
        await expect(mine.locator('li', { hasText: NEW_MEMBER_PHONE })).toHaveCount(1);
        expect(hostMembers().find(m => m.name === NEW_MEMBER)?.contactEntries).toHaveLength(1);

        // ── D55: a phone added on the linked conviviente's card goes to THEIR profile.
        const linkedCard = cards.filter({ has: page.getByTestId('linked-summary') });
        await expect(linkedCard).toHaveCount(1);
        // A linked member's card adds only through its summary — one place, one copy.
        await expect(linkedCard.getByTestId('household-add-contact')).toHaveCount(0);
        await linkedCard.getByTestId('linked-add-contact').click();
        await linkedCard.getByTestId('linked-contact-type-phone').click();
        // Same composer as any member's: no extra label.
        await expect(linkedCard.getByTestId('linked-contact-note')).toHaveCount(0);
        await linkedCard.getByTestId('linked-contact-input').fill(LINKED_PHONE);
        await linkedCard.getByTestId('linked-contact-save').click();

        await expect.poll(() => contactsOf(LINKED).map(e => [e.value, e.addedBy]), { timeout: 15_000 })
            .toContainEqual([LINKED_PHONE, VIEWER]);
        // The summary refreshes in place, the viewer's own phone readable to them.
        await expect(linkedCard.getByTestId('linked-summary')).toContainText(LINKED_PHONE, { timeout: 30_000 });
        // The host is untouched: its own contacts, and the member's household copy.
        expect(contactsOf(HOST)).toEqual(hostContactsBefore);
        expect(hostMembers().find(m => m.id === 'hm-link')?.contactEntries).toEqual([]);

        // It fits a phone: no sideways scroll with the composer open.
        await page.setViewportSize({ width: 390, height: 844 });
        await linkedCard.getByTestId('linked-add-contact').click();
        await linkedCard.getByTestId('linked-contact-type-phone').click();
        await expect(linkedCard.getByTestId('linked-contact-input')).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        await linkedCard.getByTestId('linked-contact-cancel').click();
        // On a phone (no hover) a contributor still reaches edit/remove on their own contact.
        await expect(mine.getByTestId('household-contact-edit')).toBeVisible();
        await expect(mine.getByTestId('household-contact-remove')).toBeVisible();
        const editBox = await mine.getByTestId('household-contact-edit').boundingBox();
        expect(editBox && Math.min(editBox.width, editBox.height)).toBeGreaterThanOrEqual(44);

        // And it is on the linked profile itself.
        await page.goto(`/adopter/${LINKED}`);
        await dismissCountryBanner(page);
        await expect(page.getByTestId('ce-chip').filter({ hasText: LINKED_PHONE })).toHaveCount(1, { timeout: 30_000 });
        // …where «Convive con» the host offers the same add (to the host's profile, D55) — not used here.
        await expect(page.getByTestId('lives-with-row').getByTestId('linked-add-contact')).toHaveCount(1);
        // «Convive con» is listed with the household, above «Agregar familiar».
        const livesWithBox = await page.getByTestId('lives-with-row').first().boundingBox();
        const addMemberBox = await page.getByTestId('household-add-member').boundingBox();
        expect(livesWithBox!.y).toBeLessThan(addMemberBox!.y);
    });
});
