/**
 * In-app browser detection and the Google sign-in hand-off to Chrome.
 *
 * Google refuses OAuth inside embedded browsers ("Error 403:
 * disallowed_useragent"), so a visitor who opens BuenAdoptante from an
 * Instagram or Facebook link and taps "Continuar con Google" is stopped on
 * Google's side — nothing reaches our server. On Android we can reopen the
 * page in Chrome with an `intent://` URL and let Chrome start the sign-in; the
 * jump has to happen BEFORE `signIn()`, because signIn sets the PKCE/state
 * cookies in whichever browser calls it (starting in the in-app browser and
 * finishing in Chrome is exactly the `pkceCodeVerifier missing` failure).
 *
 * Chrome learns it should start the sign-in from a short-lived marker in the
 * URL (`?login=google.<ms>`). The timestamp keeps a copied or shared link from
 * bouncing whoever opens it later to Google. Chrome reopens the page the
 * visitor is ON (always public); where to land after sign-in, when that is a
 * different, members-only page, travels separately in `login_next` — opening
 * the members-only page directly would bounce through the auth redirect and
 * lose the marker.
 *
 * Pure functions only — the browser side lives in src/lib/googleSignIn.ts.
 */

export type InAppApp = 'instagram' | 'facebook' | 'messenger' | 'threads' | 'tiktok' | 'linkedin' | 'snapchat' | 'webview';
export type DeviceOs = 'android' | 'ios' | 'other';

export interface BrowserEnv {
    /** Which app's embedded browser this is; null in a real browser. */
    inApp: InAppApp | null;
    os: DeviceOs;
}

// Order matters: Messenger and Threads ride on Facebook's in-app browser and
// carry its tokens too, so they are matched before the generic Facebook one.
const APP_PATTERNS: ReadonlyArray<[InAppApp, RegExp]> = [
    ['instagram', /\bInstagram\b/],
    ['messenger', /FB_IAB\/(?:Orca|MESSENGER)|\bMessenger(?:ForiOS|Lite)?\b/i],
    ['threads', /\bBarcelona\b/],
    ['facebook', /FBAN\/|FBAV\/|FB_IAB\/|\bFBIOS\b/],
    ['tiktok', /musical_ly|BytedanceWebview|\bTikTok\b/i],
    ['linkedin', /LinkedInApp/],
    ['snapchat', /Snapchat/],
];

export function detectBrowserEnv(userAgent: string): BrowserEnv {
    const ua = userAgent || '';
    const os: DeviceOs = /Android/i.test(ua) ? 'android' : /iPhone|iPad|iPod/.test(ua) ? 'ios' : 'other';
    for (const [app, pattern] of APP_PATTERNS) {
        if (pattern.test(ua)) return { inApp: app, os };
    }
    // Any other Android WebView. Real Chrome, Samsung Internet and Chrome
    // Custom Tabs (what WhatsApp and Gmail open links in) carry neither the
    // `; wv)` flag nor the legacy `Version/4.0` token. iOS gets no generic
    // rule: a home-screen web app's UA looks like an embedded one there.
    if (os === 'android' && (/; wv\)/.test(ua) || /Version\/4\.0 Chrome\//.test(ua))) {
        return { inApp: 'webview', os };
    }
    return { inApp: null, os };
}

/** Name to show the visitor ("Desde Instagram…"); null for an unnamed webview. */
export function inAppDisplayName(app: InAppApp | null): string | null {
    switch (app) {
        case 'instagram': return 'Instagram';
        case 'facebook': return 'Facebook';
        case 'messenger': return 'Messenger';
        case 'threads': return 'Threads';
        case 'tiktok': return 'TikTok';
        case 'linkedin': return 'LinkedIn';
        case 'snapchat': return 'Snapchat';
        default: return null;
    }
}

export const LOGIN_HANDOFF_PARAM = 'login';
export const LOGIN_NEXT_PARAM = 'login_next';
/** How long a hand-off marker stays valid — long enough for Chrome to open. */
export const LOGIN_HANDOFF_TTL_MS = 2 * 60 * 1000;

/**
 * - `google`: Chrome should start Google sign-in right away.
 * - `email`: the jump to Chrome failed and the in-app browser came back
 *   (intent fallback) — open the login box with the email code first.
 */
export type LoginHandoff = 'google' | 'email';

export function buildHandoffMarker(kind: LoginHandoff, now: number): string {
    return `${kind}.${now}`;
}

/** The hand-off a marker asks for, or null when it is malformed or stale. */
export function parseHandoffMarker(raw: string | null | undefined, now: number): LoginHandoff | null {
    const m = /^(google|email)\.(\d{10,16})$/.exec(raw ?? '');
    if (!m) return null;
    const age = now - Number(m[2]);
    // A little negative age tolerates clock jitter; same device, same clock.
    if (age < -5_000 || age > LOGIN_HANDOFF_TTL_MS) return null;
    return m[1] as LoginHandoff;
}

/**
 * `path` with the marker set — used for both the intent and its fallback.
 * `next` (where to land after sign-in) is added only when it differs.
 */
export function withHandoffMarker(path: string, kind: LoginHandoff, now: number, next?: string): string {
    const url = new URL(path, 'https://placeholder.invalid');
    url.searchParams.set(LOGIN_HANDOFF_PARAM, buildHandoffMarker(kind, now));
    const page = withoutHandoffMarker(path);
    if (next && withoutHandoffMarker(next) !== page) url.searchParams.set(LOGIN_NEXT_PARAM, withoutHandoffMarker(next));
    return `${url.pathname}${url.search}`;
}

/**
 * `path` (pathname + query) without the hand-off params, in one canonical
 * serialization — so two spellings of the same page compare equal.
 */
export function withoutHandoffMarker(path: string): string {
    const url = new URL(path, 'https://placeholder.invalid');
    url.searchParams.delete(LOGIN_HANDOFF_PARAM);
    url.searchParams.delete(LOGIN_NEXT_PARAM);
    url.searchParams.sort();
    return `${url.pathname}${url.search}`;
}

/** A same-site path to land on after sign-in, or null. Never another origin. */
export function safeNextPath(raw: string | null | undefined): string | null {
    if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
    const url = new URL(raw, 'https://placeholder.invalid');
    if (url.origin !== 'https://placeholder.invalid') return null;
    return withoutHandoffMarker(`${url.pathname}${url.search}`);
}

/**
 * Whether a page load could be Chrome opening our intent. Intents arrive with
 * no referrer (or an android-app:// one); a link on some other website has
 * that site as referrer — and must not be able to start Google for a visitor.
 */
export function isAppHandoffReferrer(referrer: string): boolean {
    return referrer === '' || referrer.startsWith('android-app://');
}

/**
 * Android intent that reopens `origin + path` (the page the visitor is on)
 * in Chrome, carrying the `google` marker and, if different, `next`. If Chrome is not installed the in-app browser follows
 * `S.browser_fallback_url` instead — the same page with the `email` marker,
 * so the visitor lands on the email-code login rather than a dead end.
 */
export function buildChromeIntentUrl(origin: string, path: string, now: number, next?: string): string {
    const host = new URL(origin).host;
    const target = withHandoffMarker(path, 'google', now, next);
    const fallback = `${origin}${withHandoffMarker(path, 'email', now, next)}`;
    return `intent://${host}${target}#Intent;scheme=https;package=com.android.chrome;`
        + `S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
}
