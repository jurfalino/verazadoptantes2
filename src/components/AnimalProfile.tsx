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

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { formatAge } from '@/lib/ageUtils';
import { useDateFormat, useRelativeTime } from '@/context/TimezoneContext';
import { adopterDisplayName } from '@/lib/adopterDisplay';
import { emailHandle } from '@/lib/userDisplay';
import { saveAdoption, deleteAnimalForAdoption } from '@/app/actions';
import AnimalTimeline from '@/components/AnimalTimeline';
import AddAnimalEventModal from '@/components/AddAnimalEventModal';
import { MediaLightbox } from '@/components/ui/MediaLightbox';
import AnimalShareSheet from '@/components/AnimalShareSheet';
import PickAdopterForAnimalModal from '@/components/PickAdopterForAnimalModal';
import AnimalApplicants from '@/components/AnimalApplicants';
import type { AnimalProfileData, ProjectedSlot } from '@/app/actions/animalTimeline';
import type { ApplicantSummary } from '@/app/actions/applicants';
import { interpolate } from '@/lib/interpolate';
import { dueWhenText } from '@/lib/dueWhenText';

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
    const { formatShortDate } = useDateFormat();
    const formatRelativeTime = useRelativeTime();
    const { t, locale } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    const { animal, activePlacement, items, images, projected, reminder, addedByName, orgName, userNameMap } = profile;

    const [editing, setEditing] = useState(false);
    const [eventModal, setEventModal] = useState<{ type?: string; followupKey?: string; subtype?: ProjectedSlot['subtype'] } | null>(null);
    /** Which photo the lightbox is showing. Before this, only the hero could be
     *  opened full size — the thumbnails were inert and photos past the third
     *  existed only inside a «+N» count, so a rescuer could add five photos and
     *  never see four of them. */
    const [photoIdx, setPhotoIdx] = useState<number | null>(null);
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

    // ← → step through the gallery; MediaLightbox already handles Escape.
    useEffect(() => {
        if (photoIdx === null || images.length < 2) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'ArrowRight') setPhotoIdx(i => i === null ? i : (i + 1) % images.length);
            if (e.key === 'ArrowLeft') setPhotoIdx(i => i === null ? i : (i - 1 + images.length) % images.length);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [photoIdx, images.length]);

    // ── projected follow-ups (flag-gated server-side; [] when off) ──
    const dueSlots = projected.filter(s => s.status === 'due');
    const upcomingSlots = projected.filter(s => s.status === 'upcoming');
    const missedSlots = projected.filter(s => s.status === 'missed');
    /** Days still available to log a due slot (0 = last day). The window is the
     *  answer to "how long do I have", so show it as a countdown, not a date. */
    const daysLeft = (s: ProjectedSlot) => Math.max(0, Math.ceil((s.windowEndsAt - Date.now()) / 86400000));
    const windowCopy = (s: ProjectedSlot) => {
        const n = daysLeft(s);
        return n === 0
            ? (t('followups.last_day') || 'último día para registrarlo')
            : interpolate(t('followups.days_left') || 'te quedan {days} días para registrarlo', { days: n });
    };

    const slotLabel = (s: ProjectedSlot) =>
        (s.copyKey === 'checkin_custom' || s.copyKey === 'foster_checkin')
            ? interpolate(t(`followups.${s.copyKey}`) || '{days}', { days: s.offsetDays ?? '' })
            : (t(`followups.${s.copyKey}`) || s.key);

    /** A slot's Registrar CTA: check-ins route to the adopter wizard (rating +
     *  notes captured there); health slots open the event modal prefilled. */
    /** Register a due slot WITHOUT leaving the animal.
     *
     *  Check-ins used to push to the adopter's wizard because only that form
     *  captured a rating. The in-place modal has carried the rating, notes and
     *  photos since v2.56.9, so the redirect only survived as a habit — and it
     *  threw the rescuer onto a different person's page mid-task, with the
     *  animal's «Para hacer ahora» list left behind. Every slot type now opens
     *  the same modal, prefilled with the key the matcher needs. */
    const registerSlot = (s: ProjectedSlot) => {
        if (!activePlacement) return;
        setEventModal({
            type: s.subtype === 'adaptation' ? 'follow_up' : s.subtype === 'neuter' ? 'neuter' : 'vaccination',
            followupKey: s.key,
            subtype: s.subtype,
        });
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
            toast.error(t('errors.generic') || 'Error', t('animalProfile.delete_failed') || 'No se pudo eliminar.', resolveErrorId(error, 'AnimalProfile'));
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
                        <button
                            type="button" onClick={() => setPhotoIdx(0)}
                            aria-label={t('animalProfile.photo_view') || 'Ver la foto'}
                            className="absolute inset-0 w-full h-full cursor-zoom-in"
                            data-testid="hero-photo"
                        >
                            <img src={heroUrl} alt={animal.name || 'Animal'} className="absolute inset-0 w-full h-full object-cover" />
                        </button>
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
                            {images.slice(1, 3).map((im, i) => (
                                <button
                                    key={im.id} type="button" onClick={() => setPhotoIdx(i + 1)}
                                    aria-label={t('animalProfile.photo_view') || 'Ver la foto'}
                                    className="w-12 h-12 rounded-xl overflow-hidden border border-white/40 cursor-zoom-in hover:border-white transition-colors"
                                    data-testid={`hero-thumb-${i + 1}`}
                                >
                                    <img src={im.thumbnailUrl || im.url} alt="" className="w-full h-full object-cover" />
                                </button>
                            ))}
                            {images.length > 3 && (
                                <button
                                    type="button" onClick={() => setPhotoIdx(3)}
                                    aria-label={t('animalProfile.photo_view_all') || 'Ver todas las fotos'}
                                    className="w-12 h-12 rounded-xl bg-black/40 backdrop-blur-sm text-white text-xs font-semibold flex items-center justify-center hover:bg-black/55 transition-colors"
                                    data-testid="hero-thumb-more"
                                >+{images.length - 3}</button>
                            )}
                        </div>
                    )}
                </div>

                <div className="p-4">
                    {editing ? (
                        <InlineEditForm
                            animal={animal}
                            images={images}
                            isAvailable={!activePlacement}
                            onCancel={() => { setEditing(false); router.refresh(); }}
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
                                <AnimalShareSheet
                                    userId={userId} animalId={animal.id}
                                    animalName={animal.name || 'Animal'} adopted={adopted}
                                    /* /api/showcase/animal/[id] serves only photo-bearing
                                       animals with no active placement — anything else 404s. */
                                    publicFiche={!activePlacement && images.length > 0}
                                />
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
                                        {dueWhenText(t, s.dueDate, Date.now(), formatShortDate)} · {windowCopy(s)}
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

            {/* ── line of life — one rail: future above «Hoy», past below ── */}
            <h2 className="text-base font-bold text-stone-900 mt-8 mb-4">{t('animalProfile.timeline_title') || 'Línea de vida'}</h2>

            <AnimalTimeline
                items={items}
                animalSex={animal.sex}
                userNameMap={userNameMap}
                orgName={orgName}
                projected={[...dueSlots, ...upcomingSlots].map(s => ({
                    key: s.key,
                    label: slotLabel(s),
                    status: s.status === 'due' ? 'due' as const : 'upcoming' as const,
                    dueDate: s.dueDate,
                    windowCopy: windowCopy(s),
                    windowEndsAt: s.windowEndsAt,
                    iconType: s.subtype === 'neuter' ? 'neuter' : s.subtype === 'vaccination' ? 'vaccination' : 'follow_up',
                    onRegister: () => registerSlot(s),
                    contact: contactButton(s),
                }))}
                missed={missedSlots.map(s => ({
                    key: s.key,
                    label: slotLabel(s),
                    dueDate: s.dueDate,
                    onRegister: () => registerSlot(s),
                }))}
                onAddEvent={() => setEventModal({})}
                reminder={reminder}
            />

            {/* Full-size gallery. MediaLightbox shows one item, so prev/next and
                the counter ride in its `actions` slot. */}
            {photoIdx !== null && images[photoIdx] && (
                <MediaLightbox
                    item={{
                        url: images[photoIdx].url,
                        caption: images[photoIdx].caption ?? undefined,
                        mediaType: images[photoIdx].mediaType === 'video' ? 'video' : 'image',
                        thumbnailUrl: images[photoIdx].thumbnailUrl ?? undefined,
                    }}
                    onClose={() => setPhotoIdx(null)}
                    actions={images.length > 1 ? (
                        <div className="flex items-center gap-2 text-white">
                            <button
                                type="button"
                                onClick={() => setPhotoIdx(i => i === null ? i : (i - 1 + images.length) % images.length)}
                                aria-label={t('common.previous') || 'Anterior'}
                                className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 grid place-items-center transition-colors"
                                data-testid="photo-prev"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" /></svg>
                            </button>
                            <span className="text-xs font-semibold tabular-nums" data-testid="photo-counter">{photoIdx + 1} / {images.length}</span>
                            <button
                                type="button"
                                onClick={() => setPhotoIdx(i => i === null ? i : (i + 1) % images.length)}
                                aria-label={t('common.next') || 'Siguiente'}
                                className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 grid place-items-center transition-colors"
                                data-testid="photo-next"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg>
                            </button>
                        </div>
                    ) : undefined}
                />
            )}

            {/* modals */}
            {eventModal && (
                <AddAnimalEventModal
                    animal={{ id: animal.id, name: animal.name }}
                    activePlacement={activePlacement}
                    open={!!eventModal}
                    onClose={() => setEventModal(null)}
                    initialType={eventModal.type}
                    initialFollowupKey={eventModal.followupKey ?? null}
                    initialSubtype={eventModal.subtype}
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
function InlineEditForm({ animal, images, isAvailable, onCancel, onSaved }: {
    animal: AnimalProfileData['animal'];
    images: AnimalProfileData['images'];
    /** No active placement — so it's the public listing that depends on a photo. */
    isAvailable: boolean;
    onCancel: () => void;
    onSaved: () => void;
}) {
    const { t } = useLanguage();
    const toast = useShowToast();

    const ageDays = animal.estimatedBirthDate ? Math.round((Date.now() - animal.estimatedBirthDate) / 86400000) : null;
    const initYears = ageDays != null && ageDays >= 365;
    const initialAgeNum = ageDays != null ? String(initYears ? Math.floor(ageDays / 365) : Math.max(1, Math.round(ageDays / 30))) : '';
    const initialAgeUnit: 'months' | 'years' = initYears ? 'years' : 'months';
    const [name, setName] = useState(animal.name || '');
    const [species, setSpecies] = useState(animal.species || 'other');
    const [sex, setSex] = useState(animal.sex || '');
    const [ageNum, setAgeNum] = useState(initialAgeNum);
    const [ageUnit, setAgeUnit] = useState<'months' | 'years'>(initialAgeUnit);
    const [neutered, setNeutered] = useState(animal.neutered === 1);
    const [color, setColor] = useState(animal.color || '');
    const [microchip, setMicrochip] = useState(animal.microchip || '');
    const [details, setDetails] = useState(animal.details || '');
    const [saving, setSaving] = useState(false);

    /* Photos are STAGED, not applied on click: this sits inside a
       Guardar/Cancelar form, and a Cancelar that left a photo deleted would
       break the promise the buttons make. Uploads run first on save, so a
       photo added in this same session can be chosen as the main one. */
    const [removed, setRemoved] = useState<Set<string>>(new Set());
    const [added, setAdded] = useState<{ key: string; dataUrl: string }[]>([]);
    /** Only an EXPLICIT pick during this edit. The stored primary is read from
     *  props on every render instead of latched into state — `useState(props)`
     *  runs once at mount, and reopening the editor right after a save mounts
     *  it before `router.refresh()` lands, which left the photo just chosen
     *  rendering as unchosen until the form was closed and opened again. */
    const [mainPick, setMainPick] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);

    /** Photos uploaded during THIS save that have already landed. Kept apart
     *  from `images` (stale until the page refreshes) so that a later step
     *  failing can't make a photo that IS saved vanish from the editor — the
     *  user would add it again and get a duplicate. */
    const [justUploaded, setJustUploaded] = useState<{ id: string; dataUrl: string }[]>([]);
    const kept = images.filter(i => !removed.has(i.id));
    const keptNew = justUploaded.filter(i => !removed.has(i.id));
    /** Only an explicit pick counts. There is deliberately NO default: with no
     *  primary set the surfaces disagree about which photo leads (the animal
     *  page shows the newest, the cards and public page the oldest), so
     *  badging one of them would promise a hero the rest of the app ignores. */
    const storedPrimary = images.find(i => i.isPrimary)?.id ?? null;
    const shownMain = mainPick ?? (storedPrimary && !removed.has(storedPrimary) ? storedPrimary : null);
    const totalAfter = kept.length + keptNew.length + added.length;
    /** Removing the last photo un-lists an available animal — say so BEFORE saving. */
    const warnsEmpty = isAvailable && totalAfter === 0 && images.length > 0;

    const pickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';
        if (!file.type.startsWith('image/')) {
            toast.error(t('errors.generic') || 'Error', t('errors.upload_invalid_file') || 'Archivo no válido.');
            return;
        }
        setUploading(true);
        await new Promise(r => setTimeout(r, 50)); // let the spinner paint
        try {
            const { compressImage } = await import('@/lib/imageCompress');
            const compressed = await compressImage(file);
            setAdded(prev => [...prev, { key: `new:${crypto.randomUUID()}`, dataUrl: compressed }]);
        } catch (error) {
            toast.error(t('errors.generic') || 'Error', t('errors.upload_process_failed') || 'No se pudo procesar la foto.', resolveErrorId(error, 'AnimalProfile'));
        } finally {
            setUploading(false);
        }
    };

    /** Apply the staged photo changes. Uploads first so a brand-new photo can
     *  be the chosen main; returns an error message, or null on success. */
    const applyPhotos = async (): Promise<string | null> => {
        const { addAnimalPhoto, deleteAnimalPhoto, setAnimalPrimaryPhoto } = await import('@/app/actions');
        // Tracked locally too: React state set inside this loop isn't readable
        // back before it ends, and a retry must see the effect of what landed.
        let effectiveMain = mainPick;
        for (const item of added) {
            const res = await addAnimalPhoto(animal.id, item.dataUrl);
            if ('error' in res) return res.error;
            // It exists now, so stop treating it as staged: a retry must not
            // upload it twice, and it must stay VISIBLE if a later step fails.
            setAdded(prev => prev.filter(x => x.key !== item.key));
            setJustUploaded(prev => [...prev, { id: res.id, dataUrl: item.dataUrl }]);
            if (effectiveMain === item.key) {
                effectiveMain = res.id;   // the choice follows the real id
                setMainPick(res.id);
            }
        }
        for (const id of removed) {
            const res = await deleteAnimalPhoto(animal.id, id);
            // Already gone is the outcome we wanted — don't wedge a retry on it.
            if ('error' in res && res.error !== 'Not found') return res.error;
            setRemoved(prev => { const next = new Set(prev); next.delete(id); return next; });
            setJustUploaded(prev => prev.filter(x => x.id !== id));
        }
        if (effectiveMain && !effectiveMain.startsWith('new:')) {
            if (effectiveMain !== storedPrimary) {
                const res = await setAnimalPrimaryPhoto(animal.id, effectiveMain);
                if ('error' in res) return res.error;
            }
        }
        return null;
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            /* Only CHANGED fields go to the server. Sending the whole form on a
               photo-only save silently rewrote the animal: estimatedBirthDate
               is recomputed from the rounded display value, so a 2y11m dog
               became exactly 2 years (and the neuter reminder moved with it),
               and an unknown neutered state (null) became «sin castrar». */
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const patch: Record<string, any> = {};
            if (name.trim() !== (animal.name || '')) patch.animalName = name.trim() || null;
            if (species !== (animal.species || 'other')) patch.species = species || null;
            if (sex !== (animal.sex || '')) patch.sex = sex || null;
            if (neutered !== (animal.neutered === 1)) patch.neutered = neutered ? 1 : 0;
            if (color.trim() !== (animal.color || '')) patch.color = color.trim() || null;
            if (microchip.trim() !== (animal.microchip || '')) patch.microchip = microchip.trim() || null;
            if (details.trim() !== (animal.details || '')) patch.details = details.trim() || null;
            if (ageNum !== initialAgeNum || ageUnit !== initialAgeUnit) {
                const n = parseInt(ageNum, 10);
                if (!Number.isNaN(n) && n > 0) {
                    const d = new Date();
                    if (ageUnit === 'years') d.setFullYear(d.getFullYear() - n); else d.setMonth(d.getMonth() - n);
                    patch.estimatedBirthDate = d;
                }
            }
            if (Object.keys(patch).length > 0) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const res = await saveAdoption({ id: animal.id, ...patch } as any);
                if (!res || !('success' in res)) throw new Error('No response');
            }
            const photoError = await applyPhotos();
            if (photoError) throw new Error(photoError);
            toast.success(t('animalProfile.saved') || 'Guardado', name);
            onSaved();
        } catch (error) {
            toast.error(t('errors.generic') || 'Error', t('animalProfile.edit_save_failed') || 'No se pudieron guardar los cambios.', resolveErrorId(error, 'AnimalProfile'));
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
            {/* ── Photos ── the only place an animal's photos can be changed
                after it is created. Staged like the fields above. */}
            <div className="mt-4 pt-3 border-t border-stone-100">
                <span className={label}>{t('animalProfile.field_photos') || 'Fotos'}</span>
                <div className="flex flex-wrap gap-2" data-testid="animal-photo-editor">
                    {kept.map(im => {
                        const isMain = shownMain === im.id;
                        return (
                            <div key={im.id} className="relative">
                                <img src={im.thumbnailUrl || im.url} alt={im.caption || ''}
                                    className={`w-20 h-20 rounded-xl object-cover border-2 ${isMain ? 'border-teal-500' : 'border-stone-200'}`} />
                                <button
                                    type="button" onClick={() => setMainPick(im.id)}
                                    aria-pressed={isMain}
                                    aria-label={t('animalProfile.photo_make_main') || 'Hacer principal'}
                                    title={t('animalProfile.photo_make_main') || 'Hacer principal'}
                                    className={`absolute bottom-1 left-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold transition-colors ${isMain ? 'bg-teal-600 text-white' : 'bg-white/90 text-stone-600 hover:bg-white'}`}
                                    data-testid={`photo-main-${im.id}`}
                                >
                                    {isMain ? (t('animalProfile.photo_main') || 'Principal') : (
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden><path d="M12 3l2.6 5.8 6.4.7-4.8 4.3 1.4 6.2-5.6-3.2-5.6 3.2 1.4-6.2L3 9.5l6.4-.7z" /></svg>
                                    )}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setRemoved(prev => new Set(prev).add(im.id));
                                        setMainPick(cur => cur === im.id ? null : cur);
                                    }}
                                    aria-label={t('animalProfile.photo_remove') || 'Quitar foto'}
                                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-stone-800 text-white text-xs leading-none grid place-items-center"
                                    data-testid={`photo-remove-${im.id}`}
                                >×</button>
                            </div>
                        );
                    })}
                    {keptNew.map(im => {
                        const isMain = shownMain === im.id;
                        return (
                            <div key={im.id} className="relative">
                                <img src={im.dataUrl} alt="" className={`w-20 h-20 rounded-xl object-cover border-2 ${isMain ? 'border-teal-500' : 'border-stone-200'}`} />
                                <button
                                    type="button" onClick={() => setMainPick(im.id)} aria-pressed={isMain}
                                    aria-label={t('animalProfile.photo_make_main') || 'Hacer principal'}
                                    title={t('animalProfile.photo_make_main') || 'Hacer principal'}
                                    className={`absolute bottom-1 left-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold transition-colors ${isMain ? 'bg-teal-600 text-white' : 'bg-white/90 text-stone-600 hover:bg-white'}`}
                                    data-testid={`photo-main-${im.id}`}
                                >
                                    {isMain ? (t('animalProfile.photo_main') || 'Principal') : (
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden><path d="M12 3l2.6 5.8 6.4.7-4.8 4.3 1.4 6.2-5.6-3.2-5.6 3.2 1.4-6.2L3 9.5l6.4-.7z" /></svg>
                                    )}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setRemoved(prev => new Set(prev).add(im.id));
                                        setMainPick(cur => cur === im.id ? null : cur);
                                    }}
                                    aria-label={t('animalProfile.photo_remove') || 'Quitar foto'}
                                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-stone-800 text-white text-xs leading-none grid place-items-center"
                                    data-testid={`photo-remove-${im.id}`}
                                >×</button>
                            </div>
                        );
                    })}
                    {added.map(({ key, dataUrl }) => {
                        const isMain = shownMain === key;
                        return (
                            <div key={key} className="relative">
                                <img src={dataUrl} alt="" className={`w-20 h-20 rounded-xl object-cover border-2 ${isMain ? 'border-teal-500' : 'border-teal-200'}`} />
                                <button
                                    type="button" onClick={() => setMainPick(key)} aria-pressed={isMain}
                                    aria-label={t('animalProfile.photo_make_main') || 'Hacer principal'}
                                    title={t('animalProfile.photo_make_main') || 'Hacer principal'}
                                    className={`absolute bottom-1 left-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold transition-colors ${isMain ? 'bg-teal-600 text-white' : 'bg-white/90 text-stone-600 hover:bg-white'}`}
                                >
                                    {isMain ? (t('animalProfile.photo_main') || 'Principal') : (
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden><path d="M12 3l2.6 5.8 6.4.7-4.8 4.3 1.4 6.2-5.6-3.2-5.6 3.2 1.4-6.2L3 9.5l6.4-.7z" /></svg>
                                    )}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setAdded(prev => prev.filter(x => x.key !== key));
                                        setMainPick(cur => cur === key ? null : cur);
                                    }}
                                    aria-label={t('animalProfile.photo_remove') || 'Quitar foto'}
                                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-stone-800 text-white text-xs leading-none grid place-items-center"
                                >×</button>
                            </div>
                        );
                    })}
                    <label className="w-20 h-20 rounded-xl border border-dashed border-stone-300 grid place-items-center cursor-pointer text-stone-500 hover:border-teal-400 transition-colors">
                        {uploading ? (
                            <span className="w-4 h-4 border-2 border-stone-300 border-t-teal-600 rounded-full animate-spin" aria-label={t('animalProfile.saving') || 'Cargando'} />
                        ) : (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M4 8h3l2-2h6l2 2h3v11H4V8z" /><circle cx="12" cy="13" r="3.5" /></svg>
                        )}
                        <input
                            type="file" accept="image/*" className="hidden"
                            onChange={pickPhoto} disabled={uploading}
                            aria-label={t('animalProfile.photo_add') || 'Agregar foto'}
                            data-testid="animal-photo-input"
                        />
                    </label>
                </div>
                {warnsEmpty && (
                    <p className="mt-2 text-xs font-medium" style={{ color: 'var(--status-warning-text)' }} data-testid="photo-empty-warning">
                        {t('animalProfile.photos_none_warning') || 'Sin fotos el animal no aparece en la página pública de adopciones.'}
                    </p>
                )}
            </div>

            <p className="mt-2 text-xs text-stone-500">{t('animalProfile.edit_hint') || 'Solo la identidad. La tenencia y la salud se registran desde la ficha.'}</p>
            <div className="flex gap-2 mt-3">
                <button type="button" onClick={handleSave} disabled={saving || uploading} className="px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-40 transition-colors" data-testid="inline-edit-save">
                    {saving ? (t('animalProfile.saving') || 'Guardando…') : (t('common.save') || 'Guardar')}
                </button>
                <button type="button" onClick={onCancel} disabled={saving} className="px-4 py-2.5 rounded-xl text-sm font-semibold text-stone-600 bg-stone-100 hover:bg-stone-200 transition-colors" data-testid="inline-edit-cancel">
                    {t('common.cancel') || 'Cancelar'}
                </button>
            </div>
        </div>
    );
}
