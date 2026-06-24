'use client';

import { useLanguage } from '@/context/LanguageContext';
import { useWalkthrough } from './WalkthroughProvider';

/**
 * "Show me how to search" — flag-gated re-launch affordance for the guided
 * walkthrough. Gated on the walkthrough flag ALONE (via context.enabled), never
 * on QuickAccessStrip, so disabling that strip can't hide the tour entrypoint.
 */
export function RelaunchButton() {
    const { t } = useLanguage();
    const { enabled, start } = useWalkthrough();
    if (!enabled) return null;
    return (
        <div className="flex justify-center">
            <button
                type="button"
                onClick={start}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-100 transition-colors"
            >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <circle cx="11" cy="11" r="7" />
                    <path d="M21 21l-4.3-4.3" />
                    <path d="M11 8v.01M11 11v3" />
                </svg>
                {t('walkthrough.relaunch_button')}
            </button>
        </div>
    );
}
