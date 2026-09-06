'use client';

/**
 * v2.55.16 (animal-timeline PR3): «Seguimientos» section in /settings.
 * Per-user schedule (check-in offsets, health toggles, transit cadence) and
 * the per-subtype WhatsApp/Telegram message templates. Staged: edits live in
 * local state and apply only on Guardar; «Restaurar» stages the defaults.
 * Renders only when the public ENABLE_FOLLOWUPS flag is on.
 */

import { useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { getFollowupSettings, saveFollowupSettings } from '@/app/actions/settings';
import {
    DEFAULT_SCHEDULE, DEFAULT_FOSTER_RULE, DEFAULT_MESSAGES, FOLLOWUP_SUBTYPES,
    mergeSchedule, type FollowupSettings, type FollowupSubtype,
} from '@/domain/followups';

type Draft = {
    checkins: { offsetDays: number }[];
    vaccines: boolean;
    neuter: boolean;
    foster: boolean;
    fosterIntervalDays: number;
    messages: Record<FollowupSubtype, string>;
    /** v2.55.19: opt-in email delivery of the reminders (bell always fires). */
    emailReminders: boolean;
};

function draftFrom(settings: FollowupSettings | null): Draft {
    const disabled = new Set(settings?.disabledKeys || []);
    return {
        checkins: mergeSchedule(DEFAULT_SCHEDULE, settings)
            .filter(e => e.kind === 'checkin')
            .map(e => ({ offsetDays: e.offsetDays ?? 0 })),
        vaccines: !disabled.has('health_vaccines'),
        neuter: !disabled.has('health_neuter'),
        foster: !disabled.has('foster_checkin'),
        fosterIntervalDays: settings?.fosterIntervalDays ?? DEFAULT_FOSTER_RULE.intervalDays,
        messages: { ...DEFAULT_MESSAGES, ...(settings?.messages || {}) },
        emailReminders: settings?.emailReminders === true,
    };
}

function isDefaultDraft(d: Draft): boolean {
    const defOffsets = DEFAULT_SCHEDULE.filter(e => e.kind === 'checkin').map(e => e.offsetDays);
    return d.vaccines && d.neuter && d.foster && !d.emailReminders
        && d.fosterIntervalDays === DEFAULT_FOSTER_RULE.intervalDays
        && JSON.stringify([...d.checkins.map(c => c.offsetDays)].sort((a, b) => a - b)) === JSON.stringify(defOffsets)
        && FOLLOWUP_SUBTYPES.every(st => d.messages[st] === DEFAULT_MESSAGES[st]);
}

function settingsFrom(d: Draft): FollowupSettings {
    const disabledKeys: string[] = [];
    if (!d.vaccines) disabledKeys.push('health_vaccines');
    if (!d.neuter) disabledKeys.push('health_neuter');
    if (!d.foster) disabledKeys.push('foster_checkin');
    const messages: Partial<Record<FollowupSubtype, string>> = {};
    for (const st of FOLLOWUP_SUBTYPES) {
        if (d.messages[st].trim() && d.messages[st] !== DEFAULT_MESSAGES[st]) messages[st] = d.messages[st].trim();
    }
    return {
        version: 1,
        checkins: d.checkins.map(c => ({ offsetDays: Math.max(1, Math.min(720, Math.round(c.offsetDays) || 1)) })),
        ...(disabledKeys.length ? { disabledKeys } : {}),
        fosterIntervalDays: Math.max(7, Math.min(120, Math.round(d.fosterIntervalDays) || DEFAULT_FOSTER_RULE.intervalDays)),
        ...(Object.keys(messages).length ? { messages } : {}),
        ...(d.emailReminders ? { emailReminders: true } : {}),
    };
}

export default function FollowupSettingsSection() {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [enabled, setEnabled] = useState(false);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        async function load() {
            try {
                const cfgRes = await fetch('/api/config');
                if (cfgRes.ok) {
                    const cfg = await cfgRes.json() as { config?: Record<string, unknown> };
                    if (cfg.config?.ENABLE_FOLLOWUPS !== true && cfg.config?.ENABLE_FOLLOWUPS !== 'true') return;
                    setEnabled(true);
                    const settings = await getFollowupSettings();
                    setDraft(draftFrom(settings));
                }
            } catch { /* flag fetch failed → section just doesn't render */ }
        }
        load();
    }, []);

    if (!enabled || !draft) return null;

    const set = (patch: Partial<Draft>) => setDraft(d => d ? { ...d, ...patch } : d);

    const handleSave = async () => {
        setSaving(true);
        const payload = isDefaultDraft(draft) ? null : settingsFrom(draft);
        const res = await saveFollowupSettings(payload);
        if (res?.success) {
            toast.success(t('settings.saved') || 'Guardado');
        } else {
            toast.error('Error', t('followups.settings_save_failed') || 'No se pudo guardar el cronograma.', res?.errorId);
        }
        setSaving(false);
    };

    const label = 'text-xs font-semibold uppercase tracking-wide text-stone-500';
    const input = 'px-3 py-2 rounded-xl border border-stone-200 bg-white text-stone-900 text-base focus:border-teal-400 outline-none';

    return (
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 mt-6" data-testid="followup-settings">
            <h2 className="text-base font-bold text-stone-900">{t('followups.settings_title') || 'Seguimientos de adopción'}</h2>
            <p className="text-xs text-stone-500 mt-1 mb-4 max-w-prose">{t('followups.settings_hint') || 'Vale para todas tus adopciones: definís cuántos controles hacés y cuándo. Los cambios se aplican al guardar.'}</p>

            {/* check-in offsets */}
            <div className="space-y-2">
                {draft.checkins.map((c, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-stone-700">
                        <span className="flex-1">{t('followups.checkin_at') || 'Control a los'}</span>
                        <input
                            type="number" min={1} max={720} value={c.offsetDays || ''}
                            onChange={e => set({ checkins: draft.checkins.map((x, j) => j === i ? { offsetDays: parseInt(e.target.value, 10) || 0 } : x) })}
                            className={`${input} w-24`} aria-label={t('followups.checkin_at') || 'Control a los'}
                        />
                        <span>{t('animalProfile.days') || 'días'}</span>
                        <button
                            type="button"
                            onClick={() => set({ checkins: draft.checkins.filter((_, j) => j !== i) })}
                            className="text-xs font-semibold text-rose-600 hover:underline px-2 py-2"
                        >
                            {t('followups.remove') || 'Quitar'}
                        </button>
                    </div>
                ))}
                <button
                    type="button"
                    onClick={() => set({ checkins: [...draft.checkins, { offsetDays: 90 }] })}
                    className="text-xs font-semibold text-teal-700 hover:underline"
                >
                    + {t('followups.add_checkin') || 'Agregar control'}
                </button>
            </div>

            {/* health + transit toggles */}
            <div className="mt-4 space-y-2 text-sm text-stone-700">
                <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={draft.vaccines} onChange={e => set({ vaccines: e.target.checked })} className="w-4 h-4 rounded accent-teal-600" />
                    {t('followups.toggle_vaccines') || 'Recordar plan de vacunas en cachorros'}
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={draft.neuter} onChange={e => set({ neuter: e.target.checked })} className="w-4 h-4 rounded accent-teal-600" />
                    {t('followups.toggle_neuter') || 'Recordar castración cerca de los 6 meses'}
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={draft.foster} onChange={e => set({ foster: e.target.checked })} className="w-4 h-4 rounded accent-teal-600" />
                        {t('followups.toggle_foster') || 'Controles durante el tránsito, cada'}
                    </label>
                    <input
                        type="number" min={7} max={120} value={draft.fosterIntervalDays || ''}
                        onChange={e => set({ fosterIntervalDays: parseInt(e.target.value, 10) || 0 })}
                        className={`${input} w-20`} aria-label={t('followups.toggle_foster') || 'Controles durante el tránsito'}
                    />
                    <span>{t('animalProfile.days') || 'días'}</span>
                </div>
            </div>

            {/* delivery channel */}
            <h3 className="text-sm font-bold text-stone-900 mt-6">{t('followups.delivery_title') || 'Cómo recibir los recordatorios'}</h3>
            <p className="text-xs text-stone-500 mt-1 mb-2 max-w-prose">{t('followups.delivery_hint') || 'La campanita de la app avisa siempre. Además, podés recibirlos por e-mail.'}</p>
            <label className="flex items-center gap-2 text-sm text-stone-700 cursor-pointer">
                <input
                    type="checkbox"
                    checked={draft.emailReminders}
                    onChange={e => set({ emailReminders: e.target.checked })}
                    className="w-4 h-4 rounded accent-teal-600"
                    data-testid="followup-email-toggle"
                />
                {t('followups.toggle_email') || 'Recibir recordatorios también por e-mail'}
            </label>

            {/* message templates */}
            <h3 className="text-sm font-bold text-stone-900 mt-6">{t('followups.messages_title') || 'Mensajes de seguimiento'}</h3>
            <p className="text-xs text-stone-500 mt-1 mb-3 max-w-prose">{t('followups.messages_hint') || 'Se abren pre-armados en WhatsApp (o se copian para Telegram) al contactar a la familia. Variables: {animal}, {familia}, {dias}.'}</p>
            <div className="space-y-3">
                {FOLLOWUP_SUBTYPES.map(st => (
                    <div key={st}>
                        <label className={label} htmlFor={`msg-${st}`}>{t(`followups.subtype_${st}`) || st}</label>
                        <textarea
                            id={`msg-${st}`} rows={2} value={draft.messages[st]}
                            onChange={e => set({ messages: { ...draft.messages, [st]: e.target.value } })}
                            className={`${input} w-full mt-1 text-sm resize-y`}
                        />
                    </div>
                ))}
            </div>

            <div className="flex flex-wrap gap-2 mt-5">
                <button
                    type="button" onClick={handleSave} disabled={saving}
                    className="px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-40 transition-colors"
                    data-testid="followup-settings-save"
                >
                    {saving ? (t('animalProfile.saving') || 'Guardando…') : (t('common.save') || 'Guardar')}
                </button>
                <button
                    type="button"
                    onClick={() => set(draftFrom(null) as Partial<Draft>)}
                    className="px-4 py-2.5 rounded-xl text-sm font-semibold text-stone-600 bg-stone-100 hover:bg-stone-200 transition-colors"
                >
                    {t('followups.restore_defaults') || 'Restaurar por defecto'}
                </button>
            </div>
        </div>
    );
}
