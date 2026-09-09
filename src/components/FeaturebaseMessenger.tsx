'use client';

/**
 * Featurebase messenger — the async inbox.
 *
 * Mounted once at the root layout, gated by ENABLE_FEATUREBASE and rendered
 * only for signed-in rescuers. Unlike ChatWidget this is not live chat: a
 * rescuer leaves a message and the reply arrives whenever the admin gets to it,
 * in the Featurebase Android app.
 *
 * The SDK injects https://do.featurebase.app/js/sdk.js itself and resolves the
 * appId against do.featurebase.app before booting, so BOTH hosts have to be in
 * the CSP (see next.config.ts) or the widget silently never appears.
 *
 * Identity comes from the server-signed JWT built in src/lib/featurebaseJwt.ts.
 * A null jwt is a supported state — the messenger still boots, anonymously —
 * which is what happens before FEATUREBASE_JWT_SECRET is set, and for the
 * account that owns the Featurebase org (their SSO refuses org admins).
 *
 * The appId is not a secret: it ships in client JS by design and only names the
 * public workspace.
 */

import { FeaturebaseProvider } from 'featurebase-js/react';
import { useLanguage } from '@/context/LanguageContext';
import { useTheme } from '@/context/ThemeContext';

const FEATUREBASE_APP_ID = '6aa0a4e554afb669a1baaf73';

export default function FeaturebaseMessenger({ jwt }: { jwt: string | null }) {
    const { locale } = useLanguage();
    const { theme } = useTheme();

    return (
        <FeaturebaseProvider
            appId={FEATUREBASE_APP_ID}
            featurebaseJwt={jwt ?? undefined}
            language={locale}
            theme={theme}
        >
            {null}
        </FeaturebaseProvider>
    );
}
