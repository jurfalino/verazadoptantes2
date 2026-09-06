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

        // Timeline: adoption start + ended foster (start+end) + follow_up + vaccination = 5 items.
        const items = page.getByTestId('timeline-item');
        await expect(items).toHaveCount(5);

        // The follow-up's note and the care event's note are both on the page.
        await expect(page.getByText('Muy bien adaptado a la casa nueva')).toBeVisible();
        await expect(page.getByText('Quíntuple, primera dosis')).toBeVisible();
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
        await expect(page).toHaveURL(new RegExp(`/my-animals/${ANIMAL_ID}$`));
        await expect(page.getByTestId('animal-name')).toHaveText('Timon');
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
