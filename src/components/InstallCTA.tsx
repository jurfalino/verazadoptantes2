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

    // Don't show if installed
    if (isInstalled) return null;

    // Don't show on desktop browsers that don't support install
    if (!isIOS && !installPrompt) return null;

    const benefits = [
        { icon: '📤', text: t('pwa.ctaBenefitShare') || 'Share profiles directly from other apps' },
        { icon: '⚡', text: t('pwa.ctaBenefitSpeed') || 'One tap access — no browser needed' },
        { icon: '🏠', text: t('pwa.ctaBenefitHomeScreen') || 'Always on your home screen, like a native app' },
    ];

    return (
        <div className="mt-10 mx-auto max-w-md">
            <div className="rounded-2xl p-5 text-center" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
                <div className="text-2xl mb-2">🐾</div>
                <h3 className="text-sm font-bold" style={{ color: 'var(--foreground)' }}>
                    {t('pwa.ctaTitle') || 'Get the BuenAdoptante App'}
                </h3>
                <p className="text-xs mt-1 mb-4" style={{ color: 'var(--muted-foreground)' }}>
                    {t('pwa.ctaSubtitle') || 'Install it in seconds — no app store required'}
                </p>

                {/* Benefits */}
                <div className="space-y-2 mb-4 text-left">
                    {benefits.map((b, i) => (
                        <div key={i} className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg" style={{ background: 'var(--muted)' }}>
                            <span className="text-base">{b.icon}</span>
                            <span className="text-xs" style={{ color: 'var(--foreground)' }}>{b.text}</span>
                        </div>
                    ))}
                </div>

                {/* Action */}
                {isIOS ? (
                    <p className="text-xs rounded-lg px-3 py-2" style={{ color: 'var(--muted-foreground)', background: 'var(--muted)' }}>
                        {t('pwa.ctaIOSHint') || 'Tap'} <span className="inline-flex items-center align-middle mx-0.5"><svg className="w-4 h-4" fill="none" stroke="var(--primary)" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg></span> {t('pwa.ctaIOSAction') || 'then "Add to Home Screen"'}
                    </p>
                ) : (
                    <button
                        onClick={handleInstall}
                        className="w-full py-2.5 font-semibold text-sm rounded-xl active:scale-[0.98] transition-all shadow-sm"
                        style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                    >
                        {t('pwa.ctaInstallButton') || 'Install App'}
                    </button>
                )}
            </div>
        </div>
    );
}

