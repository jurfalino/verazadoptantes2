/**
 * Which language this browser last told the server for a signed-in person, so
 * LanguageContext saves it (saveMyLocale) only when it differs — not on every
 * page load. Per-viewer convenience in localStorage, keyed by the person's
 * email; every access is guarded (private windows, blocked storage): when
 * storage is unavailable the answer is "push", and the server skips an
 * unchanged value anyway.
 */

type MarkerStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

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
