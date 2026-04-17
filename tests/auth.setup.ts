import { test as setup, expect } from '@playwright/test';

const ADMIN_EMAIL = 'gatitosolivos@gmail.com';
const AUTH_FILE = '.auth/admin.json';
const USER_AUTH_FILE = '.auth/user.json';
const USER_EMAIL = 'testuser@example.com';

/**
 * Authenticate as admin by injecting a signed session JWT cookie.
 * Works with Google-only OAuth (no Credentials provider needed).
 *
 * Requires AUTH_SECRET env var to sign the JWT.
 */
setup('authenticate as admin', async ({ page, context }) => {
    const secret = process.env.AUTH_SECRET;
    if (!secret) {
        throw new Error(
            'AUTH_SECRET env var is required for auth setup. ' +
            'Set it in .env.local (local) or GitHub Actions secrets (CI).'
        );
    }

    const { encode } = await import('next-auth/jwt');

    // Create a valid NextAuth session JWT
    const token = await encode({
        secret,
        token: {
            email: ADMIN_EMAIL,
            name: 'Test Admin',
            sub: 'test-admin-id',
            sessionVersion: 3, // Must match REQUIRED_SESSION_VERSION
        },
        salt: 'authjs.session-token',
    });

    // Set the session cookie
    await context.addCookies([{
        name: 'authjs.session-token',
        value: token,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
    }]);

    // Verify the session works
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Dismiss the country confirmation banner so localStorage is saved in the storage state
    const adminBanner = page.getByRole('heading', { name: /Welcome|Bienvenid/i });
    if (await adminBanner.isVisible({ timeout: 5000 }).catch(() => false)) {
        await page.getByRole('button', { name: /Argentina/ }).click();
        await adminBanner.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
        // Wait for page to stabilize after refresh
        await page.waitForLoadState('networkidle');
    }
    // Also force-set localStorage in case banner didn't appear (already confirmed)
    await page.evaluate((email) => {
        localStorage.setItem(`country_confirmed_${email}`, '1');
    }, ADMIN_EMAIL);

    // The admin email should appear in the nav (session is valid)
    await expect(page.getByText('Test Admin')).toBeVisible({ timeout: 15000 });

    // Save the authenticated state for reuse by authed tests
    await page.context().storageState({ path: AUTH_FILE });
});

/**
 * Authenticate as a regular (non-admin) user for general browsing tests.
 * Replaces the insecure anon_user cookie backdoor.
 */
setup('authenticate as user', async ({ page, context }) => {
    const secret = process.env.AUTH_SECRET;
    if (!secret) {
        throw new Error('AUTH_SECRET env var is required for auth setup.');
    }

    const { encode } = await import('next-auth/jwt');

    const token = await encode({
        secret,
        token: {
            email: USER_EMAIL,
            name: 'Test User',
            sub: 'test-user-id',
            sessionVersion: 3,
        },
        salt: 'authjs.session-token',
    });

    await context.addCookies([{
        name: 'authjs.session-token',
        value: token,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
    }]);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Dismiss the country confirmation banner so localStorage is saved in the storage state
    const userBanner = page.getByRole('heading', { name: /Welcome|Bienvenid/i });
    if (await userBanner.isVisible({ timeout: 5000 }).catch(() => false)) {
        await page.getByRole('button', { name: /Argentina/ }).click();
        await userBanner.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
        await page.waitForLoadState('networkidle');
    }
    // Also force-set localStorage in case banner didn't appear
    await page.evaluate((email) => {
        localStorage.setItem(`country_confirmed_${email}`, '1');
    }, USER_EMAIL);

    // Non-admin users don't have their name displayed prominently.
    // Verify the session is valid: search input visible (requires auth).
    await expect(page.locator('input#search')).toBeVisible({ timeout: 15000 });

    await page.context().storageState({ path: USER_AUTH_FILE });
});

