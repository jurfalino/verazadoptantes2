import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'child_process';
import { dismissCountryBanner } from './helpers';
import { phoneIndexTokens } from '../src/domain/phoneNumber';

/**
 * Phone and DNI search (2.56.155). A rescuer types a number in whatever format
 * they have it; the record must come up in the MAIN list, and never on a
 * country/area code alone or on digits that are not a phone.
 *
 * Production case: "+54 9 11 6585 1333" found nothing for a record saved as
 * "1165851333" (two rescuers, 0 results).
 *
 * Dedicated fixture rows; their index rows are built with the same rules the
 * app uses (phoneIndexTokens), so this does not depend on the admin rescan.
 */
const OWNER = 'gatitosolivos@gmail.com'; // the e2e admin — owner bypass of the country filter
const FULL = 'test-phonesearch-fixture-full';   // saved as "11 4455-6677"
const LOCAL = 'test-phonesearch-fixture-local'; // saved as "5566-7788" (no area code)
const DNI = 'test-phonesearch-fixture-dni';     // DNI 27.111.222, no phone
const FB = 'test-phonesearch-fixture-fb';       // only a Facebook profile link

function execD1(sql: string): string {
    return execSync(
        `npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
}
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

function insertAdopter(id: string, name: string, entries: Array<{ type: string; value: string }>, tokens: Array<{ type: string; value: string }>) {
    const blob = entries.map(e => e.value).join('\n');
    execD1(
        `INSERT INTO adopters (id, name, contact_info, contact_entries, added_by, country) VALUES ` +
        `(${q(id)}, ${q(name)}, ${q(blob)}, ${q(JSON.stringify(entries))}, ${q(OWNER)}, 'AR')`,
    );
    if (tokens.length) {
        execD1(
            `INSERT INTO duplicate_tokens (id, adopter_id, token_type, token_value) VALUES ` +
            tokens.map((t, i) => `(${q(`${id}-t${i}`)}, ${q(id)}, ${q(t.type)}, ${q(t.value)})`).join(', '),
        );
    }
}

function cleanup() {
    for (const id of [FULL, LOCAL, DNI, FB]) {
        execD1(`DELETE FROM duplicate_tokens WHERE adopter_id=${q(id)}`);
        execD1(`DELETE FROM adopters WHERE id=${q(id)}`);
    }
}

async function search(page: Page, text: string) {
    await page.goto('/');
    await dismissCountryBanner(page);
    const box = page.locator('input#search');
    await box.fill(text);
    await box.press('Enter');
    // Wait for the search to settle: a result list or the empty state.
    await page.locator('[data-walkthrough="results"]').waitFor({ state: 'attached', timeout: 60000 });
}
const mainCard = (page: Page, id: string) => page.locator(`[data-walkthrough="results"] > a[href^="/adopter/${id}"]`);
const anyCard = (page: Page, id: string) => page.locator(`[data-walkthrough="results"] a[href^="/adopter/${id}"]`);

test.describe('phone and DNI search', () => {
    test.beforeAll(() => {
        cleanup();
        insertAdopter(FULL, 'Fixture Telefono Completo', [{ type: 'phone', value: '11 4455-6677' }], phoneIndexTokens('11 4455-6677', 'AR'));
        insertAdopter(LOCAL, 'Fixture Telefono Local', [{ type: 'phone', value: '5566-7788' }], phoneIndexTokens('5566-7788', 'AR'));
        insertAdopter(DNI, 'Fixture Documento', [{ type: 'id', value: '27.111.222' }], [{ type: 'id_number', value: '27111222' }]);
        insertAdopter(FB, 'Fixture Facebook', [{ type: 'social', value: 'https://www.facebook.com/profile.php?id=1300000006' }],
            [{ type: 'social_handle', value: 'id:1300000006' }, { type: 'social', value: 'facebook|id:1300000006' }]);
    });
    test.afterAll(cleanup);

    for (const typed of ['+54 11 4455 6677', '+54 9 11 4455-6677', '011 15 4455-6677', '11 4455 6677', '1144556677', '4455 6677']) {
        test(`"${typed}" finds the number in the main list`, async ({ page }) => {
            await search(page, typed);
            await expect(mainCard(page, FULL)).toBeVisible({ timeout: 30000 });
        });
    }

    test('a full search finds a number saved without its area code', async ({ page }) => {
        await search(page, '+54 9 11 5566-7788');
        await expect(mainCard(page, LOCAL)).toBeVisible({ timeout: 30000 });
    });

    test('a 7-digit partial is only an approximate match', async ({ page }) => {
        await search(page, '455-6677');
        await expect(anyCard(page, FULL)).toBeAttached({ timeout: 30000 });
        await expect(mainCard(page, FULL)).toHaveCount(0);
    });

    test('another city whose number shares the ending does not match', async ({ page }) => {
        // Córdoba 351 455-6677 ends like 11 4455-6677; it is a different number.
        await search(page, '351 455-6677');
        await expect(mainCard(page, FULL)).toHaveCount(0);
    });

    test('country and area code alone match nothing', async ({ page }) => {
        await search(page, '+54 11 44');
        await expect(anyCard(page, FULL)).toHaveCount(0);
    });

    test('a DNI is found in any format', async ({ page }) => {
        for (const typed of ['27.111.222', '27111222']) {
            await search(page, typed);
            await expect(mainCard(page, DNI)).toBeVisible({ timeout: 30000 });
        }
    });

    test('a Facebook profile id is not a phone', async ({ page }) => {
        await search(page, '1300000006');
        await expect(mainCard(page, FB)).toHaveCount(0);
    });
});
