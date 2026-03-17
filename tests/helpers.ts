import { Page } from '@playwright/test';

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

/** Dismiss the country selector banner that appears on first page load.
 * Sets localStorage to suppress the banner for both test user emails. */
export async function dismissCountryBanner(page: Page) {
    await page.evaluate(() => {
        localStorage.setItem('country_confirmed_gatitosolivos@gmail.com', '1');
        localStorage.setItem('country_confirmed_testuser@example.com', '1');
    });
    // Brief wait for React to re-render after localStorage change
    await page.waitForTimeout(500);
}
