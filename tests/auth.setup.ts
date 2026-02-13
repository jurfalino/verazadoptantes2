import { test as setup, expect } from '@playwright/test';
import { encode } from 'next-auth/jwt';

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
    await expect(page.getByText('Test User')).toBeVisible({ timeout: 15000 });

    await page.context().storageState({ path: USER_AUTH_FILE });
});

