import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { dismissCountryBanner } from './helpers';

/**
 * The collaborative-vetting loop, end to end. It had never once run in
 * production: both steps that start it were fired without being awaited and the
 * worker was gone before they finished (0 notifications, 0 access requests,
 * May → 2026-09-19).
 *
 *   a non-admin adds a contact detail to someone else's record
 *     → the owner is notified
 *     → an access request is filed in the contributor's name
 *   the owner approves it
 *     → the contributor holds a grant for the record
 *
 * Runs under the admin project (the OWNER); the contributor is a second browser
 * context on the non-admin session. PII gating is switched on for this spec, as
 * it is in production (the e2e seed leaves it off).
 */

const ID = 'test-contribution-flow-fixture-1';
const NAME = 'ContributionFlow Titular';
const OWNER = 'gatitosolivos@gmail.com';
const CONTRIBUTOR = 'testuser@example.com';

function execD1(sql: string): string {
    return execSync(
        `npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
}
const rows = (sql: string) => JSON.parse(execD1(sql))[0].results as Array<Record<string, unknown>>;

function cleanup() {
    execD1(`DELETE FROM notifications WHERE url LIKE '%${ID}%'`);
    execD1(`DELETE FROM pii_access_requests WHERE adopter_id = '${ID}'`);
    execD1(`DELETE FROM pii_access_grants WHERE adopter_id = '${ID}'`);
    execD1(`DELETE FROM adopter_history WHERE adopter_id = '${ID}'`);
    execD1(`DELETE FROM adopters WHERE id = '${ID}'`);
}

test.describe('contribution → notification → access request → approval', () => {
    test.beforeAll(() => {
        cleanup();
        execD1(`INSERT OR REPLACE INTO app_config (key, value, updated_at, updated_by) VALUES ('ENABLE_PII_ACCESS_GATING', 'true', strftime('%s','now'), 'e2e')`);
        execD1(
            `INSERT INTO adopters (id, name, contact_info, contact_entries, country, status, added_by, deleted_at, created_at, updated_at) ` +
            `VALUES ('${ID}', '${NAME}', 'Tel: 11 5555-0001', '[{"id":"ce-flow-1","type":"phone","value":"11 5555-0001","addedBy":"${OWNER}"}]', 'AR', '5', '${OWNER}', NULL, strftime('%s','now'), strftime('%s','now'))`,
        );
    });

    test.afterAll(() => {
        cleanup();
        execD1(`DELETE FROM app_config WHERE key = 'ENABLE_PII_ACCESS_GATING'`);
    });

    test('adding a detail notifies the owner and files a request the owner can approve', async ({ page, browser }) => {
        // ── the contributor (non-admin) adds a phone number ──
        const contributorCtx = await browser.newContext({ storageState: '.auth/user.json' });
        const contributor = await contributorCtx.newPage();
        await contributor.goto(`/adopter/${ID}`);
        await dismissCountryBanner(contributor);
        await contributor.getByTestId('ce-add-trigger').click();
        await contributor.getByTestId('ce-type-phone').click();
        await contributor.locator('input[placeholder*="2345-6789"], input[placeholder*="+54"]').first().fill('11 4444-7777');
        await contributor.getByTestId('ce-composer-submit').click();

        // ── the owner is notified ──
        await expect.poll(() => rows(
            `SELECT user_id, type FROM notifications WHERE url LIKE '%${ID}%' AND type = 'contact_entry_added'`,
        ), { timeout: 30000 }).toEqual([{ user_id: OWNER, type: 'contact_entry_added' }]);

        // ── a request is filed in the contributor's name ──
        await expect.poll(() => rows(
            `SELECT requester_email, status, justification FROM pii_access_requests WHERE adopter_id = '${ID}'`,
        ), { timeout: 30000 }).toEqual([{ requester_email: CONTRIBUTOR, status: 'pending', justification: 'auto:contribution' }]);
        await contributorCtx.close();

        // ── the owner sees it on the profile and approves ──
        await page.goto(`/adopter/${ID}`);
        await dismissCountryBanner(page);
        await page.getByRole('button', { name: /^(Aprobar|Approve)$/ }).first().click();

        await expect.poll(() => rows(
            `SELECT status FROM pii_access_requests WHERE adopter_id = '${ID}'`,
        ), { timeout: 30000 }).toEqual([{ status: 'approved' }]);
        // The contributor now holds a record-wide grant, beyond the one entry they typed.
        await expect.poll(async () => rows(
            `SELECT scope FROM pii_access_grants WHERE adopter_id = '${ID}' AND grantee_email = '${CONTRIBUTOR}' AND revoked_at IS NULL AND origin <> 'contribution'`,
        ).length, { timeout: 30000 }).toBeGreaterThan(0);
    });
});
