import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { dismissCountryBanner } from './helpers';

/**
 * Admin → Calidad de datos → «Datos compartidos»: a phone on two live profiles
 * is listed (those are who an exact API call can answer "ambiguous" for); a
 * deleted profile doesn't count. Dedicated fixture rows, removed afterwards.
 */
function execD1(sql: string): string {
    return execSync(`npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
const IDS = ['test-shared-fixture-1', 'test-shared-fixture-2', 'test-shared-fixture-3'];
const PHONE = '5491100009977';

test.describe('data quality: shared identifiers', () => {
    test.beforeAll(() => {
        execD1(`INSERT OR REPLACE INTO adopters (id, name, added_by, created_at, updated_at) VALUES
            ('${IDS[0]}', 'Compartidofixture Uno', 'gatitosolivos@gmail.com', strftime('%s','now'), strftime('%s','now')),
            ('${IDS[1]}', 'Compartidofixture Uno Segundo', 'gatitosolivos@gmail.com', strftime('%s','now'), strftime('%s','now')),
            ('${IDS[2]}', 'Borradofixture Tres', 'gatitosolivos@gmail.com', strftime('%s','now'), strftime('%s','now'))`);
        execD1(`UPDATE adopters SET deleted_at = strftime('%s','now') WHERE id = '${IDS[2]}'`);
        execD1(`INSERT OR REPLACE INTO duplicate_tokens (id, adopter_id, token_type, token_value) VALUES
            ('test-shared-tok-1', '${IDS[0]}', 'phone', '${PHONE}'),
            ('test-shared-tok-2', '${IDS[1]}', 'phone', '${PHONE}'),
            ('test-shared-tok-3', '${IDS[2]}', 'phone', '${PHONE}')`);
    });
    test.afterAll(() => {
        execD1(`DELETE FROM duplicate_tokens WHERE id LIKE 'test-shared-tok-%'`);
        execD1(`DELETE FROM adopters WHERE id LIKE 'test-shared-fixture-%'`);
    });

    test('a phone on two live profiles is listed once, as a likely duplicate, with links', async ({ page }) => {
        await page.goto('/admin/data-quality');
        await dismissCountryBanner(page);
        await page.getByRole('button', { name: /Datos compartidos/ }).click();
        const group = page.getByTestId('shared-identifier').filter({ hasText: PHONE });
        await expect(group).toHaveCount(1, { timeout: 30000 });
        await expect(group).toContainText('Mismo nombre');
        await expect(group).toContainText('2 perfiles');
        await expect(group.getByRole('link', { name: 'Compartidofixture Uno', exact: true })).toHaveAttribute('href', `/adopter/${IDS[0]}`);
        await expect(group).not.toContainText('Borradofixture');
    });
});
