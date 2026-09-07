'use client';

/**
 * v2.55.15 (animal-timeline PR2): the animal's line of life.
 * Mirrors AdoptionHistory's visual language (rail, dot+ring beacons, left
 * stripe per type, 3-col header) over the animal-scoped item union:
 * custody spans (start/end), animal-linked adopter events (follow-ups,
 * returns) and care events (vaccination, deworming, vet, neuter, notes).
 * Images arrive as props (server-fetched) — no client-side N+1.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { formatShortDate } from '@/lib/dates';
import { emailHandle } from '@/lib/userDisplay';
import { adopterDisplayName } from '@/lib/adopterDisplay';
import type { AnimalTimelineItem } from '@/app/actions/animalTimeline';

// Literal Tailwind classes so the purger keeps them (same trick as AdoptionHistory).
const STRIPE: Record<string, string> = {
    adoption: 'border-l-teal-500',
    foster: 'border-l-indigo-500',
    follow_up: 'border-l-violet-500',
    returned_pet: 'border-l-rose-500',
    vaccination: 'border-l-emerald-500',
    deworming: 'border-l-lime-500',
    vet_visit: 'border-l-cyan-500',
    neuter: 'border-l-fuchsia-500',
    note: 'border-l-stone-400',
    end: 'border-l-stone-300',
    created: 'border-l-teal-500',
};
const DOT: Record<string, string> = {
    adoption: 'bg-teal-500 ring-teal-200',
    foster: 'bg-indigo-500 ring-indigo-200',
    follow_up: 'bg-violet-500 ring-violet-200',
    returned_pet: 'bg-rose-500 ring-rose-200',
    vaccination: 'bg-emerald-500 ring-emerald-200',
    deworming: 'bg-lime-500 ring-lime-200',
    vet_visit: 'bg-cyan-500 ring-cyan-200',
    neuter: 'bg-fuchsia-500 ring-fuchsia-200',
    note: 'bg-stone-400 ring-stone-200',
    end: 'bg-stone-300 ring-stone-200',
    created: 'bg-teal-500 ring-teal-200',
};

function ItemIcon({ type, className = 'w-2.5 h-2.5 text-white' }: { type: string; className?: string }) {
    const paths: Record<string, string> = {
        adoption: 'M3 11l9-8 9 8M5 10v10h14V10',
        foster: 'M12 21C7 17 3 13.5 3 9.5 3 7 5 5 7.5 5c1.7 0 3.2.9 4.5 2.5C13.3 5.9 14.8 5 16.5 5 19 5 21 7 21 9.5c0 4-4 7.5-9 11.5z',
        follow_up: 'M4 12a8 8 0 0113.6-5.6M20 12a8 8 0 01-13.6 5.6M17 3v4h4M7 21v-4H3',
        returned_pet: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-4',
        vaccination: 'M17 3l4 4M19 5l-9 9-4 1 1-4 9-9zM6 15l-3 6 6-3',
        deworming: 'M12 8v8M8 12h8M12 21a9 9 0 100-18 9 9 0 000 18z',
        vet_visit: 'M12 4v16M4 12h16',
        neuter: 'M8.5 8.5L20 20M8.5 15.5L20 4M8 6a2 2 0 11-4 0 2 2 0 014 0zM8 18a2 2 0 11-4 0 2 2 0 014 0z',
        note: 'M5 4h14v16H5zM9 9h6M9 13h6',
        end: 'M5 12h14',
        // paw — the origin of the line of life
        created: 'M7 7.5a1.5 1.5 0 100 .01M12 5.5a1.5 1.5 0 100 .01M17 7.5a1.5 1.5 0 100 .01M12 11c-3 0-5.5 2.2-5.5 4.5 0 1.4 1.1 2.5 2.5 2.5 1 0 1.9-.4 3-.4s2 .4 3 .4c1.4 0 2.5-1.1 2.5-2.5C17.5 13.2 15 11 12 11z',
    };
    return (
        <svg className={className} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d={paths[type] || paths.note} />
        </svg>
    );
}

/** A projected follow-up prepared for display by AnimalProfile. */
export type TimelineProjected = {
    key: string;
    label: string;
    status: 'due' | 'upcoming';
    dueDate: number;
    /** "te quedan 5 días para registrarlo" */
    windowCopy: string;
    /** Which beacon icon to draw. */
    iconType: string;
    onRegister: () => void;
    contact?: React.ReactNode;
};
export type TimelineMissed = { key: string; label: string; dueDate: number; onRegister: () => void };

