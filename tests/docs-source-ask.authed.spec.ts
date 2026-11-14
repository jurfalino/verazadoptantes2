import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execD1Batch, rows } from './db';

/**
 * «Al cambiar de grupos» (spec docs/superpowers/specs/2026-11-13-group-branding-design.md):
 * joining a second group asks «¿Qué formulario y contrato usás al compartir?» instead of
 * silently switching her shared links. Both ENABLE_GROUP_BRANDING and
 * ENABLE_CUSTOM_ADOPTION_DOCS are ON in the seed.
 *
 * Acts as the seeded test-user-fixture-brand-solo (only member of test-org-fixture-brand,
 * source NULL → that group by default) with her own signed session, joining a group this
 * file creates (test-org-fixture-brand-ask) through its invite link — the real path.
 * Runs in the `authed` project only for its single run; the admin session is not used.
 *
 * group-branding.unauthed.spec.ts needs brand-solo exactly as seeded (sole member, NULL),
 * so every test starts from — and the file ends with — that state.
 * Selectors are locale-agnostic (testids / values).
 */
const SOLO = { id: 'test-user-fixture-brand-solo', email: 'e2e-brand-solo@example.com', name: 'Marca Solo E2E' };
const FIRST = 'test-org-fixture-brand';
const ASK_ORG = 'test-org-fixture-brand-ask';
const INVITE = 'test-invite-fixture-brand-ask';
const OWNER = 'e2e-brand-ask-owner@example.com';

const RESET = [
    `DELETE FROM org_members WHERE org_id = '${ASK_ORG}' AND lower(user_email) = '${SOLO.email}'`,
    `INSERT OR REPLACE INTO org_members (id, org_id, user_email, role, joined_at) VALUES ('test-orgm-fixture-brand-1', '${FIRST}', '${SOLO.email}', 'owner', strftime('%s','now'))`,
    `UPDATE user_profiles SET adoption_docs_source = NULL WHERE user_id = '${SOLO.id}'`,
];
const SETUP = [
    `INSERT OR REPLACE INTO organizations (id, name, created_by, created_at, slug) VALUES ('${ASK_ORG}', 'Refugio Pregunta E2E', '${OWNER}', strftime('%s','now'), 'refugio-pregunta-e2e')`,
    `INSERT OR REPLACE INTO org_members (id, org_id, user_email, role, joined_at) VALUES ('test-orgm-fixture-brand-ask-o', '${ASK_ORG}', '${OWNER}', 'owner', strftime('%s','now'))`,
    `INSERT OR REPLACE INTO org_invites (id, org_id, created_by) VALUES ('${INVITE}', '${ASK_ORG}', '${OWNER}')`,
];
const TEARDOWN = [
    `DELETE FROM org_invites WHERE org_id = '${ASK_ORG}'`,
    `DELETE FROM org_members WHERE org_id = '${ASK_ORG}'`,
    `DELETE FROM organizations WHERE id = '${ASK_ORG}'`,
];

test.describe.configure({ mode: 'serial' });
test.beforeAll(() => { execD1Batch([...TEARDOWN, ...RESET, ...SETUP]); });
test.beforeEach(() => { execD1Batch(RESET); });
test.afterAll(() => { execD1Batch([...RESET, ...TEARDOWN]); });

