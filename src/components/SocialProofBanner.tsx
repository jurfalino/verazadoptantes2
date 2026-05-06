'use client';

import { useState, useEffect } from 'react';
import { useLanguage } from '@/context/LanguageContext';

interface SocialProofMessage {
    city: string;
    count: number;
    period: string;
}

export default function SocialProofBanner({ config }: { config?: Record<string, string> }) {
    const { t } = useLanguage();
    const [currentIdx, setCurrentIdx] = useState(0);
    const [visible, setVisible] = useState(false);
    const [fading, setFading] = useState(false);

    const messages: SocialProofMessage[] = (() => {
        try {
            if (!config?.SOCIAL_PROOF_MESSAGES) return [];
            return JSON.parse(config.SOCIAL_PROOF_MESSAGES);
        } catch { return []; }
    })();

    const enabled = config?.SOCIAL_PROOF_ENABLED === 'true' && messages.length > 0;

    useEffect(() => {
        if (!enabled) return;
        // 24-hour cooldown
        const dismissed = localStorage.getItem('social_proof_dismissed');
        if (dismissed && Date.now() - parseInt(dismissed) < 86400000) return;
        setVisible(true);
    }, [enabled]);

    // Rotate every 8 seconds
    useEffect(() => {
        if (!visible || messages.length <= 1) return;
        const interval = setInterval(() => {
            setFading(true);
            setTimeout(() => {
                setCurrentIdx(prev => (prev + 1) % messages.length);
                setFading(false);
            }, 300);
        }, 8000);
        return () => clearInterval(interval);
    }, [visible, messages.length]);

    if (!enabled || !visible || messages.length === 0) return null;

    const msg = messages[currentIdx];

    const dismiss = () => {
        setVisible(false);
        localStorage.setItem('social_proof_dismissed', Date.now().toString());
    };

    return (
        <div className="social-proof-banner animate-slideDown">
            <p className={`social-proof-text ${fading ? 'social-proof-fade' : ''}`}>
                <svg className="social-proof-icon" width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>
                {t('social_proof.prefix')} {msg.city} {t('social_proof.registered')} {msg.count} {t('social_proof.adoptions')} {msg.period}
            </p>
            <button
                onClick={dismiss}
                className="social-proof-dismiss"
                aria-label={t('nav.dismiss')}
            >
                ✕
            </button>

            <style>{`
                .social-proof-banner {
                    background: var(--accent-subtle-bg);
                    border: 1px solid var(--border-accent);
                    border-radius: 0.75rem;
                    padding: 0.75rem 1rem;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 0.75rem;
                }
                .social-proof-text {
                    font-size: 0.875rem;
                    color: var(--accent-heading);
                    font-weight: 500;
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    margin: 0;
                    transition: opacity 0.3s;
                }
                .social-proof-fade { opacity: 0; }
                .social-proof-icon { flex-shrink: 0; color: var(--accent-heading); }
                .social-proof-dismiss {
                    color: var(--text-faint);
                    font-size: 0.75rem;
                    flex-shrink: 0;
                    background: none;
                    border: none;
                    cursor: pointer;
                    transition: color 0.2s;
                }
                .social-proof-dismiss:hover { color: var(--text-secondary); }
            `}</style>
        </div>
    );
}
