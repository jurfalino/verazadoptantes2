import { test, expect, type Page, type Browser } from '@playwright/test';
import { execSync } from 'child_process';
import { dismissCountryBanner } from './helpers';

/**
 * Two teammates editing their group's contract at the same time
 * (/settings/adoption-docs?org=…#contrato). Each save carries only the
 * sections that editor changed: different sections both land and the other
 * editor's text shows up «Actualizada por …»; the same section is refused
 * with a conflict banner until the editor chooses — here «Guardar la mía igual».
 *
 * Admin = Ana (the page fixture), test user = Beto (second context); both in
 * a fixture org. ENABLE_CUSTOM_ADOPTION_DOCS is on in the seed.
 *
 * The org is removed again at the end: left behind, it would make the admin
 * and the test user teammates for every later spec (e.g. the PII masking
 * specs, which rely on them being strangers).
 */

const ADMIN_EMAIL = 'gatitosolivos@gmail.com';
const USER_EMAIL = 'testuser@example.com';

function execD1(sql: string): string {
    return execSync(
        `npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`,
        { cwd: process.cwd(), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
}
function one(sql: string): Record<string, unknown> {
    const w = JSON.parse(execD1(sql));
    return ((Array.isArray(w) ? w[0] : w)?.results ?? [])[0] ?? {};
}

async function openContract(page: Page, orgId: string) {
    await page.goto(`/settings/adoption-docs?org=${orgId}#contrato`);
    await dismissCountryBanner(page);
    await expect(page.getByTestId('contract-section-2')).toBeVisible({ timeout: 30_000 });
}

async function typeInto(page: Page, key: '2' | '3' | '4', text: string) {
    const editor = page.getByTestId(`contract-section-${key}`).locator('[contenteditable="true"]').first();
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(` ${text}`);
}

test('two teammates: different sections both land; the same section asks before overwriting', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const stamp = Date.now();
    const orgId = `test-docs-collab-org-${stamp}`;
    execD1(`INSERT INTO organizations (id, name, created_by) VALUES ('${orgId}', 'Collab ${stamp}', '${ADMIN_EMAIL}')`);
    execD1(`INSERT INTO org_members (id, org_id, user_email, role) VALUES ('${orgId}-a', '${orgId}', '${ADMIN_EMAIL}', 'owner'), ('${orgId}-b', '${orgId}', '${USER_EMAIL}', 'member')`);
    try {
        await runScenario(page, browser, orgId, stamp);
    } finally {
        execD1(`DELETE FROM org_members WHERE org_id = '${orgId}'`);
        execD1(`DELETE FROM organizations WHERE id = '${orgId}'`);
    }
});

async function runScenario(page: Page, browser: Browser, orgId: string, stamp: number) {
    const betoCtx = await browser.newContext({ storageState: '.auth/user.json' });
    const beto = await betoCtx.newPage();
    await openContract(page, orgId);
    await openContract(beto, orgId);

    // The language note appears only once a section differs from the standard text.
    await expect(page.getByTestId('contract-section-2-language-note')).toHaveCount(0);
    // Ana changes section 2, Beto section 3 — both from the same starting point.
    await typeInto(page, '2', `ANA-${stamp}`);
    await expect(page.getByTestId('contract-section-2-language-note')).toBeVisible();
    await page.getByTestId('adoption-docs-save-contract').click();
    await expect(page.getByText(/Section 2 saved|Guardamos la sección 2/).first()).toBeVisible({ timeout: 30_000 });

    await typeInto(beto, '3', `BETO-${stamp}`);
    await beto.getByTestId('adoption-docs-save-contract').click();
    await expect(beto.getByText(/Section 3 saved|Guardamos la sección 3/).first()).toBeVisible({ timeout: 30_000 });
    await expect(beto.getByTestId('contract-section-2-updated-by')).toBeVisible();
    await expect(beto.getByTestId('contract-section-2')).toContainText(`ANA-${stamp}`);

    // Same section: Ana saves 4 first; Beto's save of 4 is refused, not written.
    await typeInto(page, '4', `ANA4-${stamp}`);
    await page.getByTestId('adoption-docs-save-contract').click();
    await expect(page.getByText(/Section 4 saved|Guardamos la sección 4/).first()).toBeVisible({ timeout: 30_000 });
    await typeInto(beto, '4', `BETO4-${stamp}`);
    await beto.getByTestId('adoption-docs-save-contract').click();
    await expect(beto.getByTestId('contract-section-4-conflict')).toBeVisible({ timeout: 30_000 });

    const sectionsNow = () => JSON.parse(String(one(`SELECT v.sections_json AS s FROM adoption_doc_settings st JOIN contract_versions v ON v.id = st.contract_version_id WHERE st.owner_id = '${orgId}'`).s ?? '{}'));
    expect(JSON.stringify(sectionsNow()['4'])).toContain(`ANA4-${stamp}`);

    // «Ver su versión» shows Ana's text side by side; «Guardar la mía igual» overwrites only section 4.
    await beto.getByTestId('contract-section-4-view-theirs').click();
    await expect(beto.getByTestId('contract-section-4-theirs')).toContainText(`ANA4-${stamp}`);
    await beto.getByTestId('contract-section-4-save-this').click();
    await expect(beto.getByTestId('contract-section-4-conflict')).toHaveCount(0, { timeout: 30_000 });

    const final = sectionsNow();
    expect(JSON.stringify(final['2'])).toContain(`ANA-${stamp}`);
    expect(JSON.stringify(final['3'])).toContain(`BETO-${stamp}`);
    expect(JSON.stringify(final['4'])).toContain(`BETO4-${stamp}`);
    await betoCtx.close();
}
