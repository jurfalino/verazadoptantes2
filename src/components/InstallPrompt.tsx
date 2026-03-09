'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';

interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function InstallPrompt() {
    const { t } = useLanguage();
    const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [isVisible, setIsVisible] = useState(false);
    const [isInstalled, setIsInstalled] = useState(false);

    useEffect(() => {
        // Check if already installed (standalone mode)
        if (window.matchMedia('(display-mode: standalone)').matches) {
            setIsInstalled(true);
            return;
        }

        // Check if user dismissed recently
        const dismissed = localStorage.getItem('pwa-install-dismissed');
        if (dismissed) {
            const dismissedAt = parseInt(dismissed, 10);
            const sevenDays = 7 * 24 * 60 * 60 * 1000;
            if (Date.now() - dismissedAt < sevenDays) return;
        }

        const handler = (e: Event) => {
            e.preventDefault();
            setInstallPrompt(e as BeforeInstallPromptEvent);
            setIsVisible(true);
        };

        window.addEventListener('beforeinstallprompt', handler);

        return () => window.removeEventListener('beforeinstallprompt', handler);
    }, []);

    const handleInstall = async () => {
        if (!installPrompt) return;
        await installPrompt.prompt();
        const { outcome } = await installPrompt.userChoice;
        if (outcome === 'accepted') {
            setIsInstalled(true);
        }
        setIsVisible(false);
        setInstallPrompt(null);
    };

    const handleDismiss = () => {
        setIsVisible(false);
        localStorage.setItem('pwa-install-dismissed', Date.now().toString());
    };

    if (!isVisible || isInstalled) return null;

    return (
        <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md animate-slide-up">
            <div className="bg-stone-900 text-white rounded-2xl shadow-2xl p-4 flex items-center gap-3">
                <div className="w-10 h-10 bg-stone-700 rounded-xl flex items-center justify-center text-lg shrink-0">
                    🐾
                </div>
                <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">
                        {t('pwa.installTitle') || 'Install BuenAdoptante'}
                    </p>
                    <p className="text-stone-500 text-xs mt-0.5">
                        {t('pwa.installMessage') || 'Quick access from your home screen'}
                    </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <button
                        onClick={handleDismiss}
                        className="text-stone-500 hover:text-stone-300 text-xs px-2 py-1 transition-colors"
                    >
                        {t('pwa.dismiss') || 'Later'}
                    </button>
                    <button
                        onClick={handleInstall}
                        className="bg-white text-stone-900 font-semibold text-xs px-3 py-1.5 rounded-lg hover:bg-stone-100 transition-colors"
                    >
                        {t('pwa.installButton') || 'Install'}
                    </button>
                </div>
            </div>
        </div>
    );
}
