import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'child_process';
import { dismissCountryBanner } from './helpers';

/**
 * /my-animals list: the card shows the species and the date in the app's
 * language, and the tab you are NOT on shows a real count instead of "(...)".
 *
 * Runs as the `user` project (testuser@example.com). Dedicated fixtures only:
 * one available dog and one adopted cat owned by the test user, inserted here
 * and removed afterwards, so no seed record changes.
 */
const OWNER = 'testuser@example.com';
const AVAILABLE_ID = 'test-animal-fixture-ma-available';
const ADOPTED_ID = 'test-animal-fixture-ma-adopted';
const PLACEMENT_ID = 'test-plc-fixture-ma-adopted';
const ADOPTER_ID = 'test-adopter-fixture-ma';

function execD1(sql: string): string {
    return execSync(
        `npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
}

function cleanup() {
    execD1(`DELETE FROM placements WHERE id='${PLACEMENT_ID}'`);
    execD1(`DELETE FROM animals WHERE id IN ('${AVAILABLE_ID}','${ADOPTED_ID}')`);
    execD1(`DELETE FROM adopters WHERE id='${ADOPTER_ID}'`);
}

/** Open the list with the app language pinned (Chromium alone renders English). */
async function openList(page: Page, view: 'available' | 'adopted', locale: 'es' | 'en' | 'pt') {
    await page.addInitScript((l) => localStorage.setItem('app-locale', l), locale);
    await page.goto(`/my-animals?view=${view}`);
    await dismissCountryBanner(page);
}

test.describe('/my-animals list', () => {
    test.beforeAll(() => {
        cleanup();
        // Civil dates (midnight UTC), so every viewer reads the same day.
        execD1(
            `INSERT INTO adopters (id, name, contact_info, status, added_by, created_at, updated_at) VALUES ` +
            `('${ADOPTER_ID}', 'Adoptante MisAnimales', 'Tel: 555-0301', '5', 'test-seed', strftime('%s','now'), strftime('%s','now'))`,
        );
        execD1(
            `INSERT INTO animals (id, name, species, details, added_by, created_at, updated_at) VALUES ` +
            `('${AVAILABLE_ID}', 'Bruno Fixture', 'dog', 'Fixture de /my-animals', '${OWNER}', strftime('%s','2026-09-09'), strftime('%s','now')), ` +
            `('${ADOPTED_ID}', 'Tita Fixture', 'cat', 'Fixture de /my-animals', '${OWNER}', strftime('%s','2026-01-15'), strftime('%s','now'))`,
        );
        execD1(
            `INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at, ended_at, status, rating, recorded_by) VALUES ` +
            `('${PLACEMENT_ID}', '${ADOPTED_ID}', '${ADOPTER_ID}', 'adoption', strftime('%s','2026-03-02'), NULL, 'completed', 5, '${OWNER}')`,
        );
    });
    test.afterAll(() => cleanup());

    test('count mode matches both lists exactly', async ({ page }) => {
        await page.goto('/');
        const counts = await (await page.request.get('/api/my-animals?counts=1')).json() as { available: number; adopted: number };
        expect(typeof counts.available).toBe('number');
        expect(typeof counts.adopted).toBe('number');

        const available = await (await page.request.get('/api/my-animals?view=available')).json() as Array<{ id: string }>;
        const adopted = await (await page.request.get('/api/my-animals?view=adopted')).json() as Array<{ id: string }>;
        expect(available.map(a => a.id)).toContain(AVAILABLE_ID);
        expect(adopted.map(a => a.id)).toContain(ADOPTED_ID);
        expect(counts.available).toBe(new Set(available.map(a => a.id)).size);
        expect(counts.adopted).toBe(new Set(adopted.map(a => a.id)).size);
    });

    test('Spanish: species badge, short date and the other tab count', async ({ page }) => {
        await openList(page, 'available', 'es');
        const card = page.getByTestId(`animal-card-${AVAILABLE_ID}`);
        await expect(card).toBeVisible({ timeout: 30000 });
        await expect(card).toContainText('Perro');
        await expect(card).not.toContainText(/\bdog\b/i);
        await expect(page.getByTestId(`card-date-${AVAILABLE_ID}`)).toContainText("9 sept '26");

        const counts = await (await page.request.get('/api/my-animals?counts=1')).json() as { available: number; adopted: number };
        const adoptedTab = page.getByRole('link', { name: /Ya Adoptados/ });
        await expect(adoptedTab).toContainText(`(${counts.adopted})`);
        await expect(adoptedTab).not.toContainText('...');
        const availableTab = page.getByRole('link', { name: /Disponibles/ });
        await expect(availableTab).toContainText(`(${counts.available})`);
    });

    test('Spanish: adopted tab shows the available count', async ({ page }) => {
        await openList(page, 'adopted', 'es');
        const card = page.getByTestId(`animal-card-${ADOPTED_ID}`);
        await expect(card).toBeVisible({ timeout: 30000 });
        await expect(card).toContainText('Gato');
        await expect(page.getByTestId(`card-date-${ADOPTED_ID}`)).toContainText("2 mar '26");
        const availableTab = page.getByRole('link', { name: /Disponibles/ });
        await expect(availableTab).toContainText(/\(\d+\)/);
        await expect(availableTab).not.toContainText('...');
    });

    test('English: species badge and short date follow the language', async ({ page }) => {
        await openList(page, 'available', 'en');
        const card = page.getByTestId(`animal-card-${AVAILABLE_ID}`);
        await expect(card).toBeVisible({ timeout: 30000 });
        await expect(card).toContainText('Dog');
        await expect(page.getByTestId(`card-date-${AVAILABLE_ID}`)).toContainText("Sep 9 '26");
        await expect(page.getByRole('link', { name: /Already Adopted/ })).toContainText(/\(\d+\)/);
    });

    test('Portuguese: short date uses Portuguese months', async ({ page }) => {
        await openList(page, 'available', 'pt');
        await expect(page.getByTestId(`card-date-${AVAILABLE_ID}`)).toContainText("9 set '26", { timeout: 30000 });
    });
});
