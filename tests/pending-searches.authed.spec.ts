import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'child_process';
import { dismissCountryBanner } from './helpers';

/**
 * ENABLE_PENDING_SEARCHES: the homepage asks what came of the searches that
 * never became a record. Searches that refine one another ("Maria" →
 * "Maria Garcia") are one ask, carried by the most complete search.
 *
 * Flag is off in the seed; this spec turns it on for itself and back off after.
 * Phone-sized viewport, because that is where rescuers search.
 *
 * Public flags are cached in-process for 30s (`src/lib/publicConfig.ts`), so a
 * flip is not visible to the page straight away. Every test waits for
 * /api/config to report the value it needs before asserting on the UI —
 * otherwise this spec fails on cache timing rather than on behaviour.
 */

const ADMIN = 'gatitosolivos@gmail.com';
const ADOPTER = 'test-adopter-1';
/** The adopter the two "Maria" searches resolve to, and the unmatched search. */
const KNOWN = 'María García López';
const UNKNOWN = 'Fulano Inexistente 11-5556666';

function execD1(sql: string): string {
    return execSync(
        `npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
}

/** Wait until the server's flag cache agrees with what the test just set. */
async function waitForFlag(page: Page, expected: boolean) {
    await expect.poll(async () => {
        const res = await page.request.get('/api/config');
        const body = await res.json().catch(() => ({}));
        return body?.config?.ENABLE_PENDING_SEARCHES;
    }, { timeout: 60000, intervals: [500, 1000, 2000, 5000] }).toBe(expected ? 'true' : 'false');
}

function openAsks(): number {
    const out = execD1(`SELECT COUNT(*) AS n FROM pending_searches WHERE user_email = '${ADMIN}' AND resolved_at IS NULL`);
    return JSON.parse(out)[0].results[0].n as number;
}

function seedAsks() {
    execD1(`DELETE FROM pending_searches WHERE user_email = '${ADMIN}'`);
    const now = Math.floor(Date.now() / 1000);
    const rows = [
        `('ps-test-1','${ADMIN}','Maria','${ADOPTER}',${now - 600})`,
        `('ps-test-2','${ADMIN}','Maria Garcia','${ADOPTER}',${now - 540})`,
        `('ps-test-3','${ADMIN}','Fulano Inexistente 11-5556666',NULL,${now - 300})`,
    ].join(',');
    execD1(`INSERT INTO pending_searches (id, user_email, query, adopter_id, created_at) VALUES ${rows}`);
}

test.describe('pending searches deck', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test.beforeAll(() => {
        execD1(`INSERT OR REPLACE INTO app_config (key, value, updated_at, updated_by) VALUES ('ENABLE_PENDING_SEARCHES','true',strftime('%s','now'),'e2e')`);
    });

    test.afterAll(() => {
        execD1(`DELETE FROM app_config WHERE key = 'ENABLE_PENDING_SEARCHES'`);
        execD1(`DELETE FROM pending_searches WHERE user_email = '${ADMIN}'`);
    });

    test.beforeEach(() => seedAsks());

    test('asks once per person, naming the adopter the searches found', async ({ page }) => {
        await waitForFlag(page, true);
        await page.goto('/');
        await dismissCountryBanner(page);

        const deck = page.getByTestId('pending-searches-deck');
        await expect(deck).toBeVisible({ timeout: 30000 });

        // Three searches, two people: the Maria pair is one ask.
        await expect(deck.locator('article')).toHaveCount(2);
        await expect(deck).toContainText(KNOWN);
        await expect(deck).toContainText(UNKNOWN);
    });

    test('dismissing an ask closes every search behind it, for good', async ({ page }) => {
        await waitForFlag(page, true);
        await page.goto('/');
        await dismissCountryBanner(page);
        const deck = page.getByTestId('pending-searches-deck');
        await expect(deck).toBeVisible({ timeout: 30000 });

        // The Maria card stands for two searches; dismissing it must close both.
        await deck.locator('article').filter({ hasText: KNOWN }).getByTestId('pending-ask-dismiss').click();
        await expect(deck.locator('article')).toHaveCount(1);
        await expect.poll(() => openAsks(), { timeout: 10000 }).toBe(1);

        await page.reload();
        await dismissCountryBanner(page);
        await expect(page.getByTestId('pending-searches-deck').locator('article')).toHaveCount(1);
    });

    test('answering records the activity and retires the ask', async ({ page }) => {
        await waitForFlag(page, true);
        await page.goto('/');
        await dismissCountryBanner(page);
        const deck = page.getByTestId('pending-searches-deck');
        await expect(deck).toBeVisible({ timeout: 30000 });

        const before = JSON.parse(execD1(
            `SELECT COUNT(*) AS n FROM adopter_events WHERE adopter_id = '${ADOPTER}' AND event_type = 'adoption_request'`,
        ))[0].results[0].n as number;

        await deck.locator('article').filter({ hasText: KNOWN }).getByTestId('pending-ask-request').click();
        await expect(deck.locator('article')).toHaveCount(1);

        await expect.poll(() => JSON.parse(execD1(
            `SELECT COUNT(*) AS n FROM adopter_events WHERE adopter_id = '${ADOPTER}' AND event_type = 'adoption_request'`,
        ))[0].results[0].n as number, { timeout: 10000 }).toBe(before + 1);

        await expect.poll(() => openAsks(), { timeout: 10000 }).toBe(1);
    });

    test('an unmatched search sends the rescuer to create that person', async ({ page }) => {
        await waitForFlag(page, true);
        await page.goto('/');
        await dismissCountryBanner(page);
        const deck = page.getByTestId('pending-searches-deck');
        await expect(deck).toBeVisible({ timeout: 30000 });

        await deck.locator('article').filter({ hasText: UNKNOWN }).getByTestId('pending-ask-request').click();

        // The create form opens carrying the search and the answer.
        await page.waitForURL(/\/adopter\/create\?/, { timeout: 30000 });
        const url = new URL(page.url());
        expect(url.searchParams.get('continueToAdoption')).toBe('true');
        expect(url.searchParams.get('newAdoption')).toBe('adoption_request');
        expect(url.searchParams.get('name')).toContain('Fulano');
    });

    test('stays hidden while the flag is off', async ({ page }) => {
        execD1(`UPDATE app_config SET value = 'false' WHERE key = 'ENABLE_PENDING_SEARCHES'`);
        try {
            await waitForFlag(page, false);
            await page.goto('/');
            await dismissCountryBanner(page);
            await expect(page.getByTestId('pending-searches-deck')).toHaveCount(0);
        } finally {
            execD1(`UPDATE app_config SET value = 'true' WHERE key = 'ENABLE_PENDING_SEARCHES'`);
        }
    });
});
