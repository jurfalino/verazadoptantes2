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

import { useEffect } from 'react';
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

/** Resolve once the SDK global is callable, injecting the script if needed. */
function loadSdk(): Promise<FeaturebaseGlobal> {
    return new Promise((resolve, reject) => {
        if (typeof window.Featurebase === 'function') {
            resolve(window.Featurebase);
            return;
        }
        const existing = document.getElementById(SDK_SCRIPT_ID) as HTMLScriptElement | null;
        const script = existing ?? document.createElement('script');
        const onLoad = () => {
            if (typeof window.Featurebase === 'function') resolve(window.Featurebase);
            else reject(new Error('Featurebase SDK loaded but window.Featurebase is not callable'));
        };
        script.addEventListener('load', onLoad, { once: true });
        script.addEventListener('error', () => reject(new Error('Featurebase SDK failed to load')), { once: true });
        if (!existing) {
            script.id = SDK_SCRIPT_ID;
            script.src = SDK_SRC;
            script.async = true;
            document.head.appendChild(script);
        }
    });
}

export default function FeaturebaseMessenger({ jwt }: { jwt: string | null }) {
    const { locale } = useLanguage();
    const { theme } = useTheme();

    useEffect(() => {
        let cancelled = false;
        const base = { appId: FEATUREBASE_APP_ID, theme, language: locale };

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

        return () => {
            cancelled = true;
            try { window.Featurebase?.('shutdown'); } catch { /* SDK never loaded */ }
        };
    }, [jwt, locale, theme]);

    return null;
}
