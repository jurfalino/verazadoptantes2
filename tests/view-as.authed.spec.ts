import { test, expect, type Page } from '@playwright/test';

/**
 * "View as" (src/domain/viewAs.ts): an admin browses as another user,
 * read-only, with a banner on every page and a one-click exit.
 *
 * Runs serially: the admin session's view-as claim lives in its cookie, so the
 * steps share one browser context and must leave it as they found it.
 */

const banner = (page: Page) => page.getByTestId('view-as-banner');
const nameInput = (page: Page) => page.getByPlaceholder(/Your name|Tu nombre|Seu nome/);

/** The display name /settings shows for whoever the session says you are. */
async function settingsName(page: Page) {
    await page.goto('/settings');
    await expect(nameInput(page)).not.toHaveValue('');
    return nameInput(page).inputValue();
}

async function startViewingTestUser(page: Page) {
    await page.goto('/admin/users');
    const row = page.locator('tr').filter({ has: page.getByText('testuser@example.com', { exact: true }) }).filter({ hasText: 'Test User' });
    await row.getByRole('button', { name: /^(View as|Ver como)$/ }).click();
    await page.waitForURL(url => new URL(url).pathname === '/');
    await expect(banner(page)).toContainText('Test User');
}

async function exitViewing(page: Page) {
    await banner(page).getByRole('button', { name: /^(Exit|Salir)$/ }).click();
    await page.waitForURL(/\/admin\/users/);
    await expect(banner(page)).toHaveCount(0);
}

test.describe.serial('admin view as', () => {
    test('shows the viewed user\'s own settings and refuses to save', async ({ page }) => {
        const adminName = await settingsName(page);
        await startViewingTestUser(page);

        const viewedName = await settingsName(page);
        await expect(banner(page)).toBeVisible();
        expect(viewedName).not.toBe(adminName);

        await nameInput(page).fill('Changed While Viewing');
        await page.getByRole('button', { name: /^(Save|Guardar|Salvar)$/ }).first().click();
        await expect(page.getByText(/Error/).first()).toBeVisible();

        await page.reload();
        await expect(nameInput(page)).toHaveValue(viewedName);

        await exitViewing(page);
    });

    test('read pages still render while viewing', async ({ page }) => {
        await startViewingTestUser(page);
        for (const path of ['/my-adopters', '/my-animals', '/my-adoptions', '/settings', '/']) {
            const res = await page.goto(path);
            expect(res?.status(), path).toBeLessThan(400);
            await expect(banner(page), path).toBeVisible();
        }
        // Admin pages are the viewed user's view too: not available.
        await page.goto('/admin/users');
        await expect(page.getByText('testuser@example.com', { exact: true })).toHaveCount(0);
        await page.goto('/');
        await exitViewing(page);
    });

    test('exit restores the admin', async ({ page }) => {
        const adminName = await settingsName(page);
        await startViewingTestUser(page);
        await exitViewing(page);
        // The admin-only page works again, and the session is the admin's.
        await expect(page.getByText('testuser@example.com', { exact: true }).first()).toBeVisible();
        expect(await settingsName(page)).toBe(adminName);
    });
});

test('a regular user cannot start viewing as someone, even by posting the session update', async ({ browser }) => {
    const secret = process.env.AUTH_SECRET;
    test.skip(!secret, 'AUTH_SECRET is required to sign a test session');
    const { encode } = await import('next-auth/jwt');
    const token = await encode({
        secret: secret as string,
        token: { email: 'testuser@example.com', name: 'Test User', sub: 'test-user-id', sessionVersion: 3 },
        salt: 'authjs.session-token',
    });
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const base = new URL(test.info().project.use.baseURL as string);
    await context.addCookies([{ name: 'authjs.session-token', value: token, domain: base.hostname, path: '/', httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage();
    // A bare same-origin page: the app shell may reload itself mid-fetch.
    await page.goto('/api/ready');

    const session: { user?: { email?: string }; viewingAs?: unknown } = await page.evaluate(async () => {
        const { csrfToken } = (await (await fetch('/api/auth/csrf')).json()) as { csrfToken: string };
        const res = await fetch('/api/auth/session', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ csrfToken, data: { viewAs: { userId: 'test-teammate-id' } } }),
        });
        return res.json();
    });
    expect(session?.user?.email).toBe('testuser@example.com');
    expect(session?.viewingAs).toBeUndefined();

    await page.goto('/');
    await expect(banner(page)).toHaveCount(0);
    await context.close();
});
