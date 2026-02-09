'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';

interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function InstallCTA() {
    const { t } = useLanguage();
    const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [isInstalled, setIsInstalled] = useState(false);
    const [isIOS, setIsIOS] = useState(false);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        // Already installed — hide everything
        if (window.matchMedia('(display-mode: standalone)').matches) {
            setIsInstalled(true);
            return;
        }

        // Detect iOS (no beforeinstallprompt support)
        const ua = navigator.userAgent;
        const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        setIsIOS(iOS);

        // CTA dismissed permanently by user
        if (localStorage.getItem('pwa-cta-dismissed') === '1') {
            setDismissed(true);
        }

        // Capture the install prompt for non-iOS
        const handler = (e: Event) => {
            e.preventDefault();
            setInstallPrompt(e as BeforeInstallPromptEvent);
        };
        window.addEventListener('beforeinstallprompt', handler);
        return () => window.removeEventListener('beforeinstallprompt', handler);
    }, []);

    const handleInstall = async () => {
        if (installPrompt) {
            await installPrompt.prompt();
            const { outcome } = await installPrompt.userChoice;
            if (outcome === 'accepted') setIsInstalled(true);
            setInstallPrompt(null);
        }
    };

    const handleDismiss = () => {
        setDismissed(true);
        localStorage.setItem('pwa-cta-dismissed', '1');
    };

    // Don't show if installed or permanently dismissed
    if (isInstalled || dismissed) return null;

    // Don't show on desktop browsers that don't support install
    if (!isIOS && !installPrompt) return null;

    const benefits = [
        { icon: '📤', text: t('pwa.ctaBenefitShare') || 'Share profiles directly from other apps' },
        { icon: '⚡', text: t('pwa.ctaBenefitSpeed') || 'One tap access — no browser needed' },
        { icon: '📶', text: t('pwa.ctaBenefitOffline') || 'Check records even without internet' },
    ];

    return (
        <div className="mt-10 mx-auto max-w-md">
            <div className="relative bg-gradient-to-br from-stone-50 to-stone-100 rounded-2xl border border-stone-200/80 p-5 text-center">
                {/* Dismiss button */}
                <button
                    onClick={handleDismiss}
                    className="absolute top-2.5 right-3 text-stone-300 hover:text-stone-500 text-lg transition-colors"
                    aria-label="Dismiss"
                >
                    ×
                </button>

                <div className="text-2xl mb-2">🐾</div>
                <h3 className="text-sm font-bold text-stone-800">
                    {t('pwa.ctaTitle') || 'Get the BuenAdoptante App'}
                </h3>
                <p className="text-xs text-stone-500 mt-1 mb-4">
                    {t('pwa.ctaSubtitle') || 'Install it in seconds — no app store required'}
                </p>

                {/* Benefits */}
                <div className="space-y-2 mb-4 text-left">
                    {benefits.map((b, i) => (
                        <div key={i} className="flex items-center gap-2.5 px-3 py-1.5 bg-white/70 rounded-lg">
                            <span className="text-base">{b.icon}</span>
                            <span className="text-xs text-stone-700">{b.text}</span>
                        </div>
                    ))}
                </div>

                {/* Action */}
                {isIOS ? (
                    <p className="text-xs text-stone-500 bg-white/70 rounded-lg px-3 py-2">
                        {t('pwa.ctaIOSHint') || 'Tap'} <span className="inline-flex items-center align-middle mx-0.5"><svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg></span> {t('pwa.ctaIOSAction') || 'then "Add to Home Screen"'}
                    </p>
                ) : (
                    <button
                        onClick={handleInstall}
                        className="w-full py-2.5 bg-stone-900 text-white font-semibold text-sm rounded-xl hover:bg-stone-800 active:scale-[0.98] transition-all shadow-sm"
                    >
                        {t('pwa.ctaInstallButton') || 'Install App'}
                    </button>
                )}
            </div>
        </div>
    );
}
