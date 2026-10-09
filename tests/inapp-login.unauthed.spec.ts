import { test, expect, Page } from '@playwright/test';
import { dismissCountryBanner } from './helpers';

/**
 * Sign-in from Instagram/Facebook in-app browsers, where Google refuses OAuth
 * (src/domain/inAppBrowser.ts, src/lib/googleSignIn.ts,
 * src/components/LoginHandoffReceiver.tsx).
 *
 * The in-app browser is simulated with its real user agent. Desktop Chromium
 * cannot follow an Android `intent://` URL, so the "Chrome opens" half of the
 * hand-off is covered by visiting the marked URL directly — exactly what
 * Chrome receives. Whether Instagram's browser actually lets the intent
 * through can only be checked on a phone.
 */

const UA = {
    instagramAndroid: 'Mozilla/5.0 (Linux; Android 14; LLY-LX3 Build/HONORLLY-L33; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/154.0.8037.61 Mobile Safari/537.36 Instagram 449.0.0.52.84 Android (34/14; 480dpi; 1080x2412; HONOR; LLY-LX3; HNLLY-Q; qcom; es_AR; 1079242191; IABMV/1)',
    instagramIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/24A437 Instagram 448.0.0.39.66 (iPhone18,1; iOS 27_0; es_LA; es; scale=3.00; 1206x2622; IABMV/1; 1072661960) Safari/604.1',
};

async function openLoginModal(page: Page) {
    await page.goto('/');
    await dismissCountryBanner(page);
    await page.getByRole('button', { name: /sign in|iniciar sesión/i }).first().click();
}

/** Records whether the app tried to send the browser to Google. */
async function watchGoogle(page: Page) {
    const seen = { google: false };
    await page.route('https://accounts.google.com/**', (route) => {
        seen.google = true;
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>google stub</p>' });
    });
    return seen;
}

test.describe('In-app browser sign-in', () => {
    test.setTimeout(60000);

    test.describe('Instagram on Android', () => {
        test.use({ userAgent: UA.instagramAndroid });

        test('Google button says it opens Chrome, and never goes to Google in-app', async ({ page }) => {
            const seen = await watchGoogle(page);
            await openLoginModal(page);
            await expect(page.getByTestId('login-opens-in-chrome')).toBeVisible({ timeout: 15000 });
            // Google is still the first choice here; the email code stays folded.
            await expect(page.getByTestId('login-email-first')).toHaveCount(0);

            await page.getByRole('button', { name: /continue with google|continuar con google/i }).click();

            // Desktop Chromium ignores the intent, which is the "Instagram
            // swallowed it" case: the email code takes over.
            await expect(page.getByTestId('login-email-first')).toBeVisible({ timeout: 10000 });
            await expect(page.getByText(/couldn't open Chrome|No pudimos abrir Chrome/i)).toBeVisible();
            await expect(page.getByTestId('otp-email-input')).toBeVisible();
            expect(seen.google).toBe(false);
        });

        test('a marked URL opened in-app shows the email code, never Google (no loop)', async ({ page }) => {
            const seen = await watchGoogle(page);
            await page.goto(`/?q=Mechi&login=google.${Date.now()}`);
            await expect(page.getByTestId('login-email-first')).toBeVisible({ timeout: 15000 });
            await expect(page).toHaveURL(/\/\?q=Mechi$/);
            expect(seen.google).toBe(false);
        });
    });

    test.describe('Instagram on iPhone', () => {
        test.use({ userAgent: UA.instagramIos });

        test('leads with the email code, Google still offered', async ({ page }) => {
            await openLoginModal(page);
            await expect(page.getByTestId('login-email-first')).toBeVisible({ timeout: 15000 });
            await expect(page.getByText(/from Instagram|Desde Instagram/i)).toBeVisible();
            await expect(page.getByTestId('otp-email-input')).toBeVisible();
            await expect(page.getByRole('button', { name: /continue with google|continuar con google/i })).toBeVisible();
            await expect(page.getByTestId('otp-reveal-btn')).toHaveCount(0);
        });
    });

    test.describe('Chrome receiving the hand-off', () => {
        test('a fresh google marker starts Google sign-in, returning to the same page', async ({ page }) => {
            const seen = await watchGoogle(page);
            const googleRequest = page.waitForRequest('https://accounts.google.com/**', { timeout: 20000 });
            await page.goto(`/?q=Mechi&login=google.${Date.now()}`);
            await googleRequest;
            await expect.poll(() => seen.google).toBe(true);
            // The callback carries the clean return path, without the marker.
            const cookies = await page.context().cookies();
            const callback = cookies.find(c => c.name.endsWith('authjs.callback-url'));
            expect(decodeURIComponent(callback?.value ?? '')).toMatch(/\/\?q=Mechi$/);
        });

        test('a stale marker (shared link) is stripped and does nothing', async ({ page }) => {
            const seen = await watchGoogle(page);
            await page.goto(`/?q=Mechi&login=google.${Date.now() - 10 * 60 * 1000}`);
            await expect(page).toHaveURL(/\/\?q=Mechi$/, { timeout: 15000 });
            await page.waitForTimeout(1500);
            expect(seen.google).toBe(false);
            await expect(page.getByTestId('login-email-first')).toHaveCount(0);
        });

        test('the email marker (intent fallback) opens the email code first', async ({ page }) => {
            await page.goto(`/?login=email.${Date.now()}`);
            await expect(page.getByTestId('login-email-first')).toBeVisible({ timeout: 15000 });
            await expect(page).toHaveURL(/\/$/);
        });
    });

    test.describe('Email code survives a reload', () => {
        test.use({ userAgent: UA.instagramIos });

        test('reopens on the code step after the in-app browser reloads', async ({ page }) => {
            const email = `inapp-e2e-${Date.now().toString(36)}@example.com`;
            await openLoginModal(page);
            await page.getByTestId('otp-email-input').fill(email);
            await page.getByTestId('otp-send-btn').click();
            await expect(page.getByTestId('otp-code-input')).toBeVisible({ timeout: 15000 });

            await page.reload();
            await expect(page.getByTestId('otp-code-input')).toBeVisible({ timeout: 15000 });
            await expect(page.getByText(email)).toBeVisible();

            // Closing abandons it: the next reload stays closed.
            await page.locator('.fixed.inset-0 button').first().click();
            await page.reload();
            await page.waitForTimeout(1500);
            await expect(page.getByTestId('otp-code-input')).toHaveCount(0);
        });
    });
});
