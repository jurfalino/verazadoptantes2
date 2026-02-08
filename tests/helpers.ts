import { expect, Page } from '@playwright/test';

/**
 * Log in as anonymous user. Skips if already logged in.
 */
export async function loginAsAnon(page: Page) {
    await page.goto('/');

    // Check if already logged in (search input visible)
    try {
        await expect(page.locator('input#search')).toBeVisible({ timeout: 5000 });
        return; // Already logged in
    } catch {
        // Not logged in — proceed with anon flow
    }

    await page.goto('/?enable_anon=true');
    const skipButton = page.getByRole('button', { name: /Skip|guest|invitado|omitir/i });
    if (await skipButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await skipButton.click();
    }

    // Wait for the app to load (search input appears)
    await expect(page.locator('input#search')).toBeVisible({ timeout: 60000 });
}

/** Known test adopter IDs from seed.sql */
export const TEST_ADOPTERS = {
    MARIA: 'test-adopter-1',
    CARLOS: 'test-adopter-2',
    ANA: 'test-adopter-3',
    ROBERTO: 'test-adopter-4',
    NUEVA: 'test-adopter-5',
} as const;

/** Known names from seed data */
export const TEST_NAMES = {
    MARIA: 'María García López',
    CARLOS: 'Carlos Danger',
    ANA: 'Ana Martínez',
    ROBERTO: 'Roberto Fernández',
    NUEVA: 'Nueva Persona',
} as const;

/** Known animal names from seed adoptions */
export const TEST_ANIMALS = {
    LUNA: 'Luna',
    MICHI: 'Michi',
    FIRULAIS: 'Firulais',
    PELUSA: 'Pelusa',
    ROCKY: 'Rocky',
} as const;

/** María's old name (before history change) — used for search-by-old-name tests */
export const MARIA_OLD_NAME = 'María Gómez';

/** Family member names from seed data */
export const TEST_FAMILY = {
    MARIA_HUSBAND: 'Juan García',
    MARIA_DAUGHTER: 'Lucía García',
} as const;
