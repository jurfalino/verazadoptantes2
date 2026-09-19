import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { dismissCountryBanner } from './helpers';

/**
 * Family text in the legacy free-text column must stay visible on the profile
 * once the structured household section replaces the old field.
 *
 * With ENABLE_HOUSEHOLD_MEMBERS on, the profile rendered only the structured
 * `household_members`, so anything in the legacy `family_members` column — every
 * record from before the flag, AND every record created since, because the
 * create form still writes free text there — disappeared from view. 16 such
 * records in production on 2026-09-19.
 */

const ID = 'test-household-legacy-fixture-1';
const NAME = 'LegacyFamilyFixture Titular';
const FAMILY = 'LegacyRelative Ondina (hermana), LegacyRelative Bruno';

function execD1(sql: string): string {
    return execSync(
        `npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
}

test.describe('legacy family text under the household section', () => {
    test.beforeAll(() => {
        execD1(
            `INSERT OR REPLACE INTO adopters (id, name, contact_info, family_members, household_members, country, status, added_by, deleted_at, created_at, updated_at) ` +
            `VALUES ('${ID}', '${NAME}', 'legacy-family-fixture-contact', '${FAMILY}', '[]', 'AR', '5', 'gatitosolivos@gmail.com', NULL, strftime('%s','now'), strftime('%s','now'))`,
        );
    });

    test.afterAll(() => {
        execD1(`DELETE FROM adopters WHERE id = '${ID}'`);
    });

    test('shows family text that has no structured members yet', async ({ page }) => {
        await page.goto(`/adopter/${ID}`);
        await dismissCountryBanner(page);
        await expect(page.getByText(NAME).first()).toBeVisible({ timeout: 30000 });
        await expect(page.getByText(/LegacyRelative Ondina/).first()).toBeVisible({ timeout: 30000 });
    });
});
