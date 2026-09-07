'use client';

/**
 * v2.55.15 (animal-timeline PR2), reworked v2.56.9.
 *
 * Single entry point for adding an event to an animal's timeline. Care events
 * write to `animal_events`; when a placement is active, «Seguimiento a la
 * familia» is offered too and writes a follow_up adopter_event linked to the
 * animal + placement.
 *
 * v2.56.9 fixes three defects reported on the first build:
 *  1. no rating — a follow-up is a judgement about how the family is doing, and
 *     it feeds the adopter's average, so it carries a 1–5 rating exactly like
 *     the wizard's follow-up does. (Care events have no rating: `animal_events`
 *     has no such column, and "how did the vaccination go" isn't a rating.)
 *  2. types and subtypes repeated — the old second dropdown listed
 *     vacunación/castración/veterinario again, one line below the same words in
 *     the type list. The subtype select is gone: recording a vaccination IS the
 *     «Vacunación» care event (which already satisfies the vaccine milestone),
 *     and a manual follow-up is an adaptation check-in. Slots that need a
 *     specific subtype pass it in programmatically.
 *  3. no photos — evidence belongs with the event, like everywhere else in the
 *     app; images are compressed client-side and linked to the created row.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { extractErrorId } from '@/lib/errorUtils';
import { compressImage } from '@/lib/imageCompress';
import { StarRating } from '@/components/StarRating';
import { addAnimalEvent } from '@/app/actions/animalTimeline';
import { saveAdoption } from '@/app/actions';
import { ANIMAL_EVENT_TYPES, type AnimalEventType } from '@/domain/constants';
import type { FollowupSubtype } from '@/domain/followups';

function todayISO(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseLocalNoon(s: string): Date {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0);
}

export default function AddAnimalEventModal({ animal, activePlacement, open, onClose, initialType, initialFollowupKey, initialSubtype }: {
    animal: { id: string; name: string | null };
    activePlacement: { id: string; recordType: string; adopterId: string } | null;
    open: boolean;
    onClose: () => void;
    /** Preselect the type (e.g. from a projected health slot). */
    initialType?: string;
    /** The projected-slot key this event satisfies. */
    initialFollowupKey?: string | null;
    /** Subtype for a slot-driven follow-up; manual ones are 'adaptation'. */
    initialSubtype?: FollowupSubtype;
}) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    const [type, setType] = useState<string>(initialType || (activePlacement ? 'follow_up' : 'vaccination'));
    const [date, setDate] = useState(todayISO());
    const [details, setDetails] = useState('');
    const [rating, setRating] = useState(0);
    const [photos, setPhotos] = useState<string[]>([]);
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);

    if (!open) return null;

    const isFollowUp = type === 'follow_up';
    const types: string[] = [
        ...(activePlacement ? ['follow_up'] : []),
        ...ANIMAL_EVENT_TYPES,
    ];
    const typeLabel = (v: string) => t(`animalProfile.event_type_${v}`) || v;

    const handlePickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';
        if (!file.type.startsWith('image/')) {
            toast.error(t('errors.generic') || 'Error', t('errors.upload_invalid_file') || 'Archivo no válido.');
            return;
        }
        setUploading(true);
        // Let the spinner paint before the synchronous canvas work.
        await new Promise(r => setTimeout(r, 50));
        try {
            const compressed = await compressImage(file);
            setPhotos(prev => [...prev, compressed]);
        } catch (error) {
            toast.error(t('errors.generic') || 'Error', t('errors.upload_process_failed') || 'No se pudo procesar la foto.', extractErrorId(error));
        } finally {
            setUploading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            let recordId: string | undefined;
            if (isFollowUp && activePlacement) {
                const res = await saveAdoption({
                    recordType: 'follow_up',
                    adopterId: activePlacement.adopterId,
                    animalId: animal.id,
                    animalName: animal.name,
                    details: details.trim() || null,
                    rating: rating > 0 ? rating : null,
                    date: parseLocalNoon(date),
                    followupKey: initialFollowupKey ?? undefined,
                    followupSubtype: initialSubtype || 'adaptation',
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any);
                if (!res || !('success' in res)) throw new Error('No response');
                recordId = (res as { id?: string }).id;
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
                recordId = res.id;
            }

            // Photos are evidence FOR this event: linked to the row just created
            // (adopterImages.adoptionId doubles as the subject id). `adopterId`
            // is NOT NULL, so an animal with no current holder uses the same
            // '__available__' sentinel the create form already writes.
            if (photos.length > 0 && recordId) {
                const { saveImage } = await import('@/app/actions');
                const owner = activePlacement?.adopterId || '__available__';
                for (const data of photos) {
                    await saveImage(owner, data, animal.name ? `${typeLabel(type)} — ${animal.name}` : typeLabel(type), recordId, 'image')
                        .catch((e) => {
                            // The event itself is saved; a failed photo must not
                            // discard it — surface with an errorId and continue.
                            toast.error(t('errors.generic') || 'Error', t('animalProfile.photo_failed') || 'El evento se guardó, pero una foto no se pudo subir.', extractErrorId(e));
                        });
                }
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

    const label = 'block text-xs font-semibold uppercase tracking-wide text-stone-500 mb-1';
    const field = 'w-full px-3 py-2 rounded-xl border border-stone-200 bg-white text-stone-900 text-base focus:border-teal-400 outline-none';

    return (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose} role="presentation">
            <div
                className="bg-white rounded-2xl border border-stone-200 shadow-xl w-full max-w-sm p-4 max-h-[90vh] overflow-y-auto"
                role="dialog" aria-modal="true" aria-label={t('animalProfile.add_event') || 'Agregar evento'}
                onClick={(e) => e.stopPropagation()}
            >
                <h3 className="text-base font-bold text-stone-900 mb-1">{t('animalProfile.add_event') || 'Agregar evento'}</h3>
                <p className="text-xs text-stone-500 mb-3">{t('animalProfile.add_event_hint') || 'Queda en la línea de vida del animal.'}</p>

                <label className={label} htmlFor="animal-event-type">{t('animalProfile.event_type') || 'Tipo'}</label>
                <select
                    id="animal-event-type" value={type} onChange={(e) => setType(e.target.value)}
                    className={`${field} mb-3`} data-testid="animal-event-type"
                >
                    {types.map(v => <option key={v} value={v}>{typeLabel(v)}</option>)}
                </select>

                {/* A follow-up rates how the family is doing — same 1–5 scale the
                    wizard uses, and it feeds the adopter's average. */}
                {isFollowUp && (
                    <div className="mb-3">
                        <span className={label}>{t('animalProfile.event_rating') || 'Calificación'}</span>
                        <StarRating value={rating} onChange={setRating} size="md" showLabel />
                    </div>
                )}

                <label className={label} htmlFor="animal-event-date">{t('animalProfile.event_date') || 'Fecha'}</label>
                <input
                    id="animal-event-date" type="date" value={date} max={todayISO()}
                    onChange={(e) => setDate(e.target.value)} className={`${field} mb-3`}
                />

                <label className={label} htmlFor="animal-event-details">{t('animalProfile.event_details') || 'Detalle'}</label>
                <input
                    id="animal-event-details" type="text" value={details}
                    onChange={(e) => setDetails(e.target.value)}
                    placeholder={t('animalProfile.event_details_ph') || 'Ej.: quíntuple, primera dosis'}
                    className={`${field} mb-3 placeholder-stone-400`} data-testid="animal-event-details"
                />

                <span className={label}>{t('animalProfile.event_photos') || 'Fotos'}</span>
                <div className="flex flex-wrap gap-2 mb-4">
                    {photos.map((p, i) => (
                        <div key={i} className="relative">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p} alt="" className="w-16 h-16 rounded-xl object-cover border border-stone-200" />
                            <button
                                type="button"
                                onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                                aria-label={t('common.delete') || 'Quitar'}
                                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-stone-800 text-white text-xs leading-none grid place-items-center"
                            >×</button>
                        </div>
                    ))}
                    <label className="w-16 h-16 rounded-xl border border-dashed border-stone-300 grid place-items-center cursor-pointer text-stone-500 hover:border-teal-400 transition-colors">
                        {uploading ? (
                            <span className="w-4 h-4 border-2 border-stone-300 border-t-teal-600 rounded-full animate-spin" aria-label={t('animalProfile.saving') || 'Cargando'} />
                        ) : (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M4 8h3l2-2h6l2 2h3v11H4V8z" /><circle cx="12" cy="13" r="3.5" /></svg>
                        )}
                        <input type="file" accept="image/*" className="hidden" onChange={handlePickPhoto} disabled={uploading} data-testid="animal-event-photo" />
                    </label>
                </div>

                <div className="flex gap-2">
                    <button
                        type="button" onClick={handleSave} disabled={saving || uploading}
                        className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-40 transition-colors"
                        data-testid="animal-event-save"
                    >
                        {saving ? (t('animalProfile.saving') || 'Guardando…') : (t('common.save') || 'Guardar')}
                    </button>
                    <button
                        type="button" onClick={onClose} disabled={saving}
                        className="px-4 py-2.5 rounded-xl text-sm font-semibold text-stone-600 bg-stone-100 hover:bg-stone-200 transition-colors"
                    >
                        {t('common.cancel') || 'Cancelar'}
                    </button>
                </div>
            </div>
        </div>
    );
}
