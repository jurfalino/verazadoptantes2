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

/**
 * Reload the homepage until the deck matches what the flag was just set to.
 * The page reads the flags server-side in its own edge isolate, with its own
 * 30s cache, so /api/config agreeing proves nothing about what the page renders.
 */
async function expectDeck(page: Page, shown: boolean) {
    await expect.poll(async () => {
        await page.goto('/');
        await dismissCountryBanner(page);
        return await page.getByTestId('pending-searches-deck').count();
    }, { timeout: 60000, intervals: [1000, 2000, 5000, 5000] }).toBe(shown ? 1 : 0);
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
        // The broad search matched one adopter; the complete one matched them too.
        `('ps-test-1','${ADMIN}','Maria',NULL,NULL,${now - 600})`,
        `('ps-test-2','${ADMIN}','Maria Garcia','${ADOPTER}',96,${now - 540})`,
        // Matched nobody: this ask must never name or open a profile.
        `('ps-test-3','${ADMIN}','Fulano Inexistente 11-5556666',NULL,NULL,${now - 300})`,
    ].join(',');
    execD1(`INSERT INTO pending_searches (id, user_email, query, adopter_id, match_confidence, created_at) VALUES ${rows}`);
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

    test('titles every ask with what the rescuer typed', async ({ page }) => {
        await waitForFlag(page, true);
        await page.goto('/');
        await dismissCountryBanner(page);

        const deck = page.getByTestId('pending-searches-deck');
        await expect(deck).toBeVisible({ timeout: 30000 });

        // Three searches, two people: the Maria pair is one ask.
        await expect(deck.locator('article')).toHaveCount(2);
        // Titled by the query; the matched person is a secondary line.
        await expect(deck).toContainText('Maria Garcia');
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

    test('answering opens that person instead of writing a record', async ({ page }) => {
        await waitForFlag(page, true);
        await page.goto('/');
        await dismissCountryBanner(page);
        const deck = page.getByTestId('pending-searches-deck');
        await expect(deck).toBeVisible({ timeout: 30000 });

        const countRecords = () => JSON.parse(execD1(
            `SELECT COUNT(*) AS n FROM adopter_events WHERE adopter_id = '${ADOPTER}' AND event_type = 'adoption_request'`,
        ))[0].results[0].n as number;
        const before = countRecords();

        await deck.locator('article').filter({ hasText: KNOWN }).getByTestId('pending-ask-request').click();

        // It carries the rescuer to the profile with the reason chosen. Nothing
        // is written until they save it there, with the person on screen.
        await page.waitForURL(new RegExp(`/adopter/${ADOPTER}\\?newAdoption=adoption_request`), { timeout: 30000 });
        await expect(page.getByText(KNOWN).first()).toBeVisible({ timeout: 30000 });
        expect(countRecords()).toBe(before);
        expect(openAsks()).toBe(3);
    });

    test('an ask nobody matched never names a person or opens one', async ({ page }) => {
        await waitForFlag(page, true);
        await page.goto('/');
        await dismissCountryBanner(page);
        const deck = page.getByTestId('pending-searches-deck');
        await expect(deck).toBeVisible({ timeout: 30000 });

        // The v2.56.82 defect: this ask borrowed the adopter a broader search in
        // its group had matched, and wrote a record against them.
        const unknown = deck.locator('article').filter({ hasText: UNKNOWN });
        await expect(unknown).toHaveAttribute('data-testid', 'pending-ask-unknown');
        await expect(unknown).not.toContainText(KNOWN);
        await expect(unknown.getByTestId('pending-ask-request')).toHaveCount(0);

        await unknown.getByTestId('pending-ask-search-again').click();
        await page.waitForURL(/\/\?q=/, { timeout: 30000 });
    });

    test('stays hidden while the flag is off', async ({ page }) => {
        execD1(`UPDATE app_config SET value = 'false' WHERE key = 'ENABLE_PENDING_SEARCHES'`);
        try {
            await waitForFlag(page, false);
            await expectDeck(page, false);
        } finally {
            execD1(`UPDATE app_config SET value = 'true' WHERE key = 'ENABLE_PENDING_SEARCHES'`);
        }
    });
});
