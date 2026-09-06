'use client';

/**
 * v2.55.15 (animal-timeline PR2): the animal's page — photo-first header that
 * reads like a sentence ("Gata gris · 4 meses · sin castrar"), state-dependent
 * action row (one primary + share sheet + ✎/🗑 icons), in-place identity edit,
 * applicants while seeking, and the line-of-life timeline underneath.
 *
 * Deliberate absences: no labeled identity grid and no health-summary section —
 * dated events live exactly once, on the timeline; labels live in the edit form.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { extractErrorId } from '@/lib/errorUtils';
import { formatAge } from '@/lib/ageUtils';
import { formatRelativeTime, formatShortDate } from '@/lib/dates';
import { adopterDisplayName } from '@/lib/adopterDisplay';
import { emailHandle } from '@/lib/userDisplay';
import { saveAdoption, deleteAnimalForAdoption } from '@/app/actions';
import AnimalTimeline from '@/components/AnimalTimeline';
import AddAnimalEventModal from '@/components/AddAnimalEventModal';
import AnimalShareSheet from '@/components/AnimalShareSheet';
import PickAdopterForAnimalModal from '@/components/PickAdopterForAnimalModal';
import AnimalApplicants from '@/components/AnimalApplicants';
import type { AnimalProfileData, ProjectedSlot } from '@/app/actions/animalTimeline';
import type { ApplicantSummary } from '@/app/actions/applicants';
import { interpolate } from '@/lib/interpolate';

function placeholderFor(species: string | null): string {
    const s = (species || '').toLowerCase();
    if (s === 'dog') return '/placeholders/dog.png';
    if (s === 'cat') return '/placeholders/cat.png';
    return '/placeholders/paw.png';
}

export default function AnimalProfile({ profile, applicants, userId }: {
    profile: AnimalProfileData;
    applicants: ApplicantSummary[];
    /** session user id (ShareFormMenu links). */
    userId: string;
}) {
    const { t, locale } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    const { animal, activePlacement, items, images, projected, addedByName, orgName, userNameMap } = profile;

    const [editing, setEditing] = useState(false);
    const [eventModal, setEventModal] = useState<{ type?: string; followupKey?: string } | null>(null);
    const [showMissed, setShowMissed] = useState(false);
    const [pickOpen, setPickOpen] = useState<null | 'adoption' | 'foster'>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [busy, setBusy] = useState(false);

    const fem = animal.sex === 'hembra' || animal.sex === 'female' || animal.sex === 'Hembra';
    const adopted = activePlacement?.recordType === 'adoption';
    const seeking = !adopted; // available or foster: still looking for a home

    // ── the descriptor sentence: self-evident facts, no labels ──
    const speciesWord = (() => {
        const s = (animal.species || '').toLowerCase();
        if (s === 'cat') return (fem ? t('animalProfile.species_cat_f') : t('animalProfile.species_cat_m')) || 'Gato';
        if (s === 'dog') return (fem ? t('animalProfile.species_dog_f') : t('animalProfile.species_dog_m')) || 'Perro';
        return animal.species || '';
    })();
    const descriptor = [
        [speciesWord, animal.color?.toLowerCase()].filter(Boolean).join(' '),
        animal.estimatedBirthDate ? formatAge(animal.estimatedBirthDate, locale as 'es' | 'en') : animal.age,
    ].filter(Boolean).join(' · ');
    const castration = animal.neutered === 1
        ? ((fem ? t('animalProfile.castrated_f') : t('animalProfile.castrated_m')) || 'castrado')
        : animal.neutered === 0
            ? (t('animalProfile.not_castrated') || 'sin castrar')
            : null;

    const heroUrl = images[0]?.thumbnailUrl || images[0]?.url || null;

    // ── projected follow-ups (flag-gated server-side; [] when off) ──
    const dueSlots = projected.filter(s => s.status === 'due');
    const upcomingSlots = projected.filter(s => s.status === 'upcoming');
    const missedSlots = projected.filter(s => s.status === 'missed');
    const slotLabel = (s: ProjectedSlot) =>
        (s.copyKey === 'checkin_custom' || s.copyKey === 'foster_checkin')
            ? interpolate(t(`followups.${s.copyKey}`) || '{days}', { days: s.offsetDays ?? '' })
            : (t(`followups.${s.copyKey}`) || s.key);

    /** A slot's Registrar CTA: check-ins route to the adopter wizard (rating +
     *  notes captured there); health slots open the event modal prefilled. */
    const registerSlot = (s: ProjectedSlot) => {
        if (!activePlacement) return;
        if (s.subtype === 'adaptation') {
            router.push(`/adopter/${activePlacement.adopterId}?newAdoption=follow_up&animalId=${animal.id}&followupKey=${encodeURIComponent(s.key)}&followupSubtype=adaptation`);
        } else {
            setEventModal({ type: s.subtype === 'neuter' ? 'neuter' : 'vaccination', followupKey: s.key });
        }
    };

    /** Telegram can't prefill text — copy the message alongside opening the chat. */
    const onContactClick = (s: ProjectedSlot) => {
        if (s.contact?.channel === 'telegram') {
            navigator.clipboard?.writeText(s.contact.message).catch(() => { /* clipboard blocked: the chat still opens */ });
            toast.success(t('followups.tg_copied_title') || 'Mensaje copiado', t('followups.tg_copied') || 'Pegalo en el chat de Telegram.');
        }
    };

    const contactButton = (s: ProjectedSlot) => s.contact ? (
        <a
            href={s.contact.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onContactClick(s)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors whitespace-nowrap"
            data-testid={`contact-${s.key}`}
        >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" /></svg>
            {s.contact.channel === 'telegram' ? 'Telegram' : 'WhatsApp'}
        </a>
    ) : null;

    const handleDelete = async () => {
        setBusy(true);
        try {
            await deleteAnimalForAdoption(animal.id);
            toast.success(t('animalProfile.deleted') || 'Animal eliminado', animal.name || '');
            router.push('/my-animals');
        } catch (error) {
            toast.error(t('errors.generic') || 'Error', t('animalProfile.delete_failed') || 'No se pudo eliminar.', extractErrorId(error));
            setBusy(false);
            setConfirmDelete(false);
        }
    };

    return (
        <div className="max-w-3xl mx-auto">
            {/* back-nav */}
            <Link href="/my-animals" className="inline-flex items-center gap-1.5 text-sm font-semibold text-stone-500 hover:text-stone-700 transition-colors mb-3">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                {t('animalProfile.back') || 'Mis animales'}
            </Link>

            {/* ── header card: full-bleed 2:1 hero, caption on a scrim ── */}
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden" data-testid="animal-header">
                <div className="relative" style={{ aspectRatio: '2 / 1' }}>
                    {heroUrl ? (
                        <img src={heroUrl} alt={animal.name || 'Animal'} className="absolute inset-0 w-full h-full object-cover" />
                    ) : (
                        <div className="absolute inset-0 bg-stone-100 flex items-center justify-center">
                            <img src={placeholderFor(animal.species)} alt={animal.species || 'Animal'} className="w-full h-full object-contain p-10 opacity-40" />
                        </div>
                    )}
                    {/* photo captions are literal white/amber: photos don't theme */}
                    <div className="absolute inset-x-0 bottom-0 px-4 pb-3 pt-12" style={{ background: 'linear-gradient(to top, rgba(0,0,0,.72), rgba(0,0,0,.35) 55%, transparent)' }}>
                        <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-white" data-testid="animal-name">{animal.name || t('adoption.unnamed') || 'Sin nombre'}</h1>
                        <p className="text-sm text-white/90">
                            {descriptor}
                            {castration && <> · <span className={animal.neutered === 1 ? '' : 'text-amber-300 font-semibold'}>{castration}</span></>}
                        </p>
                    </div>
                    {images.length > 1 && (
                        <div className="absolute top-3 right-3 flex gap-1.5">
                            {images.slice(1, 3).map(im => (
                                <img key={im.id} src={im.thumbnailUrl || im.url} alt="" className="w-12 h-12 rounded-xl object-cover border border-white/40" />
                            ))}
                            {images.length > 3 && (
                                <span className="w-12 h-12 rounded-xl bg-black/40 backdrop-blur-sm text-white text-xs font-semibold flex items-center justify-center">+{images.length - 3}</span>
                            )}
                        </div>
                    )}
                </div>

                <div className="p-4">
                    {editing ? (
                        <InlineEditForm
                            animal={animal}
                            onCancel={() => setEditing(false)}
                            onSaved={() => { setEditing(false); router.refresh(); }}
                        />
                    ) : (
                        <>
                            {/* status chip */}
                            <div className="flex flex-wrap items-center gap-2">
                                {activePlacement ? (
                                    <Link
                                        href={`/adopter/${activePlacement.adopterId}`}
                                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-colors ${adopted ? 'bg-teal-50 text-teal-700 hover:bg-teal-100' : 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200'}`}
                                        data-testid="animal-status-chip"
                                    >
                                        {adopted
                                            ? <>{(fem ? t('animalProfile.status_adopted_f') : t('animalProfile.status_adopted_m')) || 'Adoptado por'} {adopterDisplayName({ name: activePlacement.adopterName }, t('adopter.nameless'))}</>
                                            : <>{t('dashboard.in_foster_with') || 'En tránsito con'} {adopterDisplayName({ name: activePlacement.adopterName }, t('adopter.nameless'))}</>}
                                        {activePlacement.startedAt && (
                                            <span className="font-normal opacity-80">· {formatRelativeTime(activePlacement.startedAt, locale as 'es' | 'en') || formatShortDate(activePlacement.startedAt)}</span>
                                        )}
                                    </Link>
                                ) : (
                                    <span className="inline-flex px-3 py-1 rounded-full text-xs font-semibold bg-stone-100 text-stone-600" data-testid="animal-status-chip">
                                        {t('animalProfile.status_available') || 'Disponible'}
                                    </span>
                                )}
                                {dueSlots.length > 0 && (
                                    <a href="#next-action" className="inline-flex px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors" data-testid="pending-pill">
                                        {dueSlots.length} {dueSlots.length === 1 ? (t('followups.pending_one') || 'pendiente') : (t('followups.pending_many') || 'pendientes')}
                                    </a>
                                )}
                            </div>

                            {animal.details && <p className="mt-3 text-sm text-stone-700 max-w-prose">{animal.details}</p>}

                            {/* Audit identity ALWAYS visible: who added the animal (+ team).
                                The rescue DATE moved to the timeline's origin event. */}
                            <p className="mt-2 text-xs text-stone-500" data-testid="animal-added-by">
                                {[
                                    `${t('common.added_by') || 'Agregado por'} ${addedByName || emailHandle(animal.addedBy)}${orgName ? ` · ${t('animalProfile.team') || 'equipo'} ${orgName}` : ''}`,
                                    animal.microchip ? `${t('animalProfile.microchip') || 'Microchip'} ${animal.microchip}` : null,
                                ].filter(Boolean).join(' · ')}
                            </p>

                            {/* ── action row: one primary + state transition + share + ✎/🗑 ── */}
                            <div className="flex flex-wrap items-center gap-2 mt-4">
                                {seeking && (
                                    <button
                                        type="button"
                                        onClick={() => setPickOpen('adoption')}
                                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 shadow-sm transition-colors"
                                        data-testid="profile-record-adoption"
                                    >
                                        {t('myAnimals.record_adoption') || 'Registrar adopción'}
                                    </button>
                                )}
                                {seeking && (
                                    <button
                                        type="button"
                                        onClick={() => setPickOpen('foster')}
                                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-indigo-800 bg-indigo-100 hover:bg-indigo-200 transition-colors"
                                    >
                                        {activePlacement ? (t('myAnimals.move_to_foster') || 'Mover a otro tránsito') : (t('animalProfile.record_foster') || 'Registrar tránsito')}
                                    </button>
                                )}
                                <AnimalShareSheet userId={userId} animalId={animal.id} animalName={animal.name || 'Animal'} adopted={adopted} />
                                {adopted && activePlacement && (
                                    <button
                                        type="button"
                                        onClick={() => router.push(`/adopter/${activePlacement.adopterId}?newAdoption=returned_pet&animalId=${animal.id}`)}
                                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 transition-colors"
                                    >
                                        {t('animalProfile.record_return') || 'Registrar devolución'}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => setEditing(true)}
                                    aria-label={t('animalProfile.edit') || 'Editar ficha'}
                                    title={t('animalProfile.edit') || 'Editar ficha'}
                                    className="w-10 h-10 rounded-xl grid place-items-center text-stone-600 bg-stone-100 hover:bg-stone-200 transition-colors"
                                    data-testid="profile-edit"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 3l4 4L8 20l-5 1 1-5L17 3z" /></svg>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setConfirmDelete(true)}
                                    aria-label={t('animalProfile.delete') || 'Eliminar animal'}
                                    title={t('animalProfile.delete') || 'Eliminar animal'}
                                    className="w-10 h-10 rounded-xl grid place-items-center text-rose-600 bg-rose-50 border border-rose-100 hover:bg-rose-100 transition-colors"
                                    data-testid="profile-delete"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6" /></svg>
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* «Para hacer ahora»: due follow-ups directly under the header — the
                rescuer arriving from a notification must not scroll to act. */}
            {dueSlots.length > 0 && (
                <div className="mt-4 bg-white rounded-2xl border border-stone-200 border-l-[3px] border-l-amber-500 shadow-sm p-4" id="next-action" data-testid="due-banner">
                    <p className="text-xs font-bold uppercase tracking-wide text-stone-500 mb-2">{t('followups.para_hacer') || 'Para hacer ahora'}</p>
                    <div className="space-y-3">
                        {dueSlots.map(s => (
                            <div key={s.key} id={`followup-${activePlacement?.id}-${s.key}`} className="flex flex-wrap items-center gap-2" data-testid={`due-slot-${s.key}`}>
                                <div className="flex-1 min-w-[180px]">
                                    <p className="text-sm font-semibold text-stone-800">{slotLabel(s)}</p>
                                    <p className="text-xs text-stone-500">
                                        {(t('followups.vencia') || 'vencía el')} {formatShortDate(s.dueDate)} · {(t('followups.registrable_hasta') || 'podés registrarlo hasta el')} {formatShortDate(s.windowEndsAt)}
                                    </p>
                                </div>
                                {contactButton(s)}
                                <button
                                    type="button"
                                    onClick={() => registerSlot(s)}
                                    className="inline-flex px-3 py-2 rounded-xl text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 transition-colors"
                                    data-testid={`register-${s.key}`}
                                >
                                    {t('followups.register') || 'Registrar'}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* applicants — only while the animal still needs a home */}
            {seeking && applicants.length > 0 && (
                <div className="mt-4 bg-white rounded-2xl border border-stone-200 shadow-sm p-3" id="applicants">
                    <AnimalApplicants animalId={animal.id} animalName={animal.name || 'Animal'} applicants={applicants} />
                </div>
            )}

            {/* ── line of life ── */}
            <div className="flex items-center gap-2 mt-8 mb-4">
                <h2 className="text-base font-bold text-stone-900">{t('animalProfile.timeline_title') || 'Línea de vida'}</h2>
                <button
                    type="button"
                    onClick={() => setEventModal({})}
                    className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-teal-700 bg-teal-50 border border-teal-100 hover:border-teal-400 transition-colors"
                    data-testid="add-animal-event"
                >
                    + {t('animalProfile.add_event') || 'Agregar evento'}
                </button>
            </div>

            {/* projected future — nearest first, structurally distinct (dashed) */}
            {(upcomingSlots.length > 0 || dueSlots.length > 0 || missedSlots.length > 0) && (
                <div className="mb-4" data-testid="projected-section">
                    <div className="space-y-2">
                        {[...dueSlots, ...upcomingSlots].map(s => (
                            <div key={s.key} className={`rounded-xl border-2 border-dashed px-4 py-3 ${s.status === 'due' ? 'border-amber-300 bg-amber-50/50' : 'border-stone-200 bg-stone-50/50'}`}>
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-semibold text-stone-700 flex-1 min-w-[160px]">{slotLabel(s)}</p>
                                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${s.status === 'due' ? 'bg-amber-100 text-amber-700' : 'bg-stone-100 text-stone-500'}`}>
                                        {s.status === 'due' ? (t('followups.status_due') || 'Pendiente') : (t('followups.status_upcoming') || 'Programado')}
                                    </span>
                                    <span className="text-xs text-stone-500 tabular-nums">{formatShortDate(s.dueDate)}</span>
                                </div>
                                {s.status === 'due' && (
                                    <div className="flex flex-wrap items-center gap-2 mt-2">
                                        <button type="button" onClick={() => registerSlot(s)} className="inline-flex px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 transition-colors">
                                            {t('followups.register') || 'Registrar'}
                                        </button>
                                        {contactButton(s)}
                                        <span className="text-[11px] text-stone-500">{(t('followups.registrable_hasta') || 'podés registrarlo hasta el')} {formatShortDate(s.windowEndsAt)}</span>
                                    </div>
                                )}
                            </div>
                        ))}
                        {missedSlots.length > 0 && (
                            <div>
                                <button
                                    type="button"
                                    onClick={() => setShowMissed(v => !v)}
                                    aria-expanded={showMissed}
                                    className="w-full text-left px-4 py-2 rounded-xl border border-dashed border-stone-300 text-xs font-semibold text-stone-500 hover:bg-stone-100 transition-colors"
                                >
                                    {showMissed ? '▾' : '▸'} {missedSlots.length} {missedSlots.length === 1 ? (t('followups.missed_one') || 'recordatorio vencido') : (t('followups.missed_many') || 'recordatorios vencidos')}
                                </button>
                                {showMissed && (
                                    <div className="mt-2 space-y-1.5">
                                        {missedSlots.map(s => (
                                            <div key={s.key} className="flex items-baseline justify-between gap-2 px-4 py-1.5 rounded-lg border border-dashed border-stone-200 text-xs text-stone-500">
                                                <span className="font-semibold">{slotLabel(s)}</span>
                                                <span className="tabular-nums">{formatShortDate(s.dueDate)}</span>
                                            </div>
                                        ))}
                                        <p className="text-[11px] text-stone-500 px-1">{t('followups.missed_hint') || 'Vencieron hace tiempo, así que no te los recordamos. Podés registrar el evento igual desde «Agregar evento».'}</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-2 mt-4">
                        <span className="text-[11px] font-bold uppercase tracking-widest text-teal-700">{t('followups.today') || 'Hoy'}</span>
                        <div className="flex-1 h-px bg-stone-200" />
                    </div>
                </div>
            )}

            <AnimalTimeline items={items} animalSex={animal.sex} userNameMap={userNameMap} orgName={orgName} />

            {/* modals */}
            {eventModal && (
                <AddAnimalEventModal
                    animal={{ id: animal.id, name: animal.name }}
                    activePlacement={activePlacement}
                    open={!!eventModal}
                    onClose={() => setEventModal(null)}
                    initialType={eventModal.type}
                    initialFollowupKey={eventModal.followupKey ?? null}
                />
            )}
            {pickOpen && (
                <PickAdopterForAnimalModal
                    animalId={animal.id}
                    animalName={animal.name || ''}
                    recordType={pickOpen}
                    open={!!pickOpen}
                    onClose={() => setPickOpen(null)}
                />
            )}
            {confirmDelete && (
                <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !busy && setConfirmDelete(false)} role="presentation">
                    <div className="bg-white rounded-2xl border border-stone-200 shadow-xl w-full max-w-sm p-4" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
                        <h3 className="text-base font-bold text-stone-900 mb-1">{(t('animalProfile.delete_confirm_title') || '¿Eliminar a {name}?').replace('{name}', animal.name || '')}</h3>
                        <p className="text-sm text-stone-600 mb-4">{t('animalProfile.delete_confirm_body') || 'Se borra el animal con toda su línea de vida: tenencias, eventos y fotos. Esta acción no se puede deshacer.'}</p>
                        <div className="flex gap-2">
                            <button
                                type="button" onClick={handleDelete} disabled={busy}
                                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-40 transition-colors"
                                data-testid="confirm-delete-animal"
                            >
                                {busy ? (t('animalProfile.deleting') || 'Eliminando…') : (t('animalProfile.delete_confirm_cta') || 'Sí, eliminar')}
                            </button>
                            <button type="button" onClick={() => setConfirmDelete(false)} disabled={busy} className="px-4 py-2.5 rounded-xl text-sm font-semibold text-stone-600 bg-stone-100 hover:bg-stone-200 transition-colors">
                                {t('common.cancel') || 'Cancelar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/** In-place identity edit: patches ONLY `animals` fields via saveAdoption
 *  (no recordType/adopterId in the payload → the placement branch is a no-op,
 *  which kills the old edit-form foster-ending bug by construction). */
function InlineEditForm({ animal, onCancel, onSaved }: {
    animal: AnimalProfileData['animal'];
    onCancel: () => void;
    onSaved: () => void;
}) {
    const { t } = useLanguage();
    const toast = useShowToast();

    const ageDays = animal.estimatedBirthDate ? Math.round((Date.now() - animal.estimatedBirthDate) / 86400000) : null;
    const initYears = ageDays != null && ageDays >= 365;
    const [name, setName] = useState(animal.name || '');
    const [species, setSpecies] = useState(animal.species || 'other');
    const [sex, setSex] = useState(animal.sex || '');
    const [ageNum, setAgeNum] = useState(ageDays != null ? String(initYears ? Math.floor(ageDays / 365) : Math.max(1, Math.round(ageDays / 30))) : '');
    const [ageUnit, setAgeUnit] = useState<'months' | 'years'>(initYears ? 'years' : 'months');
    const [neutered, setNeutered] = useState(animal.neutered === 1);
    const [color, setColor] = useState(animal.color || '');
    const [microchip, setMicrochip] = useState(animal.microchip || '');
    const [details, setDetails] = useState(animal.details || '');
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        setSaving(true);
        try {
            let estimatedBirthDate: Date | null = animal.estimatedBirthDate ? new Date(animal.estimatedBirthDate) : null;
            const n = parseInt(ageNum, 10);
            if (!Number.isNaN(n) && n > 0) {
                const d = new Date();
                if (ageUnit === 'years') d.setFullYear(d.getFullYear() - n); else d.setMonth(d.getMonth() - n);
                estimatedBirthDate = d;
            }
            const res = await saveAdoption({
                id: animal.id,
                animalName: name.trim() || null,
                species: species || null,
                sex: sex || null,
                estimatedBirthDate,
                neutered: neutered ? 1 : 0,
                color: color.trim() || null,
                microchip: microchip.trim() || null,
                details: details.trim() || null,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);
            if (!res || !('success' in res)) throw new Error('No response');
            toast.success(t('animalProfile.saved') || 'Guardado', name);
            onSaved();
        } catch (error) {
            toast.error(t('errors.generic') || 'Error', t('animalProfile.edit_save_failed') || 'No se pudieron guardar los cambios.', extractErrorId(error));
            setSaving(false);
        }
    };

    const label = 'block text-xs font-semibold uppercase tracking-wide text-stone-500 mb-1';
    const input = 'w-full px-3 py-2 rounded-xl border border-stone-200 bg-white text-stone-900 text-base focus:border-teal-400 outline-none';

    return (
        <div data-testid="inline-edit-form">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                    <label className={label} htmlFor="ae-name">{t('animalProfile.field_name') || 'Nombre'}</label>
                    <input id="ae-name" type="text" value={name} onChange={e => setName(e.target.value)} className={input} />
                </div>
                <div>
                    <label className={label} htmlFor="ae-species">{t('animalProfile.field_species') || 'Especie'}</label>
                    <select id="ae-species" value={['cat', 'dog', 'bird'].includes(species) ? species : 'other'} onChange={e => setSpecies(e.target.value)} className={input}>
                        <option value="cat">{t('species.cat') || 'Gato'}</option>
                        <option value="dog">{t('species.dog') || 'Perro'}</option>
                        <option value="bird">{t('species.bird') || 'Ave'}</option>
                        <option value="other">{t('species.other') || 'Otro'}</option>
                    </select>
                </div>
                <div>
                    <label className={label} htmlFor="ae-sex">{t('animalProfile.field_sex') || 'Sexo'}</label>
                    <select id="ae-sex" value={sex} onChange={e => setSex(e.target.value)} className={input}>
                        <option value="">—</option>
                        <option value="macho">{t('adoption.sex_male') || 'Macho'}</option>
                        <option value="hembra">{t('adoption.sex_female') || 'Hembra'}</option>
                    </select>
                </div>
                <div>
                    <label className={label} htmlFor="ae-age">{t('animalProfile.field_age') || 'Edad estimada'}</label>
                    <div className="flex gap-2">
                        <input id="ae-age" type="number" min={1} max={30} value={ageNum} onChange={e => setAgeNum(e.target.value)} className={`${input} w-24`} />
                        <select value={ageUnit} onChange={e => setAgeUnit(e.target.value as 'months' | 'years')} className={input} aria-label={t('animalProfile.field_age_unit') || 'Unidad'}>
                            <option value="months">{t('animalProfile.months') || 'meses'}</option>
                            <option value="years">{t('animalProfile.years') || 'años'}</option>
                        </select>
                    </div>
                </div>
                <div>
                    <label className={label} htmlFor="ae-color">{t('animalProfile.field_color') || 'Color'}</label>
                    <input id="ae-color" type="text" value={color} onChange={e => setColor(e.target.value)} className={input} />
                </div>
                <div>
                    <label className={label} htmlFor="ae-chip">{t('animalProfile.field_microchip') || 'Microchip'}</label>
                    <input id="ae-chip" type="text" value={microchip} onChange={e => setMicrochip(e.target.value)} className={input} placeholder={t('animalProfile.no_microchip') || 'Sin microchip'} />
                </div>
            </div>
            <label className="flex items-center gap-2 mt-3 text-sm text-stone-700 cursor-pointer">
                <input type="checkbox" checked={neutered} onChange={e => setNeutered(e.target.checked)} className="w-4 h-4 rounded accent-teal-600" />
                {t('animalProfile.field_neutered') || 'Ya está castrado/a'}
            </label>
            <div className="mt-3">
                <label className={label} htmlFor="ae-details">{t('animalProfile.field_details') || 'Descripción'}</label>
                <input id="ae-details" type="text" value={details} onChange={e => setDetails(e.target.value)} className={input} placeholder={t('animalProfile.field_details_ph') || 'Carácter, señas, historia…'} />
            </div>
            <p className="mt-2 text-xs text-stone-500">{t('animalProfile.edit_hint') || 'Solo la identidad. La tenencia y la salud se registran desde la ficha.'}</p>
            <div className="flex gap-2 mt-3">
                <button type="button" onClick={handleSave} disabled={saving} className="px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-40 transition-colors" data-testid="inline-edit-save">
                    {saving ? (t('animalProfile.saving') || 'Guardando…') : (t('common.save') || 'Guardar')}
                </button>
                <button type="button" onClick={onCancel} disabled={saving} className="px-4 py-2.5 rounded-xl text-sm font-semibold text-stone-600 bg-stone-100 hover:bg-stone-200 transition-colors">
                    {t('common.cancel') || 'Cancelar'}
                </button>
            </div>
        </div>
    );
}
