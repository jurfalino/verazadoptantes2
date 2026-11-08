import { test, expect } from '@playwright/test';

/**
 * Shared notification links opened by someone who is not the owner.
 * - A form submission is a TEAM resource since 2026-09-30 (Jon: the team sees
 *   its applicants), so an org-mate gets the form results, not "no permission".
 * - A contract result is a TEAM resource too (T1, 2026-11-08): an org-mate (or
 *   an admin) sees the same screen as the recipient — never "no permission".
 * Runs under `authed` (gatitosolivos@gmail.com: admin + org-mate of the fixture owner).
 * The plain-org-mate (non-admin) case is covered in tests/team-applicants.spec.ts.
 */
test.describe('shared notification links for non-owners', () => {
    test('form-results of a teammate\'s link: the team sees it, not "no permission" or the 404', async ({ page }) => {
        await page.goto('/form-results/test-formsub-fixture-teammate-1');
        // The form results render (this fixture has no notification, so no submitter line).
        await expect(page.getByRole('heading', { name: /Form responses|Respuestas del formulario|Respostas do formulário/ })).toBeVisible({ timeout: 30000 });
        await expect(page.locator('body')).not.toContainText(/No tenés permiso|You don't have permission|Você não tem permissão/);
        await expect(page.getByTestId('not-found-page')).toHaveCount(0);
    });

    test('contract-results of a teammate: the team sees it, not "no permission" or the 404', async ({ page }) => {
        await page.goto('/contract-results/test-notif-fixture-teammate-1');
        await expect(page.getByRole('heading', { name: /Contract results|Resultados del contrato|Resultados do contrato/ })).toBeVisible({ timeout: 30000 });
        await expect(page.locator('body')).not.toContainText(/No tenés permiso|You don't have permission|Você não tem permissão/);
        await expect(page.getByTestId('not-found-page')).toHaveCount(0);
    });

    test('a missing submission still gets the 404', async ({ page }) => {
        await page.goto('/form-results/test-formsub-fixture-missing');
        await expect(page.getByTestId('not-found-page')).toBeVisible({ timeout: 30000 });
    });
});
