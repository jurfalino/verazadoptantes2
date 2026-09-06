import { test, expect } from '@playwright/test';

/**
 * v2.55.15 (animal-timeline PR2): the animal detail page.
 * Runs under the `authed` project (admin session = gatitosolivos@gmail.com,
 * the owner of the seeded fixture animal). Selectors are locale-agnostic
 * (data-testid / roles) — CI Chromium renders English.
 */

const ANIMAL_ID = 'test-animal-fixture-1';

test.describe('Animal detail page', () => {

    test('renders header, custody trail and care events', async ({ page }) => {
        await page.goto(`/my-animals/${ANIMAL_ID}`);

        // Header: hero caption with the animal's name.
        await expect(page.getByTestId('animal-name')).toHaveText('Timon', { timeout: 30000 });

        // Status chip links to the active adopter.
        const chip = page.getByTestId('animal-status-chip');
        await expect(chip).toBeVisible();
        await expect(chip).toHaveAttribute('href', '/adopter/test-adopter-fixture-tl1');

        // Timeline: origin (v2.55.18) + adoption start + ended foster (start+end)
        // + follow_up + vaccination = 6 items.
        const items = page.getByTestId('timeline-item');
        await expect(items).toHaveCount(6);

        // The follow-up's note and the care event's note are both on the page.
        await expect(page.getByText('Muy bien adaptado a la casa nueva')).toBeVisible();
        await expect(page.getByText('Quíntuple, primera dosis')).toBeVisible();

        // v2.55.18: attribution + origin — who added the animal (and the team),
        // and the registration date as the timeline's first event.
        await expect(page.getByTestId('animal-added-by')).toContainText('Test Admin');
        await expect(page.getByTestId('animal-added-by')).toContainText('Refugio E2E');
        await expect(page.getByText(/Rescued and registered|Rescatado y registrado/)).toBeVisible();
    });

    test('a teammate\'s animal is visible, attributed, and actionable (full parity)', async ({ page }) => {
        // test-animal-fixture-2 belongs to e2e-teammate@example.com — same org.
        await page.goto('/my-animals/test-animal-fixture-2');
        await expect(page.getByTestId('animal-name')).toHaveText('Nube', { timeout: 30000 });
        await expect(page.getByTestId('animal-added-by')).toContainText('Vero E2E');

        // Full parity: the admin records a care event on the teammate's animal.
        const before = await page.getByTestId('timeline-item').count();
        await page.getByTestId('add-animal-event').click();
        await page.getByTestId('animal-event-type').selectOption('vet_visit');
        await page.getByTestId('animal-event-details').fill(`E2E control veterinario ${Date.now()}`);
        await page.getByTestId('animal-event-save').click();
        await expect(page.getByTestId('timeline-item')).toHaveCount(before + 1, { timeout: 30000 });

        // And the teammate's card shows up in the admin's available list, attributed.
        await page.goto('/my-animals?view=available');
        await expect(page.getByTestId('animal-card-test-animal-fixture-2')).toBeVisible({ timeout: 30000 });
        await expect(page.getByText(/de Vero|by Vero/)).toBeVisible();
    });

    test('records a care event through the modal', async ({ page }) => {
        await page.goto(`/my-animals/${ANIMAL_ID}`);
        await expect(page.getByTestId('animal-name')).toBeVisible({ timeout: 30000 });

        const before = await page.getByTestId('timeline-item').count();

        await page.getByTestId('add-animal-event').click();
        await page.getByTestId('animal-event-type').selectOption('deworming');
        await page.getByTestId('animal-event-details').fill(`E2E desparasitación ${Date.now()}`);
        await page.getByTestId('animal-event-save').click();

        // router.refresh() re-renders the server component with the new event.
        await expect(page.getByTestId('timeline-item')).toHaveCount(before + 1, { timeout: 30000 });
    });

    test('list card navigates to the detail page', async ({ page }) => {
        await page.goto('/my-animals?view=adopted');
        const card = page.getByTestId(`animal-card-${ANIMAL_ID}`);
        await expect(card).toBeVisible({ timeout: 30000 });
        await card.click();
        // Generous timeout: under fullyParallel this can be the FIRST request to
        // /my-animals/[id], and next dev compiles the route on demand while the
        // soft-navigation's RSC fetch waits (the 5s default expired mid-compile).
        await expect(page).toHaveURL(new RegExp(`/my-animals/${ANIMAL_ID}$`), { timeout: 45000 });
        await expect(page.getByTestId('animal-name')).toHaveText('Timon', { timeout: 30000 });
    });

    test('projected follow-ups render with the flag on', async ({ page }) => {
        await page.goto(`/my-animals/${ANIMAL_ID}`);
        await expect(page.getByTestId('animal-name')).toBeVisible({ timeout: 30000 });

        // Timon was adopted ~80 days ago with no birthdate (health omitted):
        // the 7d check-in is expired, the seeded follow-up satisfies the 30d one
        // via the date heuristic, and the 6-month check-in is scheduled.
        const section = page.getByTestId('projected-section');
        await expect(section).toBeVisible();
        await expect(section.getByText(/Six-month check-in|Control de los 6 meses/)).toBeVisible();
        // No due slot → no banner, no pending pill.
        await expect(page.getByTestId('due-banner')).not.toBeVisible();
        await expect(page.getByTestId('pending-pill')).not.toBeVisible();
        // The expired 7d reminder sits collapsed under the disclosure.
        await expect(section.getByRole('button', { name: /1 (expired reminder|recordatorio vencido)/ })).toBeVisible();
    });

    test('in-place edit updates identity without touching custody', async ({ page }) => {
        await page.goto(`/my-animals/${ANIMAL_ID}`);
        await expect(page.getByTestId('animal-name')).toBeVisible({ timeout: 30000 });

        await page.getByTestId('profile-edit').click();
        const colorInput = page.locator('#ae-color');
        await expect(colorInput).toBeVisible();
        const newColor = `caramelo`;
        await colorInput.fill(newColor);
        await page.getByTestId('inline-edit-save').click();

        // Back out of edit mode with the new color in the descriptor…
        await expect(page.getByTestId('inline-edit-form')).not.toBeVisible({ timeout: 30000 });
        await expect(page.getByTestId('animal-header')).toContainText(newColor);
        // …and the adoption is still active (the old edit form used to end it).
        await expect(page.getByTestId('animal-status-chip')).toHaveAttribute('href', '/adopter/test-adopter-fixture-tl1');
    });
});
