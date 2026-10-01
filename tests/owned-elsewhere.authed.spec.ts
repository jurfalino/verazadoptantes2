import { test, expect } from '@playwright/test';

test('the owner\'s team / admin still get the real profile', async ({ page }) => {
    await page.goto('/my-animals/test-animal-fixture-owned-1');
    await expect(page.getByTestId('animal-name')).toHaveText('Pirata', { timeout: 30000 });
    await expect(page.getByTestId('owned-elsewhere')).toHaveCount(0);
});
