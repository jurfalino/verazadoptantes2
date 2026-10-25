'use client';

/**
 * «Avisos por email» in /settings: one switch per email category. The
 * 'requests' row is always on (it needs an answer) so it shows a label, never
 * a switch, and is rendered from ALWAYS_ON_CATEGORIES rather than the stored
 * prefs. Toggles are optimistic and revert on failure.
 */

import { useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { getEmailPrefs, saveEmailPref } from '@/app/actions/settings';
import { ALWAYS_ON_CATEGORIES, isEmailEnabled, visibleCategories, type EmailCategory, type EmailPrefs } from '@/domain/emailCategories';

export default function EmailNotificationsSection() {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [state, setState] = useState<{ prefs: EmailPrefs; hasApiKey: boolean } | null>(null);

    useEffect(() => {
        let cancelled = false;
        getEmailPrefs()
            .then(res => { if (!cancelled && res) setState(res); })
            .catch(() => { /* load failed → section just doesn't render */ });
        return () => { cancelled = true; };
    }, []);

    if (!state) return null;

    const toggle = async (category: EmailCategory) => {
        const enabled = !isEmailEnabled(state.prefs, category);
        const before = state.prefs;
        setState(s => s && { ...s, prefs: { ...s.prefs, [category]: enabled } });
        let errorId: string | undefined;
        try {
            const res = await saveEmailPref(category, enabled);
            if (res?.success) return;
            errorId = res?.errorId || resolveErrorId(res, 'EmailNotificationsSection');
        } catch (e) {
            errorId = resolveErrorId(e, 'EmailNotificationsSection');
        }
        setState(s => s && { ...s, prefs: before });
        toast.error(t('errors.generic') || 'Error', t('settings.email_save_failed') || 'No se pudo guardar el cambio.', errorId);
    };

    return (
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 mt-6" data-testid="email-prefs-section">
            <h2 className="text-base font-bold text-stone-900">✉️ {t('settings.email_title') || 'Avisos por email'}</h2>
            <p className="text-xs text-stone-500 mt-1 mb-2 max-w-prose">{t('settings.email_hint') || 'Elegí qué avisos de la campanita también te llegan por correo.'}</p>
            <ul className="divide-y divide-stone-100">
                {visibleCategories(state.hasApiKey).map(category => {
                    const alwaysOn = ALWAYS_ON_CATEGORIES.has(category);
                    const on = isEmailEnabled(state.prefs, category);
                    const label = t(`settings.email_cat_${category}`);
                    return (
                        <li key={category} className="flex items-center justify-between gap-4 py-3" data-testid={`email-pref-${category}`}>
                            <div className="min-w-0">
                                <p className="text-sm font-semibold text-stone-900">{label}</p>
                                <p className="text-xs text-stone-500 mt-0.5">{t(`settings.email_cat_${category}_desc`)}</p>
                            </div>
                            {alwaysOn ? (
                                <span className="shrink-0 text-xs font-semibold text-stone-500">{t('settings.email_always_on') || 'Siempre activo'}</span>
                            ) : (
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={on}
                                    aria-label={label}
                                    onClick={() => toggle(category)}
                                    className="shrink-0 min-h-11 min-w-11 flex items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                                    data-testid={`email-pref-toggle-${category}`}
                                >
                                    <span aria-hidden="true" className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors duration-200 ${on ? 'bg-teal-600' : 'bg-stone-300'}`}>
                                        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${on ? 'translate-x-5' : 'translate-x-1'}`} />
                                    </span>
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
