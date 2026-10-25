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
import { reportClientError, resolveErrorId } from '@/lib/clientErrorReporter';
import { getEmailPrefs, saveEmailPref } from '@/app/actions/settings';
import { ALWAYS_ON_CATEGORIES, isEmailEnabled, visibleCategories, type EmailCategory, type EmailPrefs } from '@/domain/emailCategories';

/** Spanish fallbacks (es is the default locale) for a key a locale lacks. */
const CATEGORY_FALLBACK: Record<EmailCategory, { label: string; desc: string }> = {
    requests: { label: 'Pedidos que necesitan tu respuesta', desc: 'Pedidos de combinación de perfiles y de acceso a datos de contacto.' },
    forms: { label: 'Formularios y contratos', desc: 'Formularios y contratos recibidos o vinculados a tus perfiles.' },
    merges: { label: 'Duplicados y combinaciones', desc: 'Duplicados detectados y perfiles combinados.' },
    contact_access: { label: 'Acceso a datos de contacto', desc: 'Respuestas a tus pedidos de acceso a datos de contacto.' },
    profile_changes: { label: 'Cambios en tus perfiles', desc: 'Transferencias de perfiles y contactos agregados.' },
    api: { label: 'API', desc: 'Registros y accesos de tus claves de API.' },
    other: { label: 'Otros avisos', desc: 'Cualquier otro aviso de la campanita.' },
};

export default function EmailNotificationsSection() {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [state, setState] = useState<{ prefs: EmailPrefs; hasApiKey: boolean } | null>(null);

    useEffect(() => {
        let cancelled = false;
        getEmailPrefs()
            .then(res => { if (!cancelled && res) setState(res); })
            .catch((e: unknown) => {
                // The section stays hidden (nothing to toggle), but reported.
                void reportClientError({
                    message: e instanceof Error ? e.message : String(e),
                    stack: e instanceof Error ? e.stack : undefined,
                    source: 'EmailNotificationsSection.load',
                    level: 'warn',
                });
            });
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
                    const label = t(`settings.email_cat_${category}`) || CATEGORY_FALLBACK[category].label;
                    return (
                        <li key={category} className="flex items-center justify-between gap-4 py-3" data-testid={`email-pref-${category}`}>
                            <div className="min-w-0">
                                <p className="text-sm font-semibold text-stone-900">{label}</p>
                                <p className="text-xs text-stone-500 mt-0.5">{t(`settings.email_cat_${category}_desc`) || CATEGORY_FALLBACK[category].desc}</p>
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
                                    <span aria-hidden="true" className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors duration-200 ${on ? 'bg-teal-600' : 'bg-stone-200'}`}>
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
