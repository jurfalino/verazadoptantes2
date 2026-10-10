import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { dismissCountryBanner } from './helpers';

/**
 * Editing an existing phone on someone's profile and pressing Guardar must
 * persist the new number. Production 2026-10-10: an admin changed a phone four
 * times, every save came back "ok", the number never changed.
 * Shape mirrors the production row: legacy-style ids, gating on, owner = admin.
 */
const ID = 'test-contact-edit-fixture-1';
const OWNER = 'gatitosolivos@gmail.com';

function execD1(sql: string): string {
    return execSync(
        `npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
}
const rows = (sql: string) => JSON.parse(execD1(sql))[0].results as Array<Record<string, unknown>>;

const ENTRIES = JSON.stringify([
    { id: 'legacy-392d646f-ab375739', type: 'phone', value: '4864-0000', addedBy: OWNER },
    { id: 'legacy-ba853e0e-b3e4fbf5', type: 'phone', value: '156-1010000', addedBy: OWNER },
    { id: 'legacy-6132408c-1009c08c', type: 'phone', value: '1164720000', addedBy: OWNER },
]).replace(/'/g, "''");

test.describe('edit an existing contact entry', () => {
    test.beforeAll(() => {
        execD1(`DELETE FROM adopter_history WHERE adopter_id = '${ID}'`);
        execD1(`DELETE FROM adopters WHERE id = '${ID}'`);
        execD1(`INSERT OR REPLACE INTO app_config (key, value, updated_at, updated_by) VALUES ('ENABLE_PII_ACCESS_GATING', 'true', strftime('%s','now'), 'e2e')`);
        execD1(
            `INSERT INTO adopters (id, name, contact_info, contact_entries, country, status, added_by, is_public, deleted_at, created_at, updated_at) ` +
            `VALUES ('${ID}', 'ContactEdit Titular', 'Tel: 4864-0000, 156-1010000, 1164720000', '${ENTRIES}', 'AR', '5', '${OWNER}', 0, NULL, strftime('%s','now'), strftime('%s','now'))`,
        );
    });
    test.afterAll(() => {
        execD1(`DELETE FROM adopter_history WHERE adopter_id = '${ID}'`);
        execD1(`DELETE FROM adopters WHERE id = '${ID}'`);
        execD1(`DELETE FROM app_config WHERE key = 'ENABLE_PII_ACCESS_GATING'`);
    });

    for (const [label, next] of [['a new number', '1199998888'], ['a reformat of the same digits', '15 6101-0000']] as const)
    test(`changing a phone to ${label} and pressing Guardar saves it`, async ({ page }) => {
        execD1(`UPDATE adopters SET contact_entries = '${ENTRIES}' WHERE id = '${ID}'`);
        await page.goto(`/adopter/${ID}`);
        await dismissCountryBanner(page);
        const chip = page.getByTestId('ce-chip').nth(1);
        await expect(chip).toContainText('156-1010000');
        await chip.hover();
        await chip.getByTestId('ce-edit-btn').click();
        const input = chip.locator('input[type="text"]');
        await expect(input).toHaveValue('156-1010000');
        await input.fill(next);
        await chip.getByTestId('ce-edit-save').click();

        // A busy local DB mid-write is not an answer — poll again.
        const stored = () => { try { return String(rows(`SELECT contact_entries FROM adopters WHERE id = '${ID}'`)[0].contact_entries); } catch { return ''; } };
        await expect.poll(stored,
            { timeout: 15000 }).toContain(`"${next}"`);
        await page.reload();
        await expect(page.getByText(next, { exact: true })).toBeVisible();
    });
});
