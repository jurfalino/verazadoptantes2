/**
 * Which language this browser last told the server for a signed-in person, so
 * LanguageContext saves it (saveMyLocale) only when it differs — not on every
 * page load. Per-viewer convenience in localStorage, keyed by the person's
 * email; every access is guarded (private windows, blocked storage): when
 * storage is unavailable the answer is "push", and the server skips an
 * unchanged value anyway.
 */

type MarkerStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

const PREFIX = 'app-locale-pushed:';

const keyFor = (email: string) => `${PREFIX}${email.trim().toLowerCase()}`;

function storage(s?: MarkerStorage | null): MarkerStorage | null {
    if (s !== undefined) return s;
    try {
        return typeof window === 'undefined' ? null : window.localStorage;
    } catch {
        return null;
    }
}

/** True unless `locale` is what was last pushed for `email` from this browser. */
export function shouldPushLocale(email: string, locale: string, s?: MarkerStorage | null): boolean {
    const st = storage(s);
    if (!st || !email) return true;
    try {
        return st.getItem(keyFor(email)) !== locale;
    } catch {
        return true;
    }
}

/** Record that the server now has `locale` for `email`. */
export function rememberPushedLocale(email: string, locale: string, s?: MarkerStorage | null): void {
    const st = storage(s);
    if (!st || !email) return;
    try {
        st.setItem(keyFor(email), locale);
    } catch {
        // Storage full or blocked: the next load simply pushes again.
    }
}

/** Forget it (sign-out, or another person signed in): their next session pushes once. */
export function forgetPushedLocale(email: string, s?: MarkerStorage | null): void {
    const st = storage(s);
    if (!st || !email) return;
    try {
        st.removeItem(keyFor(email));
    } catch {
        // Blocked storage: nothing was remembered either.
    }
}

/**
 * Forget every person's marker. Signed out (sign-out redirects, so the
 * provider never sees the email change; and a shared machine should not keep
 * the email in a key): whoever signs in next pushes once.
 */
export function forgetAllPushedLocales(s?: MarkerStorage | null): void {
    const st = storage(s);
    if (!st) return;
    try {
        const keys: string[] = [];
        for (let i = 0; i < st.length; i++) {
            const k = st.key(i);
            if (k && k.startsWith(PREFIX)) keys.push(k);
        }
        for (const k of keys) st.removeItem(k);
    } catch {
        // Blocked storage: nothing was remembered either.
    }
}
