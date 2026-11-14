import { test, expect, type Page } from '@playwright/test';

test.setTimeout(120000);

// «Cargar un animal desde un post» (Jon 2026-11-14). The post fetch and the AI
// read are stubbed — what is under test is what the rescuer sees and what gets
// saved, not Instagram or Gemini. Saves are real.
//
// The production build registers /sw.js, and a worker controlling the page
// serves /api/ requests itself: blocked so the stubs stay in charge.
test.use({ serviceWorkers: 'block' });

const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const IMG = `data:image/png;base64,${PIXEL}`;

async function stubPost(page: Page, link: string, animals: unknown[], postDate: string | null = null) {
    await page.route('**/api/import/fetch-content', route => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { text: 'post', images: [IMG, IMG], sourceUrl: link, sourceType: 'instagram' } }),
    }));
    await page.route('**/api/ai/extract-animals', route => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
            success: true,
            data: { animals, postDate },
            processedImages: [{ data: PIXEL, mimeType: 'image/png' }, { data: PIXEL, mimeType: 'image/png' }],
            missingImages: 0,
        }),
    }));
}

async function readPost(page: Page, link: string) {
    await page.goto('/my-animals/new');
    await page.locator('#post-source-url').fill(link, { timeout: 30000 });
    await page.getByTestId('post-source-read').click();
}

test.describe('Animal import from a post', () => {
    test('one animal fills the form, points out what the post did not say, and saves with the link', async ({ page }) => {
        const stamp = Date.now();
        const name = `Fixture Rocco ${stamp}`;
        const link = `https://www.instagram.com/p/FIXTUREROCCO${stamp}/`;
        await stubPost(page, link, [{ name, species: 'dog', sex: 'macho', neutered: '', ageValue: '2', ageUnit: 'years', color: 'Atigrado', details: 'Sociable', photos: [0] }], '2026-08-12');
        await readPost(page, link);

        await expect(page.locator('[data-testid="post-source"][data-state="read"]')).toBeVisible({ timeout: 30000 });
        await expect(page.locator('#animalName')).toHaveValue(name);
        await expect(page.locator('#sex')).toHaveValue('macho');
        await expect(page.locator('#ageValue')).toHaveValue('2');
        // Neutered status is a nudge, never a requirement.
        await expect(page.getByTestId('nudge-neutered')).toBeVisible();
        await expect(page.getByTestId('nudge-sex')).toHaveCount(0);
        await expect(page.getByTestId('age-note')).toBeVisible();
        // The post's first photo is chosen, the second is not.
        await expect(page.getByTestId('post-photos-0')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByTestId('post-photos-1')).toHaveAttribute('aria-pressed', 'false');

        await page.locator('form button[type="submit"]').click();
        await page.waitForURL(/\/my-animals$/, { timeout: 60000 });
        await expect(page.locator('h3', { hasText: name })).toBeVisible({ timeout: 30000 });

        // The same post again: «Ya cargaste este post», with that animal.
        await readPost(page, link);
        const notice = page.getByTestId('dup-same-post-mine');
        await expect(notice).toBeVisible({ timeout: 30000 });
        await expect(notice).toContainText(name);
        await notice.getByTestId('dup-continue').click();
        await expect(notice).toHaveCount(0);
    });

    test('several animals: one row each, saved together', async ({ page }) => {
        const stamp = Date.now();
        const a = `Fixture Mandarina ${stamp}`;
        const b = `Fixture Tito ${stamp}`;
        await stubPost(page, `https://www.instagram.com/p/FIXTURELITTER${stamp}/`, [
            { name: a, species: 'cat', sex: 'hembra', neutered: '0', ageValue: '2', ageUnit: 'months', color: '', details: '', photos: [0] },
            { name: b, species: 'cat', sex: '', neutered: '0', ageValue: '2', ageUnit: 'months', color: '', details: '', photos: [1] },
        ]);
        await readPost(page, `https://www.instagram.com/p/FIXTURELITTER${stamp}/`);

        await expect(page.getByTestId('litter')).toBeVisible({ timeout: 30000 });
        await expect(page.getByTestId('litter-row-1')).toContainText(/Sin completar|Not filled in/);
        await page.getByTestId('litter-toggle-1').click();
        await expect(page.getByTestId('litter-1-nudge-sex')).toBeVisible();
        await page.getByTestId('litter-save').click();
        await page.waitForURL(/\/my-animals$/, { timeout: 90000 });
        await expect(page.locator('h3', { hasText: a })).toBeVisible({ timeout: 30000 });
        await expect(page.locator('h3', { hasText: b })).toBeVisible();
    });

    test('a post that cannot be read keeps the form usable', async ({ page }) => {
        await page.route('**/api/import/fetch-content', route => route.fulfill({
            status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Failed to fetch URL (status 404)', requiresManualInput: true }),
        }));
        await readPost(page, 'https://www.instagram.com/p/FIXTUREGONE/');
        await expect(page.getByTestId('post-source-failed')).toBeVisible({ timeout: 30000 });
        await expect(page.getByText(/Error ID:/)).toBeVisible();
        // The form is right there: its first input is still the name.
        await expect(page.locator('form input').first()).toHaveAttribute('id', 'animalName');
    });

    test('a post about a person offers to load it as a person', async ({ page }) => {
        await stubPost(page, 'https://www.instagram.com/p/FIXTUREREPORT/', []);
        await readPost(page, 'https://www.instagram.com/p/FIXTUREREPORT/');
        const box = page.getByTestId('post-source-no-animal');
        await expect(box).toBeVisible({ timeout: 30000 });
        await expect(box.getByRole('link')).toHaveAttribute('href', /\/import\?shared=true&shared_url=.*&kind=person/);
    });

    test('shared from the phone: «Un animal en adopción» opens «Agregar animal» reading the post', async ({ page }) => {
        const stamp = Date.now();
        const link = `https://www.instagram.com/p/FIXTURESHARE${stamp}/`;
        await stubPost(page, link, [{ name: `Fixture Luz ${stamp}`, species: 'cat', sex: 'hembra', neutered: '', ageValue: '', ageUnit: 'months', color: '', details: '', photos: [] }]);
        await page.goto(`/import?shared=true&shared_url=${encodeURIComponent(link)}`);
        await expect(page.getByTestId('share-kind')).toBeVisible({ timeout: 30000 });
        await page.getByTestId('share-kind-animal').click();
        await page.waitForURL(/\/my-animals\/new/, { timeout: 30000 });
        await expect(page.locator('#animalName')).toHaveValue(`Fixture Luz ${stamp}`, { timeout: 30000 });
        // Read once: the link is not left in the address for a reload to read again.
        await expect.poll(() => new URL(page.url()).search).toBe('');
    });
});
