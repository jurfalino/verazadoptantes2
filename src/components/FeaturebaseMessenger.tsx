'use client';

/**
 * Featurebase messenger — the async inbox.
 *
 * Mounted once at the root layout, gated by ENABLE_FEATUREBASE, signed-in
 * users only. Unlike ChatWidget this is not live chat: a rescuer leaves a
 * message and the reply arrives whenever the admin gets to it, in the
 * Featurebase mobile app.
 *
 * WHY THIS TALKS TO window.Featurebase INSTEAD OF THE featurebase-js WRAPPER
 * (v2.56.39):
 *
 * A rejected identity token does NOT degrade to an anonymous session — it
 * kills the widget outright. `/v1/messenger/widget/config` answers 401, the
 * SDK logs "Identity verification is enabled, but the provided userHash is
 * invalid", and nothing renders. Verified in a browser harness: a valid or
 * absent token yields 14 Featurebase DOM nodes and a launcher, a rejected one
 * yields 1 node and no iframe.
 *
 * That is not a rare edge case. Featurebase refuses SSO tokens for anyone who
 * administers a Featurebase organization, so the workspace owner — the person
 * most likely to be testing — is permanently in it, with nothing in the UI
 * saying why.
 *
 * The wrapper's `boot()` hides the error and its `whenReady()` fires even when
 * the boot failed (it flushes ready in the same callback that logs the error),
 * so neither can drive a fallback. The raw `boot` action takes a callback that
 * does receive the error, so we use that: boot with the token, and if it comes
 * back with an error, shut down and boot again without it.
 *
 * `shutdown` before the retry is required — the SDK turns a repeat boot for an
 * appId it thinks is already booted into an `identify`, which would re-send the
 * same rejected token.
 *
 * Identity is best-effort. Being able to reach support is not.
 *
 * The appId is not a secret: it ships in client JS by design and only names
 * the public workspace.
 */

import { useEffect, useRef } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useTheme } from '@/context/ThemeContext';
import { reportClientError } from '@/lib/clientErrorReporter';

const FEATUREBASE_APP_ID = '6aa0a4e554afb669a1baaf73';
const SDK_SRC = 'https://do.featurebase.app/js/sdk.js';
const SDK_SCRIPT_ID = 'featurebase-sdk';

type FeaturebaseSettings = Record<string, unknown>;
type FeaturebaseGlobal = (
    action: string,
    settings?: FeaturebaseSettings,
    callback?: (error?: unknown) => void,
) => void;

declare global {
    interface Window { Featurebase?: FeaturebaseGlobal }
}

/**
 * Resolve once the SDK global is callable, injecting the script if needed.
 *
 * The promise is module-level on purpose. An earlier version attached a `load`
 * listener to whatever script tag it found, which hangs forever on the second
 * call because that event has already fired — no error, no log, just a promise
 * that never settles and a messenger that never boots. Caching the promise
 * makes every later caller resolve immediately.
 */
let sdkPromise: Promise<FeaturebaseGlobal> | null = null;

function loadSdk(): Promise<FeaturebaseGlobal> {
    if (typeof window.Featurebase === 'function') return Promise.resolve(window.Featurebase);
    if (sdkPromise) return sdkPromise;

    sdkPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.id = SDK_SCRIPT_ID;
        script.src = SDK_SRC;
        script.async = true;
        script.addEventListener('load', () => {
            if (typeof window.Featurebase === 'function') resolve(window.Featurebase);
            else reject(new Error('Featurebase SDK loaded but window.Featurebase is not callable'));
        }, { once: true });
        script.addEventListener('error', () => {
            sdkPromise = null; // let a later mount retry the fetch
            reject(new Error('Featurebase SDK failed to load'));
        }, { once: true });
        document.head.appendChild(script);
    });
    return sdkPromise;
}

export default function FeaturebaseMessenger({ jwt }: { jwt: string | null }) {
    const { locale } = useLanguage();
    const { theme } = useTheme();

    // Read inside the boot effect without being dependencies of it. Both
    // providers hydrate from localStorage right after mount, so including them
    // would tear the messenger down and rebuild it moments after it appears —
    // and the SDK has a boot-loop backoff that eventually stops booting
    // altogether. Theme and language changes are pushed with their own actions
    // below instead.
    const themeRef = useRef(theme);
    const localeRef = useRef(locale);
    themeRef.current = theme;
    localeRef.current = locale;

    useEffect(() => {
        let cancelled = false;
        const base = { appId: FEATUREBASE_APP_ID, theme: themeRef.current, language: localeRef.current };

        // Unconditional, because the failure this integration keeps hitting is
        // "nothing rendered and nothing said why". If this line is absent from
        // the console the component never mounted, which points at the layout
        // gate or a stale bundle rather than at the SDK.
        console.info('[featurebase] mounting', { jwt: jwt ? 'present' : 'absent', locale: localeRef.current, theme: themeRef.current });

        loadSdk()
            .then((fb) => {
                if (cancelled) return;
                if (!jwt) {
                    fb('boot', base);
                    return;
                }
                fb('boot', { ...base, featurebaseJwt: jwt }, (error) => {
                    if (cancelled || !error) return;
                    // Identity refused. Keep support reachable: drop the token
                    // and boot an anonymous session instead of leaving an empty
                    // corner the user cannot diagnose.
                    console.warn('[featurebase] identity rejected, retrying anonymously:', error);
                    try {
                        fb('shutdown');
                        fb('boot', base);
                    } catch (e) {
                        console.warn('[featurebase] anonymous retry failed', e);
                    }
                    void reportClientError({
                        message: 'Featurebase identity rejected — messenger fell back to anonymous',
                        source: 'FeaturebaseMessenger',
                        level: 'warn',
                        extra: {
                            appId: FEATUREBASE_APP_ID,
                            reason: error instanceof Error ? error.message : String(error),
                        },
                    });
                });
            })
            .catch((e) => {
                console.warn('[featurebase] SDK load failed', e);
                void reportClientError({
                    message: 'Featurebase SDK failed to load',
                    source: 'FeaturebaseMessenger',
                    level: 'warn',
                    extra: { src: SDK_SRC, reason: e instanceof Error ? e.message : String(e) },
                });
            });

        // Deliberately does NOT shut the messenger down. Harness result: after a
        // SUCCESSFUL boot, `shutdown` followed by `boot` leaves the widget dead
        // — 1 DOM node, no iframe, no error. The teardown is deferred inside the
        // SDK and lands on top of the fresh boot. The messenger is a
        // page-lifetime singleton, and signing out is a full navigation, so
        // there is nothing here worth risking that race for.
        //
        // The identity-rejected path below is the one exception, and it is safe
        // precisely because that boot never succeeded.
        return () => { cancelled = true; };
    }, [jwt]);

    // Theme and language are pushed as their own actions rather than re-booting.
    useEffect(() => {
        try { window.Featurebase?.('setTheme', { theme }); } catch { /* not booted yet */ }
    }, [theme]);

    // setLanguage takes the code itself, not a settings object — the object form
    // throws. Verified in the harness.
    useEffect(() => {
        try { window.Featurebase?.('setLanguage', locale as unknown as FeaturebaseSettings); } catch { /* not booted yet */ }
    }, [locale]);

    return null;
}
