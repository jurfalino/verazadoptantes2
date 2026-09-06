'use client';

/**
 * v2.55.15 (animal-timeline PR2): single entry point for adding an event to an
 * animal's timeline. Health/care events write to `animal_events`; when an
 * adoption or foster placement is active, «Seguimiento a la familia» is offered
 * too and writes a follow_up adopter_event linked to the animal + placement
 * (through the v2.55.14 write path). The date is editable (default today) —
 * it will drive the projected-slot matching from PR3.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { extractErrorId } from '@/lib/errorUtils';
import { addAnimalEvent } from '@/app/actions/animalTimeline';
import { saveAdoption } from '@/app/actions';
import { ANIMAL_EVENT_TYPES, type AnimalEventType } from '@/domain/constants';
import { FOLLOWUP_SUBTYPES, type FollowupSubtype } from '@/domain/followups';

function todayISO(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseLocalNoon(s: string): Date {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0);
}

export default function AddAnimalEventModal({ animal, activePlacement, open, onClose, initialType, initialFollowupKey }: {
    animal: { id: string; name: string | null };
    activePlacement: { id: string; recordType: string; adopterId: string } | null;
    open: boolean;
    onClose: () => void;
    /** Preselect the type (e.g. from a health quick-add or a projected slot). */
    initialType?: string;
    /** PR3: the projected-slot key this event satisfies. */
    initialFollowupKey?: string | null;
}) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    const [type, setType] = useState<string>(initialType || (activePlacement ? 'follow_up' : 'vaccination'));
    const [subtype, setSubtype] = useState<FollowupSubtype>('adaptation');
    const [date, setDate] = useState(todayISO());
    const [details, setDetails] = useState('');
    const [saving, setSaving] = useState(false);

    if (!open) return null;

    const types: string[] = [
        ...(activePlacement ? ['follow_up'] : []),
        ...ANIMAL_EVENT_TYPES,
    ];
    const typeLabel = (v: string) => t(`animalProfile.event_type_${v}`) || v;

    const handleSave = async () => {
        setSaving(true);
        try {
            if (type === 'follow_up' && activePlacement) {
                const res = await saveAdoption({
                    recordType: 'follow_up',
                    adopterId: activePlacement.adopterId,
                    animalId: animal.id,
                    animalName: animal.name,
                    details: details.trim() || null,
                    date: parseLocalNoon(date),
                    followupKey: initialFollowupKey ?? undefined,
                    followupSubtype: subtype,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any);
                if (!res || !('success' in res)) throw new Error('No response');
            } else {
                const res = await addAnimalEvent({
                    animalId: animal.id,
                    eventType: type as AnimalEventType,
                    date: parseLocalNoon(date),
                    details: details.trim() || null,
                    followupKey: initialFollowupKey ?? null,
                    placementId: activePlacement?.id ?? null,
                });
                if (!res || 'error' in res) throw new Error((res as { error?: string })?.error || 'No response');
            }
            toast.success(t('animalProfile.event_saved') || 'Evento guardado', animal.name || '');
            onClose();
            router.refresh();
        } catch (error) {
            toast.error(t('errors.generic') || 'Error', t('animalProfile.event_save_failed') || 'No se pudo guardar el evento.', extractErrorId(error));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose} role="presentation">
            <div
                className="bg-white rounded-2xl border border-stone-200 shadow-xl w-full max-w-sm p-4"
                role="dialog" aria-modal="true" aria-label={t('animalProfile.add_event') || 'Agregar evento'}
                onClick={(e) => e.stopPropagation()}
            >
                <h3 className="text-base font-bold text-stone-900 mb-1">{t('animalProfile.add_event') || 'Agregar evento'}</h3>
                <p className="text-xs text-stone-500 mb-3">{t('animalProfile.add_event_hint') || 'Queda en la línea de vida del animal.'}</p>

                <label className="block text-xs font-semibold uppercase tracking-wide text-stone-500 mb-1" htmlFor="animal-event-type">
                    {t('animalProfile.event_type') || 'Tipo'}
                </label>
                <select
                    id="animal-event-type"
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className="w-full mb-3 px-3 py-2 rounded-xl border border-stone-200 bg-white text-stone-900 text-base focus:border-teal-400 outline-none"
                    data-testid="animal-event-type"
                >
                    {types.map(v => <option key={v} value={v}>{typeLabel(v)}</option>)}
                </select>

                {type === 'follow_up' && (
                    <>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-stone-500 mb-1" htmlFor="animal-event-subtype">
                            {t('followups.subtype') || 'Subtipo'}
                        </label>
                        <select
                            id="animal-event-subtype"
                            value={subtype}
                            onChange={(e) => setSubtype(e.target.value as FollowupSubtype)}
                            className="w-full mb-3 px-3 py-2 rounded-xl border border-stone-200 bg-white text-stone-900 text-base focus:border-teal-400 outline-none"
                            data-testid="animal-event-subtype"
                        >
                            {FOLLOWUP_SUBTYPES.map(st => <option key={st} value={st}>{t(`followups.subtype_${st}`) || st}</option>)}
                        </select>
                    </>
                )}

                <label className="block text-xs font-semibold uppercase tracking-wide text-stone-500 mb-1" htmlFor="animal-event-date">
                    {t('animalProfile.event_date') || 'Fecha'}
                </label>
                <input
                    id="animal-event-date"
                    type="date"
                    value={date}
                    max={todayISO()}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full mb-3 px-3 py-2 rounded-xl border border-stone-200 bg-white text-stone-900 text-base focus:border-teal-400 outline-none"
                />

                <label className="block text-xs font-semibold uppercase tracking-wide text-stone-500 mb-1" htmlFor="animal-event-details">
                    {t('animalProfile.event_details') || 'Detalle'}
                </label>
                <input
                    id="animal-event-details"
                    type="text"
                    value={details}
                    onChange={(e) => setDetails(e.target.value)}
                    placeholder={t('animalProfile.event_details_ph') || 'Ej.: quíntuple, primera dosis'}
                    className="w-full mb-4 px-3 py-2 rounded-xl border border-stone-200 bg-white text-stone-900 text-base placeholder-stone-400 focus:border-teal-400 outline-none"
                    data-testid="animal-event-details"
                />

                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-40 transition-colors"
                        data-testid="animal-event-save"
                    >
                        {saving ? (t('animalProfile.saving') || 'Guardando…') : (t('common.save') || 'Guardar')}
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        className="px-4 py-2.5 rounded-xl text-sm font-semibold text-stone-600 bg-stone-100 hover:bg-stone-200 transition-colors"
                    >
                        {t('common.cancel') || 'Cancelar'}
                    </button>
                </div>
            </div>
        </div>
    );
}
