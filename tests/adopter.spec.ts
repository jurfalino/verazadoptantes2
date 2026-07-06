import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { TEST_ADOPTERS, TEST_NAMES, dismissCountryBanner } from './helpers';

/**
 * Execute a single SQL statement against the local D1 dev DB via wrangler.
 * Used by the "available → adopted" test to seed and re-query the fixture
 * row directly, since neither operation has a stable browser endpoint.
 * Pattern mirrors tests/contract-link.spec.ts:21.
 */
function execD1(sql: string): string {
    return execSync(
        `npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`,
        { cwd: process.cwd(), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
}
function parseD1Rows(output: string): Array<Record<string, unknown>> {
    try {
        const wrapped = JSON.parse(output);
        const first = Array.isArray(wrapped) ? wrapped[0] : wrapped;
        return first?.results ?? [];
    } catch {
        return [];
    }
}

test.setTimeout(60000);

test.describe('Adopter Profile', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await dismissCountryBanner(page);
    });

    test('View full adopter profile', async ({ page }) => {
        await page.goto(`/adopter/${TEST_ADOPTERS.MARIA}`);

        // In view mode, name appears as an h2 heading (click-to-edit pattern)
        await expect(page.getByRole('heading', { name: TEST_NAMES.MARIA })).toBeVisible({ timeout: 30000 });

        // Contact info should be displayed
        await expect(page.getByText(/555-1234/)).toBeVisible({ timeout: 30000 });

        // Rating badge should be visible
        await expect(page.getByTestId('rating-badge')).toBeVisible({ timeout: 30000 });

        // Adoptions list should be visible with records
        await expect(page.getByTestId('adoptions-list')).toBeVisible({ timeout: 30000 });
    });

    test('Create new adopter', async ({ page }) => {
        const uniqueName = `Test Persona ${Date.now()}`;

        await page.goto('/adopter/create');
        await dismissCountryBanner(page);

        // In create mode, form is in editing mode with input fields
        await page.getByPlaceholder(/name|nombre/i).fill(uniqueName);

        // Submit the form
        // v2.19.34: target the form's main submit button by testid.
        // Until v2.19.32 a `name: /save|guardar/i` role match was unique,
        // but the pre-opened composer now also renders a "Guardar" button
        // (`ce-composer-submit`) with the same accessible name, so the
        // role+name match is strict-mode-violating.
        await page.getByTestId('adopter-form-submit').click();

        // Handle duplicate detection modal if it appears
        // Wait up to 3s for it to appear; if it doesn't, assume no duplicates were found.
        const createAnywayBtn = page.getByRole('button', { name: /Create new profile anyway|Crear perfil nuevo/i });
        try {
            await createAnywayBtn.waitFor({ state: 'visible', timeout: 3000 });
            await createAnywayBtn.click();
        } catch {
            // Modal did not appear, which is fine
        }

        // Should redirect to the new profile — name visible as h2 in view mode
        await expect(page.getByRole('heading', { name: uniqueName })).toBeVisible({ timeout: 30000 });

        // URL should have changed from /create to a UUID
        await expect(page).not.toHaveURL(/\/create/);
    });

    test('Adds typed contact entries via the inline composer on creation', async ({ page }) => {
        // v2.16.0-5 unified the contact add UI across new and existing adopters:
        // new-adopter creation now uses ContactEntriesSection's inline composer
        // instead of ContactEntriesInput's paste-and-categorize. This test
        // confirms entries added through the composer in local mode (no
        // adopterId yet) survive the saveAdopter create call.
        const uniqueName = `Contacto Test ${Date.now()}`;

        await page.goto('/adopter/create');
        await dismissCountryBanner(page);

        await page.getByPlaceholder(/name|nombre/i).fill(uniqueName);

        // v2.19.32: on a fresh new-adopter form (local mode, zero entries)
        // the composer pre-opens directly in the 'editing' stage with
        // type='phone' — skipping the trigger + pick-type clicks. So the
        // FIRST entry skips `ce-add-trigger` and `ce-type-phone`; we just
        // fill the input that already has focus on first paint.
        await page.locator('input[placeholder*="2345-6789"], input[placeholder*="+54"]').first().fill('11 2345-6789');
        await page.getByTestId('ce-composer-submit').click();

        // After save, the composer collapses to 'closed' — the trigger
        // reappears, and adding the SECOND entry goes through the full
        // ce-add-trigger → ce-type-<type> → fill flow as before.
        await page.getByTestId('ce-add-trigger').click();
        await page.getByTestId('ce-type-email').click();
        await page.locator('input[placeholder*="@example.com"], input[placeholder*="name@"]').first().fill('juan.contacto@example.com');
        await page.getByTestId('ce-composer-submit').click();

        // Both chips render in the section now.
        const chips = page.getByTestId('ce-chip');
        await expect(chips).toHaveCount(2, { timeout: 10000 });

        // v2.19.34: target the form's main submit button by testid.
        // Until v2.19.32 a `name: /save|guardar/i` role match was unique,
        // but the pre-opened composer now also renders a "Guardar" button
        // (`ce-composer-submit`) with the same accessible name, so the
        // role+name match is strict-mode-violating.
        await page.getByTestId('adopter-form-submit').click();
        const createAnywayBtn = page.getByRole('button', { name: /Create new profile anyway|Crear perfil nuevo/i });
        try {
            await createAnywayBtn.waitFor({ state: 'visible', timeout: 3000 });
            await createAnywayBtn.click();
        } catch {
            // No duplicates — fine.
        }

        // The saved profile shows the entered contact value.
        await expect(page.getByRole('heading', { name: uniqueName })).toBeVisible({ timeout: 30000 });
        await expect(page.getByText('juan.contacto@example.com')).toBeVisible({ timeout: 30000 });
    });

    test('Composer three-stage flow — change-type discards in-progress input (v2.18.4)', async ({ page }) => {
        // v2.18.4 redesign: clicking the trigger lands in the "pick-type"
        // stage with no input visible. Picking a pill advances to the
        // "editing" stage with input(s) + Save/Cancel laid out identically
        // to the in-row edit form. The "↺ cambiar" link returns to
        // pick-type and DISCARDS any in-progress input — explicit user
        // action, no auto-commit hack from v2.18.1 since pills no longer
        // appear during editing so there's no silent-discard scenario.
        const uniqueName = `Contacto Compose ${Date.now()}`;

        await page.goto('/adopter/create');
        await dismissCountryBanner(page);

        await page.getByPlaceholder(/name|nombre/i).fill(uniqueName);

        // v2.19.32: composer pre-opens in 'editing' stage with phone
        // type on a fresh form. Cancel it to put the composer back into
        // the 'closed' state so the test can exercise the original
        // trigger → pick-type → editing path that's the focus of this
        // spec (change-type discard behaviour).
        await page.getByTestId('ce-composer-cancel').click();

        await page.getByTestId('ce-add-trigger').click();
        // Pick-type stage: no input visible yet. The Save submit button
        // shouldn't render either — guard against it for regression sake.
        await expect(page.getByTestId('ce-composer-submit')).toHaveCount(0);

        // Pick address, type something, then "↺ cambiar" → input is wiped,
        // pills are visible again. Switch to phone and save successfully.
        await page.getByTestId('ce-type-address').click();
        await page.locator('input[placeholder*="Calle"], input[placeholder*="Street"]').first().fill('THROWAWAY ADDRESS');
        await page.getByTestId('ce-compose-change-type').click();

        // Back in pick-type. Pick phone and submit a real value.
        await page.getByTestId('ce-type-phone').click();
        await page.locator('input[placeholder*="2345-6789"], input[placeholder*="+54"]').first().fill('11 5555-1234');
        await page.getByTestId('ce-composer-submit').click();

        // Exactly ONE chip — the address draft was discarded by "cambiar".
        const chips = page.getByTestId('ce-chip');
        await expect(chips).toHaveCount(1, { timeout: 10000 });

        // Save the adopter end-to-end to confirm the entry persists.
        // v2.19.34: target the form's main submit button by testid.
        // Until v2.19.32 a `name: /save|guardar/i` role match was unique,
        // but the pre-opened composer now also renders a "Guardar" button
        // (`ce-composer-submit`) with the same accessible name, so the
        // role+name match is strict-mode-violating.
        await page.getByTestId('adopter-form-submit').click();
        const createAnywayBtn = page.getByRole('button', { name: /Create new profile anyway|Crear perfil nuevo/i });
        try {
            await createAnywayBtn.waitFor({ state: 'visible', timeout: 3000 });
            await createAnywayBtn.click();
        } catch {
            // No duplicates — fine.
        }

        // The saved profile has the phone but NOT the throwaway address.
        await expect(page.getByRole('heading', { name: uniqueName })).toBeVisible({ timeout: 30000 });
        await expect(page.getByText('11 5555-1234')).toBeVisible({ timeout: 30000 });
        await expect(page.getByText('THROWAWAY ADDRESS')).toHaveCount(0);
    });

    test('Edit adopter name', async ({ page }) => {
        const newName = `Persona Editada ${Date.now()}`;

        await page.goto(`/adopter/${TEST_ADOPTERS.NUEVA}`);
        await dismissCountryBanner(page);
        await page.waitForLoadState('networkidle');

        // Wait for profile to load — name appears as h1
        await expect(page.getByRole('heading', { name: TEST_NAMES.NUEVA })).toBeVisible({ timeout: 30000 });

        // Wait for the Notifications button (confirms auth session is loaded)
        await expect(page.getByRole('button', { name: /Notifications|Notificaciones/i })).toBeVisible({ timeout: 30000 });

        // Try clicking edit — retry if login modal opens instead of edit mode (session race)
        const editBtn = page.getByRole('button', { name: /Click to Edit|Clic para Editar/i }).first();
        const nameInput = page.locator('input[type="text"][required]').first();

        for (let attempt = 0; attempt < 3; attempt++) {
            await editBtn.click();
            const inputVisible = await nameInput.isVisible({ timeout: 3000 }).catch(() => false);
            if (inputVisible) break;
            await page.keyboard.press('Escape');
            await page.waitForTimeout(2000);
        }

        // Verify edit mode activated — name input is visible and editable
        await expect(nameInput).toBeVisible({ timeout: 30000 });
        await nameInput.clear();
        await nameInput.fill(newName);
        await expect(nameInput).toHaveValue(newName);

        // Verify Save and Cancel buttons are visible
        const saveBtn = page.getByRole('button', { name: /save|guardar/i });
        const cancelBtn = page.getByRole('button', { name: /cancel|cancelar/i });
        await expect(saveBtn).toBeVisible({ timeout: 30000 });
        await expect(cancelBtn).toBeVisible({ timeout: 30000 });

        // Cancel to exit edit mode and verify name reverts to original
        await cancelBtn.click();
        await expect(page.getByRole('heading', { name: TEST_NAMES.NUEVA })).toBeVisible({ timeout: 30000 });
    });

    test('Available animal becomes adopted after picking it in the wizard and saving (v2.18.7 regression)', async ({ page }) => {
        // Prod-reported bug: user added an adoption for an existing adopter,
        // picked an animal from the available-animals dropdown, saved, but
        // the animal was still listed as "for adoption" afterward. The
        // expected backend behavior is an UPDATE on the available row that
        // flips `recordType` from 'available' → 'adoption' and sets
        // `adopter_id` to the current adopter.
        //
        // This test instruments the exact flow and asserts BOTH (a) the row
        // is updated in the DB and (b) the /my-animals "available" view no
        // longer surfaces it. Without this, the prod-reported regression
        // could (and did) ship undetected.
        const animalId = `test-available-bug-${Date.now()}`;
        const animalName = `BugFixture ${Date.now()}`;
        // Owner MUST match the project's authenticated test user so the
        // wizard's getAvailableAnimals() query (filtered by
        // session.user.email) surfaces this row in the picker. Project
        // `user` runs as testuser@example.com (see playwright.config.ts).
        const FIXTURE_OWNER = 'testuser@example.com';

        // The wrangler D1 CLI returns NULL columns as the literal string
        // "null" in its JSON output (not actual JSON null). Normalize so
        // assertions are clear about what they're checking.
        const isNullish = (v: unknown): boolean =>
            v === null || v === undefined || v === 'null' || v === '';

        // 1. Seed an available animal owned by the test user. Normalized model:
        //    an available animal is an animals row with no active placement (the
        //    adoptions compat view derives adopter_id NULL, record_type 'available').
        execD1(
            `INSERT OR REPLACE INTO animals (id, name, species, details, added_by, created_at, updated_at) ` +
            `VALUES ('${animalId}', '${animalName}', 'dog', 'E2E available→adopted fixture', '${FIXTURE_OWNER}', strftime('%s','now'), strftime('%s','now'))`,
        );

        try {
            // 2. Confirm the seed row is what we expect.
            const seededRows = parseD1Rows(execD1(
                `SELECT id, adopter_id, record_type, added_by FROM adoptions WHERE id = '${animalId}'`,
            ));
            expect(seededRows).toHaveLength(1);
            expect(isNullish(seededRows[0].adopter_id)).toBe(true);
            expect(seededRows[0].record_type).toBe('available');
            expect(seededRows[0].added_by).toBe(FIXTURE_OWNER);

            // 3. Open the adopter profile (using NUEVA so we don't pollute the
            //    other-spec assertions on María's record set).
            await page.goto(`/adopter/${TEST_ADOPTERS.NUEVA}`);
            await dismissCountryBanner(page);
            await expect(page.getByRole('heading', { name: TEST_NAMES.NUEVA })).toBeVisible({ timeout: 30000 });

            // 4. Click the "Adoption" intent button in VisitIntentCard.
            await page.getByTestId('visit-intent-adoption').click();

            // 5. The wizard opens. Wait for the animal picker (which renders
            //    only when there are available animals for the rescuer).
            await expect(page.getByTestId('animal-picker-trigger')).toBeVisible({ timeout: 10000 });
            await page.getByTestId('animal-picker-trigger').click();
            await page.getByTestId(`animal-option-${animalId}`).click();

            // 6. Advance through the 3-step wizard.
            await page.getByTestId('wizard-next-step1').click();
            await page.getByTestId('wizard-next-step2').click();
            await page.getByTestId('wizard-submit').click();

            // 7. Wait for the save to complete — the wizard closes when isOpen
            //    flips to false on success.
            await expect(page.getByTestId('wizard-close')).toHaveCount(0, { timeout: 30000 });

            // 8. Re-query the DB — this is the LOAD-BEARING assertion. If the
            //    UPDATE didn't fire (the prod bug), record_type stays
            //    'available' and adopter_id stays NULL. If the fix is in
            //    place, both flip to the adoption state.
            const afterRows = parseD1Rows(execD1(
                `SELECT id, adopter_id, record_type FROM adoptions WHERE id = '${animalId}'`,
            ));
            expect(afterRows).toHaveLength(1);
            expect(afterRows[0].adopter_id).toBe(TEST_ADOPTERS.NUEVA);
            expect(afterRows[0].record_type).toBe('adoption');

            // 9. Belt-and-braces — also assert the row is gone from the
            //    /my-animals "available" filter via the same SQL the API uses.
            const stillAvailableRows = parseD1Rows(execD1(
                `SELECT id FROM adoptions WHERE id = '${animalId}' AND adopter_id IS NULL AND record_type = 'available' AND added_by = '${FIXTURE_OWNER}'`,
            ));
            expect(stillAvailableRows).toHaveLength(0);
        } finally {
            // Clean up the fixture (normalized tables — adoptions is a view).
            execD1(`DELETE FROM placements WHERE animal_id = '${animalId}'`);
            execD1(`DELETE FROM animals WHERE id = '${animalId}'`);
        }
    });

    test('Fostered animal moved to another foster home CLOSES the prior placement and OPENS a new one (custody history preserved)', async ({ page }) => {
        // The payoff of the normalization: moving a fostered animal to another
        // foster home no longer overwrites the prior placement — the `placements`
        // table keeps the ended span (home A) and opens a new active span (home B),
        // so home A's custody of the animal survives.
        const animalId = `test-foster-move-${Date.now()}`;
        const animalName = `FosterMove ${Date.now()}`;
        const FIXTURE_OWNER = 'testuser@example.com';
        const HOME_A = TEST_ADOPTERS.CARLOS;   // initial foster home
        const HOME_B = TEST_ADOPTERS.NUEVA;    // move target (profile we drive)

        // 1. Seed an animal already fostered to home A: animals row + ACTIVE foster placement.
        execD1(
            `INSERT OR REPLACE INTO animals (id, name, species, details, added_by, created_at, updated_at) ` +
            `VALUES ('${animalId}', '${animalName}', 'dog', 'E2E foster-move fixture', '${FIXTURE_OWNER}', strftime('%s','now','-5 days'), strftime('%s','now','-5 days'))`,
        );
        execD1(
            `INSERT OR REPLACE INTO placements (id, animal_id, adopter_id, record_type, started_at, ended_at, recorded_by) ` +
            `VALUES ('${animalId}-pl-a', '${animalId}', '${HOME_A}', 'foster', strftime('%s','now','-5 days'), NULL, '${FIXTURE_OWNER}')`,
        );

        try {
            // 2. On home B's profile, pick the "Foster" intent + the fostered animal.
            await page.goto(`/adopter/${HOME_B}`);
            await dismissCountryBanner(page);
            await expect(page.getByRole('heading', { name: TEST_NAMES.NUEVA })).toBeVisible({ timeout: 30000 });
            await page.getByTestId('visit-intent-foster').click();
            await expect(page.getByTestId('animal-picker-trigger')).toBeVisible({ timeout: 10000 });
            await page.getByTestId('animal-picker-trigger').click();
            await page.getByTestId(`animal-option-${animalId}`).click();
            await page.getByTestId('wizard-next-step1').click();
            await page.getByTestId('wizard-next-step2').click();
            await page.getByTestId('wizard-submit').click();
            await expect(page.getByTestId('wizard-close')).toHaveCount(0, { timeout: 30000 });

            // 3. Current placement (via view) is now home B, still foster.
            const afterRows = parseD1Rows(execD1(
                `SELECT adopter_id, record_type FROM adoptions WHERE id = '${animalId}'`,
            ));
            expect(afterRows).toHaveLength(1);
            expect(afterRows[0].adopter_id).toBe(HOME_B);
            expect(afterRows[0].record_type).toBe('foster');

            // 4. LOAD-BEARING: the placements table has TWO rows for this animal —
            //    home A ended, home B active. History preserved.
            const active = parseD1Rows(execD1(
                `SELECT adopter_id FROM placements WHERE animal_id = '${animalId}' AND ended_at IS NULL`,
            ));
            expect(active).toHaveLength(1);
            expect(active[0].adopter_id).toBe(HOME_B);
            const ended = parseD1Rows(execD1(
                `SELECT adopter_id FROM placements WHERE animal_id = '${animalId}' AND ended_at IS NOT NULL`,
            ));
            expect(ended).toHaveLength(1);
            expect(ended[0].adopter_id).toBe(HOME_A);
        } finally {
            execD1(`DELETE FROM placements WHERE animal_id = '${animalId}'`);
            execD1(`DELETE FROM animals WHERE id = '${animalId}'`);
        }
    });
});
