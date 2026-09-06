import { test, expect, Page } from '@playwright/test';
import { execSync } from 'child_process';
import { createHmac } from 'crypto';
import fs from 'fs';
import path from 'path';
import { dismissCountryBanner } from './helpers';

/**
 * Email OTP login flow (ENABLE_EMAIL_OTP is seeded 'true' in tests/seed.sql).
 *
 * The test env has no RESEND_API_KEY, so requestEmailOtp's dev fallback skips
 * the actual send but still inserts the code row (with a random code). Codes
 * are stored as HMAC-SHA-256(AUTH_SECRET) — the same AUTH_SECRET the JWT
 * setup already requires — so the test overwrites the stored hash with the
 * hash of a KNOWN code and types that. No prod-facing test hooks needed.
 *
 * DB writes go through the sqlite3 CLI, not better-sqlite3 (which doesn't
 * build on Node 26), against BOTH local DBs: next dev serves miniflare D1
 * (.wrangler state) when the dev platform is up and falls back to local.db
 * otherwise — the two drift independently.
 */

const KNOWN_CODE = '123456';

// Each run uses fresh emails: the issuance rate limit is per-email (60s min
// gap), and dedicated fixtures keep seed data untouched for other specs.
const uid = Date.now().toString(36);

function localDbPaths(): string[] {
    const paths = [path.resolve(__dirname, '../local.db')];
    const wranglerDir = path.resolve(__dirname, '../.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
    if (fs.existsSync(wranglerDir)) {
        for (const f of fs.readdirSync(wranglerDir)) {
            if (f.endsWith('.sqlite')) paths.push(path.join(wranglerDir, f));
        }
    }
    return paths.filter(p => fs.existsSync(p));
}

function overwriteCodeHash(email: string, code: string) {
    const secret = process.env.AUTH_SECRET;
    if (!secret) throw new Error('AUTH_SECRET env var is required (see auth.setup.ts)');
    const hash = createHmac('sha256', secret).update(code).digest('hex');
    for (const db of localDbPaths()) {
        execSync(`sqlite3 "${db}" "UPDATE email_otp_codes SET code_hash='${hash}' WHERE email='${email}';"`);
    }
}

async function openLoginModal(page: Page) {
    await page.goto('/');
    await dismissCountryBanner(page);
    await page.getByRole('button', { name: /sign in|iniciar sesión/i }).first().click();
    await expect(page.getByTestId('otp-email-input')).toBeVisible({ timeout: 15000 });
}

async function requestCode(page: Page, email: string) {
    await page.getByTestId('otp-email-input').fill(email);
    await page.getByTestId('otp-send-btn').click();
    // Step switch = the server action succeeded and the code row exists.
    await expect(page.getByTestId('otp-code-input')).toBeVisible({ timeout: 15000 });
}

test.describe('Email OTP login', () => {
    test.setTimeout(60000);

    test('signs in with the emailed code and creates a session', async ({ page }) => {
        const email = `otp-e2e-${uid}-ok@example.com`;
        await openLoginModal(page);
        await requestCode(page, email);

        overwriteCodeHash(email, KNOWN_CODE);
        await page.getByTestId('otp-code-input').fill(KNOWN_CODE);
        await page.getByTestId('otp-verify-btn').click();

        // signIn(redirect: false) sets the cookie from a fetch, then the form
        // reloads via location.assign — navigating before that reload lands
        // aborts the goto. The nav sign-in button disappearing is the signal
        // that the reload rendered with a session. 30s: the first /api/auth
        // hit after a fresh boot pays next dev's on-demand route compile.
        await expect(page.getByRole('button', { name: /sign in|iniciar sesión/i }))
            .toHaveCount(0, { timeout: 30000 });

        // A protected route now loads instead of bouncing home.
        await page.goto('/settings');
        await expect(page).toHaveURL(/\/settings/, { timeout: 30000 });
    });

    test('rejects a wrong code and stays signed out', async ({ page }) => {
        const email = `otp-e2e-${uid}-bad@example.com`;
        await openLoginModal(page);
        await requestCode(page, email);

        overwriteCodeHash(email, KNOWN_CODE);
        await page.getByTestId('otp-code-input').fill('654321');
        await page.getByTestId('otp-verify-btn').click();

        await expect(page.getByRole('alert')).toBeVisible({ timeout: 15000 });

        // Still unauthenticated: the protected route bounces home (middleware
        // adds ?authRequired=true, which HomeClient strips after opening the
        // modal — so assert the path, not the transient query).
        await page.goto('/settings');
        await page.waitForURL(u => !u.pathname.startsWith('/settings'), { timeout: 30000 });
    });
});
