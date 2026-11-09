'use client';

/**
 * «Avisos por email» in /settings: one switch per email category. The
 * 'requests' row is always on (it needs an answer) so it shows a label, never
 * a switch, and is rendered from ALWAYS_ON_CATEGORIES rather than the stored
 * prefs. Toggles are optimistic and revert on failure.
 *
 * Under «Cambios en tus perfiles»: «Avisame de cambios hechos por:» (Jon
 * 2026-11-08) — whose changes create a notice at all, bell AND email
 * (src/domain/teamChangeAudience.ts). So it stays visible and active whatever
 * that row's email switch says. Optimistic too; reverts on failure.
 */

import { useEffect, useId, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { reportClientError, resolveErrorId } from '@/lib/clientErrorReporter';
import { getEmailPrefs, saveEmailPref, saveProfileChangesFrom } from '@/app/actions/settings';
import { handledAsStale } from '@/lib/errorMessage';
import { ALWAYS_ON_CATEGORIES, isEmailEnabled, visibleCategories, type EmailCategory, type EmailPrefs } from '@/domain/emailCategories';
import { PROFILE_CHANGES_FROM, type ProfileChangesFrom } from '@/domain/teamChangeAudience';

/** Spanish fallbacks (es is the default locale) for a key a locale lacks. */
const CATEGORY_FALLBACK: Record<EmailCategory, { label: string; desc: string }> = {
    requests: { label: 'Pedidos que necesitan tu respuesta', desc: 'Pedidos para unir perfiles y de acceso a datos de contacto.' },
    forms: { label: 'Formularios y contratos', desc: 'Formularios y contratos recibidos o vinculados a tus perfiles.' },
    merges: { label: 'Duplicados y uniones', desc: 'Duplicados detectados y perfiles unidos.' },
    contact_access: { label: 'Acceso a datos de contacto', desc: 'Respuestas a tus pedidos de acceso a datos de contacto.' },
    profile_changes: { label: 'Cambios en tus perfiles', desc: 'Lo que agregan o cambian en tus perfiles: registros y calificaciones, fotos, direcciones de entrega, contactos, reportes, nombre y hogar. También las transferencias.' },
    api: { label: 'API', desc: 'Registros y accesos de tus claves de API.' },
    other: { label: 'Otros avisos', desc: 'Cualquier otro aviso de la campanita.' },
};

/** Spanish fallbacks for «Avisame de cambios hechos por:». */
const CHANGES_FROM_FALLBACK = {
    label: 'Avisame de cambios hechos por:',
    outside: 'Otros rescatistas',
    team: 'Otros rescatistas y mi equipo',
    outside_hint: 'Los cambios de tu equipo no te avisan. Siguen en el historial del perfil.',
    team_hint: 'También te avisamos cuando alguien de tu equipo cambia tus perfiles.',
} as const;

type SectionState = { prefs: EmailPrefs; hasApiKey: boolean; profileChangesFrom: ProfileChangesFrom };

export default function EmailNotificationsSection() {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [state, setState] = useState<SectionState | null>(null);
    const changesFromLabelId = useId();

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

    const chooseChangesFrom = async (from: ProfileChangesFrom) => {
        const before = state.profileChangesFrom;
        if (from === before) return;
        setState(s => s && { ...s, profileChangesFrom: from });
        let errorId: string | undefined;
        try {
            const res = await saveProfileChangesFrom(from);
            if (res?.success) return;
            errorId = res?.errorId || resolveErrorId(res, 'EmailNotificationsSection.changesFrom');
        } catch (e) {
            if (handledAsStale(e)) {
                // A stale tab: the «new version» notice is the only message.
                setState(s => s && { ...s, profileChangesFrom: before });
                return;
            }
            errorId = resolveErrorId(e, 'EmailNotificationsSection.changesFrom');
        }
        setState(s => s && { ...s, profileChangesFrom: before });
        toast.error(t('errors.generic') || 'Error', t('settings.email_save_failed') || 'No se pudo guardar el cambio.', errorId);
    };

    const changesFrom = (
        <div className="mt-3" data-testid="profile-changes-from">
            <p id={changesFromLabelId} className="text-xs font-semibold text-stone-700">{t('settings.changes_from_label') || CHANGES_FROM_FALLBACK.label}</p>
            <div role="radiogroup" aria-labelledby={changesFromLabelId} className="mt-1">
                {PROFILE_CHANGES_FROM.map(from => (
                    <label key={from} className="flex items-center gap-3 min-h-11 px-2 rounded-xl cursor-pointer hover:bg-stone-50 transition-colors">
                        <input
                            type="radio"
                            name="profile-changes-from"
                            value={from}
                            checked={state.profileChangesFrom === from}
                            onChange={() => chooseChangesFrom(from)}
                            className="w-4 h-4 accent-teal-600"
                            data-testid={`profile-changes-from-${from}`}
                        />
                        <span className="text-sm text-stone-800">{t(`settings.changes_from_${from}`) || CHANGES_FROM_FALLBACK[from]}</span>
                    </label>
                ))}
            </div>
            <p className="text-xs text-stone-500 mt-1" data-testid="profile-changes-from-hint">
                {t(`settings.changes_from_${state.profileChangesFrom}_hint`) || CHANGES_FROM_FALLBACK[`${state.profileChangesFrom}_hint`]}
            </p>
        </div>
    );

    return (
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 mt-6" data-testid="email-prefs-section">
            {/* A plain heading like its sibling sections (Seguimientos, Documentos) — no ✉️ (audit B19). */}
            <h2 className="text-base font-bold text-stone-900">{t('settings.email_title') || 'Avisos por email'}</h2>
            <p className="text-xs text-stone-500 mt-1 mb-2 max-w-prose">{t('settings.email_hint') || 'Elegí qué avisos de la campanita también te llegan por correo.'}</p>
            {/* --border-default dividers: the same visible line in Claro and Azul Noche (stone-100 vanished on the light card) — audit B19. */}
            <ul className="divide-y divide-[var(--border-default)]">
                {visibleCategories(state.hasApiKey).map(category => {
                    const alwaysOn = ALWAYS_ON_CATEGORIES.has(category);
                    const on = isEmailEnabled(state.prefs, category);
                    const label = t(`settings.email_cat_${category}`) || CATEGORY_FALLBACK[category].label;
                    return (
                        <li key={category} className="py-3" data-testid={`email-pref-${category}`}>
                            <div className="flex items-center justify-between gap-4">
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
                            </div>
                            {/* Not gated on the switch: it decides the bell too (Jon 2026-11-08). */}
                            {category === 'profile_changes' && changesFrom}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
