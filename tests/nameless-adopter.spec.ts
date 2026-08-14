import { test, expect } from '@playwright/test';
import { dismissCountryBanner } from './helpers';

/**
 * E2E coverage for the nameless-adopter create flow (design:
 * nameless-adopter-profiles). Mirrors the real AdopterForm friction gate
 * (src/components/AdopterForm.tsx:624-670, hasMinimumIdentifier in
 * src/domain/adopterIdentity.ts):
 *
 *   - name empty + at least one contact  -> gentle prompt with an explicit
 *     "No conozco el nombre" opt-in checkbox (adopter.dont_know_name).
 *     Checking it and saving again creates the record; the resulting
 *     profile falls back to "Sin nombre" (adopter.nameless) via
 *     adopterDisplayName (src/lib/adopterDisplay.ts).
 *   - name empty + NO contact at all -> hard error, no opt-in offered
 *     (adopter.name_or_contact_required).
 *
 * Selectors follow the same real-form patterns already exercised by
 * tests/adopter.spec.ts ("Create new adopter" / "Adds typed contact
 * entries via the inline composer on creation"):
 *   - name input: placeholder is t('adopter.placeholder_name_aliases')
 *     ("Nombre Completo (y Apodos/Alias)").
 *   - submit button: data-testid="adopter-form-submit"
 *     (AdopterForm.tsx:1044) — a role/name match is strict-mode-violating
 *     because the pre-opened contact composer also renders a "Guardar"
 *     button (ce-composer-submit) with the same accessible name.
 *   - contact composer: on a fresh /adopter/create form (local mode, zero
 *     entries) it pre-opens directly in the 'editing' stage with
 *     type='phone' (ContactEntriesSection.tsx:122-133), so the phone input
 *     is already focused — no need to click ce-add-trigger/ce-type-phone
 *     first. Submitted via data-testid="ce-composer-submit".
 */

test.setTimeout(60000);

test.describe('nameless adopter create flow', () => {
    // Force Spanish. LanguageContext hydrates from localStorage 'app-locale'
    // first, then navigator.language — and Playwright's Chromium defaults to
    // `en`, so the form's i18n'd copy would render in English and miss the
    // Spanish selectors below (placeholder, "No conozco el nombre", the hard
    // error, "Sin nombre"). es-AR matches the app's default locale and the real
    // audience. Mirrors the pattern in tests/admin-metrics.spec.ts.
    test.use({ locale: 'es-AR' });
    test.beforeEach(async ({ page }) => {
        // The user storage state was captured under Playwright's default `en`
        // locale, so it carries app-locale='en' in localStorage, which
        // LanguageContext prefers over navigator.language. Overwrite it before
        // any app script runs so the form renders the Spanish copy asserted below.
        await page.addInitScript(() => {
            try { window.localStorage.setItem('app-locale', 'es'); } catch { /* noop */ }
        });
        await page.goto('/adopter/create');
        await dismissCountryBanner(page);
    });

    test('empty name + a contact present: gentle prompt, "No conozco el nombre" opt-in creates the record with the "Sin nombre" fallback', async ({ page }) => {
        // Realistic-looking but effectively-unique phone so duplicate
        // detection doesn't collide with seeded fixtures.
        const uniquePhone = `11 2${Date.now().toString().slice(-7)}`;

        // Leave the name empty (default state) — no need to fill/clear it.
        await expect(page.getByPlaceholder(/Nombre Completo/i)).toHaveValue('');

        // Add a contact via the pre-opened composer (fresh form, local mode,
        // zero entries -> editing stage, type=phone, input already focused).
        await page.locator('input[placeholder*="2345-6789"], input[placeholder*="+54"]').first().fill(uniquePhone);
        await page.getByTestId('ce-composer-submit').click();
        await expect(page.getByTestId('ce-chip')).toHaveCount(1, { timeout: 10000 });

        // First save attempt: name is empty but a contact exists -> gentle
        // prompt, NOT the hard error. Assert via the checkbox's role/name
        // (not getByText) — the prompt paragraph itself
        // (adopter.name_empty_prompt) also CONTAINS the phrase "No conozco
        // el nombre" ('...marcá "No conozco el nombre" si es un adoptante
        // anónimo.'), so a text locator on that phrase matches two sibling
        // elements and strict-mode-violates.
        await page.getByTestId('adopter-form-submit').click();
        await expect(page.getByRole('checkbox', { name: /No conozco el nombre/i })).toBeVisible({ timeout: 10000 });
        await expect(page.getByText(/al menos un dato de contacto/i)).toHaveCount(0);

        // Opt in via the "No conozco el nombre" checkbox and save again.
        await page.getByRole('checkbox', { name: /No conozco el nombre/i }).check();
        await page.getByTestId('adopter-form-submit').click();

        // Duplicate-detection confirmation modal may or may not appear
        // (mirrors the handling in tests/adopter.spec.ts).
        const createAnywayBtn = page.getByRole('button', { name: /Create new profile anyway|Crear perfil nuevo/i });
        try {
            await createAnywayBtn.waitFor({ state: 'visible', timeout: 3000 });
            await createAnywayBtn.click();
        } catch {
            // Modal did not appear — no duplicates found, which is fine.
        }

        // Redirected to the new profile; URL leaves /create.
        await expect(page).not.toHaveURL(/\/create/, { timeout: 30000 });

        // The saved nameless profile shows the "Sin nombre" fallback
        // (adopter.nameless). NOT a heading-role assertion: InlineEditField
        // renders the empty-value case as `emptyLabel` in a plain <div>
        // (InlineEditField.tsx:104-109), bypassing the `displayRender` <h1>
        // wrapper entirely — a real h1 only appears once the name is
        // non-empty. So the fallback text is asserted directly.
        await expect(page.getByText(/Sin nombre/i).first()).toBeVisible({ timeout: 30000 });

        // And the contact we entered is present on the profile.
        await expect(page.getByText(uniquePhone)).toBeVisible({ timeout: 30000 });
    });

    test('empty name + NO contact: rejects with the hard "name or contact required" error, no opt-in offered', async ({ page }) => {
        await expect(page.getByPlaceholder(/Nombre Completo/i)).toHaveValue('');

        // No contact entered — the pre-opened composer's phone input is left
        // blank. Attempt to save immediately.
        await page.getByTestId('adopter-form-submit').click();

        // Hard error is shown (hasMinimumIdentifier is false: no name, no
        // contact at all) — the "No conozco el nombre" opt-in is NOT offered
        // in this branch (AdopterForm.tsx:912-917).
        await expect(page.getByText(/al menos un dato de contacto/i)).toBeVisible({ timeout: 10000 });
        await expect(page.getByRole('checkbox', { name: /No conozco el nombre/i })).toHaveCount(0);

        // Never left the create page.
        await expect(page).toHaveURL(/\/create/);
    });
});
