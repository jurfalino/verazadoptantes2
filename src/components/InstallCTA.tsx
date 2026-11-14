'use client';

import { useEffect, useId, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { Modal } from '@/components/ui/Modal';
import { useShowToast } from '@/components/ui/Toast';
import { reportClientError, resolveErrorId } from '@/lib/clientErrorReporter';
import { posthogTrack } from '@/lib/zaraz';
import { installCardEventPlatform, parseDismissedAt, shouldShowInstallCard, type InstallPlatform } from '@/domain/installCard';

/**
 * The home «Instalá la app» card (option C, Jon 2026-11-12): icon, title, one
 * line, «Instalar» + «Ahora no», and a ✕. When it shows lives in
 * domain/installCard.
 *
 * - Android / Chromium (a captured `beforeinstallprompt`): «Instalar» opens the
 *   browser's install dialog; once accepted the card is gone.
 * - iPhone / iPad: no install API — «Instalar» opens the «Agregar a inicio»
 *   steps. The line never promises WhatsApp sharing there (iOS can't receive shares).
 * - «Ahora no» and ✕ hide it on this device for 30 days.
 *
 * Everything is decided after mount (standalone, platform, the stored
 * dismissal): the server and the first client render both render nothing, so
 * no storage read can leave a stale hydration attribute behind.
 *
 * Separate from InstallPrompt (the floating bar behind ENABLE_PWA_INSTALL_PROMPT).
 */

interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** When «Ahora no» / ✕ was last tapped on this device (ms since epoch). */
const DISMISSED_KEY = 'install-card-dismissed-at';

type CardAction = 'install_tap' | 'accepted' | 'dismissed' | 'ios_steps_shown';

/**
 * The primary button: the matrix shape (components/ui/Button) in `--brand-dark`
 * (#0f766e in both themes, 5.47:1 with white; hover teal-800, 7.58:1). The
 * shared primary (bg-teal-600, remapped) measures 3.74:1 light / 2.49:1 dark —
 * under AA, see app/funcionalidades/page.tsx.
 */
const PRIMARY =
    'inline-flex items-center justify-center rounded-xl font-bold text-sm min-h-[44px] px-5 ' +
    'bg-[var(--brand-dark)] text-white hover:bg-teal-800 shadow-sm transition-colors ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-1';

function PhoneDownIcon() {
    return (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="6" y="2" width="12" height="20" rx="2" />
            <path d="M12 7v7M9 11l3 3 3-3" />
        </svg>
    );
}

function ShareIcon({ label }: { label: string }) {
    return (
        <svg className="inline-block w-[18px] h-[18px] -mt-1 mx-0.5 align-middle text-teal-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={label}>
            <path d="M4 12v7a2 2 0 002 2h12a2 2 0 002-2v-7M16 6l-4-4-4 4M12 2v13" />
        </svg>
    );
}

export default function InstallCTA() {
    const { t } = useLanguage();
    const toast = useShowToast();
    const titleId = useId();
    const [mounted, setMounted] = useState(false);
    const [isStandalone, setIsStandalone] = useState(false);
    const [isIOS, setIsIOS] = useState(false);
    const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [dismissedAt, setDismissedAt] = useState<number | null>(null);
    const [installed, setInstalled] = useState(false);
    const [stepsOpen, setStepsOpen] = useState(false);

    useEffect(() => {
        setMounted(true);
        const standalone = window.matchMedia('(display-mode: standalone)').matches
            || (navigator as Navigator & { standalone?: boolean }).standalone === true;
        if (standalone) {
            setIsStandalone(true);
            return;
        }

        let stored: string | null = null;
        // SSR-safe storage read: blocked storage / private mode just means «never dismissed».
        try { stored = window.localStorage.getItem(DISMISSED_KEY); } catch { /* storage unavailable */ }
        setDismissedAt(parseDismissedAt(stored));

        const ua = navigator.userAgent;
        setIsIOS(/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

        const onPrompt = (e: Event) => {
            e.preventDefault();
            setInstallPrompt(e as BeforeInstallPromptEvent);
        };
        const onInstalled = () => setInstalled(true);
        window.addEventListener('beforeinstallprompt', onPrompt);
        window.addEventListener('appinstalled', onInstalled);
        return () => {
            window.removeEventListener('beforeinstallprompt', onPrompt);
            window.removeEventListener('appinstalled', onInstalled);
        };
    }, []);

    const platform: InstallPlatform = isIOS ? 'ios' : installPrompt ? 'installable' : 'none';

    const track = (action: CardAction) => {
        const p = installCardEventPlatform(platform);
        if (p) posthogTrack('install_card_action', { action, platform: p });
    };

    const dismiss = () => {
        const at = Date.now();
        setDismissedAt(at);
        track('dismissed');
        try {
            window.localStorage.setItem(DISMISSED_KEY, String(at));
        } catch (e) {
            // The card still goes away for this visit; it just comes back on the next one.
            void reportClientError({
                message: 'install card: dismissal not saved',
                source: 'InstallCTA',
                level: 'warn',
                extra: { platform, error: e instanceof Error ? e.message : String(e) },
            });
        }
    };

    const install = async () => {
        track('install_tap');
        if (platform === 'ios') {
            setStepsOpen(true);
            track('ios_steps_shown');
            return;
        }
        const prompt = installPrompt;
        if (!prompt) return;
        try {
            await prompt.prompt();
            const { outcome } = await prompt.userChoice;
            if (outcome === 'accepted') {
                track('accepted');
                setInstalled(true);
            }
        } catch (e) {
            toast.error(t('installCard.install_failed'), undefined, resolveErrorId(e, 'InstallCTA'));
        } finally {
            // A captured prompt can be shown only once.
            setInstallPrompt(null);
        }
    };

    const showCard = mounted && !installed && shouldShowInstallCard({ isStandalone, platform, dismissedAt, now: Date.now() });
    const [stepBefore, stepAfter = ''] = t('installCard.ios_step1').split('{share}');

    return (
        <>
            {showCard && (
                <section data-testid="install-card" aria-labelledby={titleId}
                    className="relative bg-white rounded-2xl border border-stone-200 p-4 pr-12 shadow-sm">
                    <div className="flex items-start gap-3">
                        <span className="w-10 h-10 shrink-0 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center">
                            <PhoneDownIcon />
                        </span>
                        <div className="flex-1 min-w-0">
                            <h2 id={titleId} className="text-sm font-bold text-stone-900">{t('installCard.title')}</h2>
                            <p data-testid="install-card-desc" className="mt-0.5 text-xs text-stone-500 leading-snug">
                                {t(platform === 'ios' ? 'installCard.desc_ios' : 'installCard.desc_installable')}
                            </p>
                        </div>
                    </div>
                    {/* pl-13 = the 40px icon tile + the 12px gap: the buttons line up with the text. */}
                    <div className="mt-3 pl-13 flex flex-wrap gap-2">
                        <button type="button" data-testid="install-card-install" onClick={install} className={PRIMARY}>
                            {t('installCard.install')}
                        </button>
                        <button type="button" data-testid="install-card-not-now" onClick={dismiss}
                            className="inline-flex items-center justify-center min-h-[44px] px-3 rounded-xl text-sm font-medium text-stone-600 hover:bg-stone-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
                            {t('installCard.not_now')}
                        </button>
                    </div>
                    <button type="button" data-testid="install-card-close" onClick={dismiss} aria-label={t('common.close')}
                        className="absolute top-1 right-1 w-11 h-11 flex items-center justify-center rounded-xl text-stone-500 hover:bg-stone-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                </section>
            )}
            {stepsOpen && (
                <Modal title={t('installCard.ios_title')} onClose={() => setStepsOpen(false)} placement="sheet" testId="install-card-ios-steps">
                    <ol className="space-y-3">
                        {[
                            <>{stepBefore}<ShareIcon label={t('installCard.ios_share')} />{stepAfter}</>,
                            t('installCard.ios_step2'),
                        ].map((text, i) => (
                            <li key={i} className="flex items-center gap-3 text-sm leading-snug text-stone-900">
                                <span className="w-7 h-7 shrink-0 rounded-full bg-teal-50 text-teal-700 text-[13px] font-bold flex items-center justify-center">{i + 1}</span>
                                <span>{text}</span>
                            </li>
                        ))}
                    </ol>
                    <p className="text-xs text-stone-500 leading-snug">{t('installCard.ios_note')}</p>
                    <button type="button" data-autofocus="" data-testid="install-card-ios-ok" onClick={() => setStepsOpen(false)} className={`${PRIMARY} w-full`}>
                        {t('installCard.ios_ok')}
                    </button>
                </Modal>
            )}
        </>
    );
}