export default function AnimalTimeline({ items, animalSex, userNameMap = {}, orgName = null, projected = [], missed = [], onAddEvent }: {
    items: AnimalTimelineItem[];
    animalSex: string | null;
    /** v2.55.18: resolved display names for every recordedBy email. */
    userNameMap?: Record<string, string>;
    /** The owner's org name, for the origin event's copy. */
    orgName?: string | null;
    /** v2.56.12: future slots share this component's rail — same line, same
     *  beacons — so past and future read as one continuous life. */
    projected?: TimelineProjected[];
    missed?: TimelineMissed[];
    onAddEvent?: () => void;
}) {
    const { t } = useLanguage();
    const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
    const [showMissed, setShowMissed] = useState(false);

    const fem = animalSex === 'hembra' || animalSex === 'female' || animalSex === 'Hembra';

    const verbFor = (item: AnimalTimelineItem): React.ReactNode => {
        const adopter = item.adopterId ? (
            <Link href={`/adopter/${item.adopterId}`} className="font-semibold hover:underline" onClick={e => e.stopPropagation()}>
                {adopterDisplayName({ name: item.adopterName }, t('adopter.nameless'))}
            </Link>
        ) : null;
        switch (item.kind) {
            case 'created':
                return <span className="font-semibold">
                    {(fem ? t('animalProfile.origin_f') : t('animalProfile.origin_m')) || 'Rescatado y registrado'}
                    {orgName ? ` ${t('animalProfile.origin_in') || 'en'} ${orgName}` : ''}
                </span>;
            case 'placement_start':
                return item.type === 'foster'
                    ? <>{t('animalProfile.verb_foster_start') || 'Entró en tránsito con'} {adopter}</>
                    : <>{(fem ? t('animalProfile.verb_adopted_f') : t('animalProfile.verb_adopted_m')) || 'Adoptado por'} {adopter}</>;
            case 'placement_end':
                return <>
                    {item.type === 'foster'
                        ? (t('animalProfile.verb_foster_end') || 'Terminó el tránsito con')
                        : (t('animalProfile.verb_adoption_end') || 'Terminó la adopción con')} {adopter}
                    {item.spanDays != null && <span className="text-stone-500 font-normal"> · {item.spanDays} {t('animalProfile.days') || 'días'}</span>}
                </>;
            case 'adopter_event':
                return item.type === 'returned_pet'
                    ? <>{(fem ? t('animalProfile.verb_returned_f') : t('animalProfile.verb_returned_m')) || 'Devuelto por'} {adopter}</>
                    : <>{t('animalProfile.verb_followup') || 'Seguimiento a'} {adopter}</>;
            default:
                return <span className="font-semibold">{t(`animalProfile.event_type_${item.type}`) || item.type}</span>;
        }
    };

    // Contract evidence (placement comments JSON) — replaces the old card link.
    const contractShotOf = (item: AnimalTimelineItem): string | null => {
        if (item.kind !== 'placement_start' || !item.comments) return null;
        try {
            const parsed = JSON.parse(item.comments);
            return typeof parsed?.contractScreenshot === 'string' ? parsed.contractScreenshot : null;
        } catch { return null; }
    };

    return (
        <div className="relative pl-6 md:pl-8" data-testid="animal-timeline">
            {/* vertical rail */}
            <div className="absolute left-[7px] md:left-[15px] top-2 bottom-2 w-0.5 bg-stone-200" aria-hidden />

            {/* ── what's coming: same rail, dashed beacons (not yet happened) ── */}
            {projected.length > 0 && (
                <div className="space-y-3 mb-3" data-testid="projected-section">
                    {[...projected].sort((a, b) => b.dueDate - a.dueDate).map(p => (
                        <div key={p.key} className="relative" data-testid={`projected-item-${p.key}`}>
                            <div
                                className="absolute -left-6 top-3.5 w-4 h-4 rounded-full flex items-center justify-center border-2 border-dashed"
                                style={p.status === 'due'
                                    ? { background: 'var(--surface-card)', borderColor: 'var(--status-warning-border)', color: 'var(--status-warning-text)' }
                                    : { background: 'var(--surface-card)', borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
                            >
                                <ItemIcon type={p.iconType} className="w-2 h-2" />
                            </div>
                            <div
                                className="rounded-xl border-2 border-dashed px-4 py-3"
                                style={p.status === 'due'
                                    ? { background: 'var(--status-warning-bg)', borderColor: 'var(--status-warning-border)' }
                                    : { background: 'transparent', borderColor: 'var(--border-default)' }}
                            >
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-semibold flex-1 min-w-[160px]" style={{ color: 'var(--text-secondary)' }}>{p.label}</p>
                                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${p.status === 'due' ? 'bg-amber-100 text-amber-700' : 'bg-stone-100 text-stone-500'}`}>
                                        {p.status === 'due' ? (t('followups.status_due') || 'Pendiente') : (t('followups.status_upcoming') || 'Programado')}
                                    </span>
                                    <span className="text-xs text-stone-500 tabular-nums">{formatShortDate(p.dueDate)}</span>
                                </div>
                                {p.status === 'due' && (
                                    <div className="flex flex-wrap items-center gap-2 mt-2">
                                        <button
                                            type="button" onClick={p.onRegister}
                                            className="inline-flex px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 transition-colors"
                                        >
                                            {t('followups.register') || 'Registrar'}
                                        </button>
                                        {p.contact}
                                        <span className="text-[11px] text-stone-500">{p.windowCopy}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ── HOY: the boundary between what's coming and what happened —
                   and where adding something new belongs. ── */}
            <div className="relative mb-3">
                <div className="absolute -left-6 top-1.5 w-4 h-4 rounded-full bg-teal-600 ring-2 ring-teal-200 ring-offset-2 ring-offset-stone-50" aria-hidden />
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-teal-700">{t('followups.today') || 'Hoy'}</span>
                    <span className="flex-1 h-px bg-stone-200 min-w-[16px]" aria-hidden />
                    {onAddEvent && (
                        <button
                            type="button"
                            onClick={onAddEvent}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-teal-700 bg-teal-50 border border-teal-100 hover:border-teal-400 transition-colors"
                            data-testid="add-animal-event"
                        >
                            + {t('animalProfile.add_event') || 'Agregar evento'}
                        </button>
                    )}
                </div>
            </div>

            {/* ── expired reminders: collapsed, but still loggable ── */}
            {missed.length > 0 && (
                <div className="mb-3">
                    <button
                        type="button"
                        onClick={() => setShowMissed(v => !v)}
                        aria-expanded={showMissed}
                        className="w-full text-left px-4 py-2 rounded-xl border border-dashed text-xs font-semibold text-stone-500 hover:bg-stone-100 transition-colors"
                        style={{ borderColor: 'var(--border-default)' }}
                    >
                        {showMissed ? '▾' : '▸'} {missed.length} {missed.length === 1
                            ? (t('followups.missed_one') || 'recordatorio vencido')
                            : (t('followups.missed_many') || 'recordatorios vencidos')}
                    </button>
                    {showMissed && (
                        <div className="mt-2 space-y-1.5">
                            {missed.map(m => (
                                <div
                                    key={m.key}
                                    className="flex flex-wrap items-center gap-2 px-4 py-2 rounded-lg border border-dashed text-xs text-stone-500"
                                    style={{ borderColor: 'var(--border-default)' }}
                                    data-testid={`missed-slot-${m.key}`}
                                >
                                    <span className="font-semibold flex-1 min-w-[140px]">{m.label}</span>
                                    <span className="tabular-nums">{formatShortDate(m.dueDate)}</span>
                                    <button
                                        type="button"
                                        onClick={m.onRegister}
                                        className="inline-flex px-3 py-1.5 rounded-lg text-xs font-bold text-teal-700 bg-teal-50 border border-teal-100 hover:border-teal-400 transition-colors"
                                        data-testid={`register-missed-${m.key}`}
                                    >
                                        {t('followups.register_late') || 'Registrar igual'}
                                    </button>
                                </div>
                            ))}
                            <p className="text-[11px] text-stone-500 px-1">{t('followups.missed_hint') || 'Ya no te los recordamos, pero podés registrarlos igual — quedan marcados como hechos.'}</p>
                        </div>
                    )}
                </div>
            )}

            <div className="space-y-3">
                {items.map(item => {
                    const shot = contractShotOf(item);
                    const noteTooLong = (item.details?.length ?? 0) > 120;
                    const noteOpen = expandedNotes.has(item.id);
                    return (
                        <div key={item.id} id={`evt-${item.id}`} className="relative" data-testid="timeline-item">
                            <div className={`absolute -left-6 top-3.5 w-4 h-4 rounded-full flex items-center justify-center ring-2 ring-offset-2 ring-offset-stone-50 ${DOT[item.type] || DOT.note} ${item.kind === 'placement_end' ? DOT.end : ''}`}>
                                <ItemIcon type={item.kind === 'placement_end' ? 'end' : item.type} />
                            </div>
                            <div className={`bg-white rounded-xl border border-stone-200 border-l-[3px] ${item.kind === 'placement_end' ? STRIPE.end : (STRIPE[item.type] || STRIPE.note)} px-4 py-3 shadow-sm`}>
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                    <div className="text-sm font-medium text-stone-800 flex-1 min-w-0">{verbFor(item)}</div>
                                    {item.rating != null && (
                                        <span className="text-xs font-semibold text-amber-600 whitespace-nowrap">★ {item.rating}</span>
                                    )}
                                    <span className="text-xs text-stone-500 whitespace-nowrap ml-auto tabular-nums">
                                        {item.date ? formatShortDate(item.date) : '—'}
                                    </span>
                                </div>
                                {item.details && (
                                    <div className="mt-1 text-[13px] text-stone-600">
                                        <p className={noteTooLong && !noteOpen ? 'line-clamp-2' : ''}>{item.details}</p>
                                        {noteTooLong && (
                                            <button
                                                type="button"
                                                className="text-xs font-semibold text-teal-700 hover:underline mt-0.5"
                                                onClick={() => setExpandedNotes(prev => {
                                                    const next = new Set(prev);
                                                    if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                                                    return next;
                                                })}
                                            >
                                                {noteOpen ? (t('common.show_less') || 'ver menos') : (t('animalProfile.read_more') || 'leer más')}
                                            </button>
                                        )}
                                    </div>
                                )}
                                {shot && (
                                    <a
                                        href={shot} target="_blank" rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1.5 mt-2 px-2 py-1 bg-teal-50 rounded-lg text-xs font-medium text-teal-700 hover:bg-teal-100 transition-colors"
                                    >
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7 3h10l4 4v14H3V7l4-4z" /></svg>
                                        {t('dashboard.view_signed_contract') || 'Ver contrato firmado'}
                                    </a>
                                )}
                                {item.images.length > 0 && (
                                    <div className="flex gap-1.5 mt-2">
                                        {item.images.slice(0, 4).map(im => (
                                            <img key={im.id} src={im.thumbnailUrl || im.url} alt={im.caption || ''} className="w-12 h-12 rounded-lg object-cover border border-stone-200" />
                                        ))}
                                        {item.images.length > 4 && (
                                            <span className="w-12 h-12 rounded-lg bg-stone-100 text-stone-500 text-xs font-semibold flex items-center justify-center">+{item.images.length - 4}</span>
                                        )}
                                    </div>
                                )}
                                {/* Audit identity ALWAYS visible (v2.55.18: incl. the viewer's
                                    own records — team parity makes authorship the ledger). */}
                                {item.recordedBy && item.recordedBy !== 'anonymous' && (
                                    <div className="mt-2 text-[11px] text-stone-500">
                                        {t('common.added_by') || 'Agregado por'} {userNameMap[item.recordedBy] || emailHandle(item.recordedBy)}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
                {items.length === 0 && (
                    <p className="text-sm text-stone-500 italic py-2" data-testid="animal-timeline-empty">
                        {t('animalProfile.timeline_empty') || 'Todavía no hay eventos en la línea de vida.'}
                    </p>
                )}
            </div>
        </div>
    );
}
