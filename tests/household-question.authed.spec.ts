import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { dismissCountryBanner } from './helpers';

/**
 * "¿Hay niños?" vs "Personas del hogar" (spec 2026-10-04 §2): the choice is a
 * 'household' token in adoption_doc_settings.hidden_steps, made on the
 * children row in Ajustes → Formulario y contrato, and the public form config
 * follows it. Runs under `authed` (gatitosolivos@gmail.com, own settings row);
 * ENABLE_CUSTOM_ADOPTION_DOCS is 'true' in tests/seed.sql.
 */

const OWNER = "owner_type = 'user' AND owner_id = 'gatitosolivos@gmail.com'";

function execD1(sql: string): string {
    return execSync(`npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`,
        { cwd: process.cwd(), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

/** The stored hidden_steps value, raw (null when the row has none). Throws on a failed query. */
function storedRaw(): string | null {
    const r = JSON.parse(execD1(`SELECT hidden_steps FROM adoption_doc_settings WHERE ${OWNER}`));
    const results = (Array.isArray(r) ? r[0] : r)?.results;
    if (!Array.isArray(results)) throw new Error('settings query returned no result set');
    const v = results[0]?.hidden_steps;
    return v === undefined || v === null || v === 'null' ? null : String(v);
}
const stored = (): string[] => JSON.parse(storedRaw() ?? '[]');

test.describe('household question choice', () => {
    let before: string | null = null;
    test.beforeAll(() => {
        execD1(`INSERT OR IGNORE INTO adoption_doc_settings (id, owner_type, owner_id, hidden_steps, updated_at, updated_by) VALUES ('test-household-settings', 'user', 'gatitosolivos@gmail.com', NULL, strftime('%s','now'), 'test-seed')`);
        before = storedRaw();
    });
    test.afterAll(() => {
        execD1(`UPDATE adoption_doc_settings SET hidden_steps = ${before ? `'${before}'` : 'NULL'} WHERE ${OWNER}`);
    });

    test('default asks "¿Hay niños?"; choosing the people list switches the public form; one switch hides either', async ({ page, request }) => {
        execD1(`UPDATE adoption_doc_settings SET hidden_steps = NULL WHERE ${OWNER}`);
        const cfg0 = await (await request.get('/api/form/test-admin-id')).json();
        expect(cfg0.formConfig?.hiddenSteps ?? []).not.toContain('household');

        await page.goto('/settings/adoption-docs');
        await dismissCountryBanner(page);
        await expect(page.getByTestId('household-choice-children')).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 });
        // The seeded admin's T&C modal can open after load and cover the page.
        await dismissCountryBanner(page);

        await page.getByTestId('household-choice-people').click();
        await expect(page.getByTestId('household-choice-people')).toHaveAttribute('aria-checked', 'true');
        await page.getByTestId('adoption-docs-save-form').click();
        await expect.poll(stored, { timeout: 15_000 }).toContain('household');

        const cfg1 = await (await request.get('/api/form/test-admin-id')).json();
        expect(cfg1.formConfig.hiddenSteps).toContain('household');

        // One switch for the row: off hides the household question, the choice is kept.
        await page.getByTestId('form-step-children').click();
        await page.getByTestId('adoption-docs-save-form').click();
        await expect.poll(stored, { timeout: 15_000 }).toEqual(expect.arrayContaining(['children', 'household']));
    });
});