/** brand-solo's own signed session, built like tests/auth.setup.ts. */
async function soloContext(browser: Browser): Promise<BrowserContext> {
    const secret = process.env.AUTH_SECRET;
    if (!secret) throw new Error('AUTH_SECRET is required to sign the brand-solo session (see .env.local).');
    const { encode } = await import('next-auth/jwt');
    const token = await encode({
        secret,
        token: { email: SOLO.email, name: SOLO.name, sub: SOLO.id, sessionVersion: 3 },
        salt: 'authjs.session-token',
    });
    const baseURL = test.info().project.use.baseURL as string;
    const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    await context.addCookies([{ name: 'authjs.session-token', value: token, domain: new URL(baseURL).hostname, path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await context.addInitScript((email: string) => {
        try {
            localStorage.setItem(`country_confirmed_${email}`, '1');
            localStorage.setItem('playwright_test_mode', '1');
        } catch { /* storage unavailable — the banner may show; the test anchors on the dialog */ }
    }, SOLO.email);
    return context;
}

const storedSource = () => rows(`SELECT adoption_docs_source AS s FROM user_profiles WHERE user_id = '${SOLO.id}'`)[0]?.s;

/** Open the invite link: auto-joins, lands on /organizations and asks. */
async function joinAskGroup(page: Page) {
    await page.goto(`/invite/${INVITE}`);
    await expect(page).toHaveURL(/\/organizations/, { timeout: 60000 });
    const dialog = page.getByTestId('docs-source-dialog');
    await expect(dialog).toBeVisible({ timeout: 30000 });
    // Asked once: the param that carried the ask is gone from the address.
    await expect(page).not.toHaveURL(/askSource/);
    return dialog;
}

async function publicFormBranding(page: Page) {
    const res = await page.request.get(`/api/form/${SOLO.id}`);
    expect(res.status()).toBe(200);
    return (await res.json()).branding as { orgSlug?: string } | null;
}

test.describe('Joining a second group asks which form and contract her links use', () => {
    test('the first group is pre-selected and marked; «Listo» keeps it (stored, audited, public form unchanged); fits 390', async ({ browser }) => {
        const context = await soloContext(browser);
        const page = await context.newPage();
        await page.setViewportSize({ width: 390, height: 844 });
        const dialog = await joinAskGroup(page);

        // Both groups (each with its thumb) + «Los míos»; the one in use pre-selected and marked.
        await expect(dialog.locator(`input[value="org:${FIRST}"]`)).toBeChecked();
        await expect(dialog.locator(`input[value="org:${ASK_ORG}"]`)).not.toBeChecked();
        await expect(dialog.locator('input[value="self"]')).not.toBeChecked();
        await expect(dialog.getByTestId(`adoption-docs-in-use-org:${FIRST}`)).toBeVisible();
        await expect(dialog.locator('[data-testid^="adoption-docs-in-use-"]')).toHaveCount(1);
        await expect(dialog.getByTestId(`adoption-docs-thumb-org:${FIRST}`)).toBeVisible();
        await expect(dialog.getByTestId(`adoption-docs-thumb-org:${ASK_ORG}`)).toBeVisible();
        await expect(dialog.getByTestId('docs-source-dialog-hint')).toBeVisible();

        // 390 px: no horizontal scroll, the buttons are ≥ 44 px.
        const m = await page.evaluate(() => {
            const el = document.querySelector('[data-testid="docs-source-dialog"]') as HTMLElement;
            const de = document.documentElement;
            return { docScroll: de.scrollWidth, docClient: de.clientWidth, dlgScroll: el.scrollWidth, dlgClient: el.clientWidth };
        });
        console.log(`docs-source dialog overflow @390: ${JSON.stringify(m)}`);
        expect(m.docScroll).toBe(m.docClient);
        expect(m.dlgScroll).toBe(m.dlgClient);
        for (const id of ['docs-source-dialog-done', 'docs-source-dialog-close']) {
            const box = await page.getByTestId(id).boundingBox();
            expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
        }

        // The sole-group default was pinned before the join (closing would keep it too).
        expect(storedSource()).toBe(`org:${FIRST}`);
        const audited = rows(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'adoption_docs_source_changed' AND lower(user_email) = '${SOLO.email}' AND details LIKE '%kept_on_join%'`)[0];
        expect(Number(audited?.n)).toBeGreaterThanOrEqual(1);

        await dialog.getByTestId('docs-source-dialog-done').click();
        await expect(dialog).toBeHidden({ timeout: 30000 });
        expect(storedSource()).toBe(`org:${FIRST}`);
        expect((await publicFormBranding(page))?.orgSlug).toBe('refugio-marca-e2e');
        await context.close();
    });

    test('choosing the new group saves it', async ({ browser }) => {
        const context = await soloContext(browser);
        const page = await context.newPage();
        const dialog = await joinAskGroup(page);
        await dialog.locator(`input[value="org:${ASK_ORG}"]`).check();
        await dialog.getByTestId('docs-source-dialog-done').click();
        await expect(dialog).toBeHidden({ timeout: 30000 });
        await expect.poll(storedSource, { timeout: 30000 }).toBe(`org:${ASK_ORG}`);
        // Her links no longer carry the first group's look.
        expect((await publicFormBranding(page))?.orgSlug ?? null).not.toBe('refugio-marca-e2e');
        await context.close();
    });

    test('closing without answering keeps the first group', async ({ browser }) => {
        const context = await soloContext(browser);
        const page = await context.newPage();
        const dialog = await joinAskGroup(page);
        await dialog.locator('input[value="self"]').check(); // picked, then closed: nothing is saved
        await dialog.getByTestId('docs-source-dialog-close').click();
        await expect(dialog).toBeHidden({ timeout: 30000 });
        expect(storedSource()).toBe(`org:${FIRST}`);
        expect((await publicFormBranding(page))?.orgSlug).toBe('refugio-marca-e2e');
        // A reload does not ask again.
        await page.reload();
        await expect(page.locator(`[data-testid="org-card"][data-org-id="${ASK_ORG}"]`)).toBeVisible({ timeout: 30000 });
        await expect(page.getByTestId('docs-source-dialog')).toHaveCount(0);
        await context.close();
    });

    test('leaving the group her links used asks again, with the groups she has left', async ({ browser }) => {
        const context = await soloContext(browser);
        const page = await context.newPage();
        const dialog = await joinAskGroup(page);
        await dialog.locator(`input[value="org:${ASK_ORG}"]`).check();
        await dialog.getByTestId('docs-source-dialog-done').click();
        await expect(dialog).toBeHidden({ timeout: 30000 });
        await expect.poll(storedSource, { timeout: 30000 }).toBe(`org:${ASK_ORG}`);

        // «Salir» of that group (a native confirm first).
        page.once('dialog', d => d.accept());
        const card = page.locator(`[data-testid="org-card"][data-org-id="${ASK_ORG}"]`);
        await card.getByRole('button', { name: /Salir|Leave|Sair/i }).click();
        const again = page.getByTestId('docs-source-dialog');
        await expect(again).toBeVisible({ timeout: 30000 });
        await expect(again.locator(`input[value="org:${ASK_ORG}"]`)).toHaveCount(0);
        await expect(again.locator(`input[value="org:${FIRST}"]`)).toHaveCount(1);
        // The group she used is gone, so her links fall back to her own: that is what is pre-selected.
        await expect(again.locator('input[value="self"]')).toBeChecked();
        await expect(again.getByTestId('adoption-docs-in-use-self')).toBeVisible();
        await again.getByTestId('docs-source-dialog-close').click();
        await expect(again).toBeHidden({ timeout: 30000 });
        // R18: the stored group she left became «Los míos», so rejoining it later can't switch her back silently.
        expect(storedSource()).toBe('self');
        await context.close();
    });
});
