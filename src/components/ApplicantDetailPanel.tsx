'use client';

/**
 * Per-animal applicant deep-dive panel (v34). Slides in from the right on
 * desktop, becomes a bottom sheet on mobile. Built to consolidate the two
 * pages a rescuer otherwise has to ping-pong between to decide who to send
 * a contract to: the adopter profile (rating + flags + history) and the
 * form answers (intent + household + species + full Q&A).
 *
 * Includes Prev/Next paging so the rescuer cycles through applicants without
 * losing the comparison context. Keyboard: ←/→ paging, Esc closes.
 */

import { useCallback, useEffect, useState } from 'react';
import { emailHandle } from '@/lib/userDisplay';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { extractErrorId } from '@/lib/errorUtils';
import { formatShortDate } from '@/lib/dates';
import { RatingBadge } from '@/components/RatingBadge';
import { RatingExplainer } from '@/components/RatingExplainer';
import FormAnswersPanel from '@/components/FormAnswersPanel';
import { createContractInvitation } from '@/app/actions/contract';
import type { ApplicantSummary } from '@/app/actions/applicants';

interface Props {
    applicants: ApplicantSummary[];
    initialIndex: number;
    animalId: string;
    animalName: string;
    onClose: () => void;
    /** Fired after a contract invitation is issued; lets the parent refresh state. */
    onContractIssued?: (token: string, applicant: ApplicantSummary) => void;
}

function FlagBadge({ icon, label, tone }: { icon: string; label: string; tone: 'warn' | 'ok' | 'info' }) {
    const cls = tone === 'warn'
        ? 'bg-rose-50 text-rose-700 border-rose-200'
        : tone === 'ok'
            ? 'bg-teal-50 text-teal-700 border-teal-200'
            : 'bg-stone-100 text-stone-600 border-stone-200';
    return (
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${cls}`}>
            {icon} {label}
        </span>
    );
}

export default function ApplicantDetailPanel({ applicants, initialIndex, animalId, animalName, onClose, onContractIssued }: Props) {
    const { t, locale } = useLanguage();
    const toast = useShowToast();
    const [index, setIndex] = useState(initialIndex);
    const [busy, setBusy] = useState(false);
    const [shareUrl, setShareUrl] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const total = applicants.length;
    const applicant = applicants[index];

    const goPrev = useCallback(() => {
        setShareUrl(null); setCopied(false);
        setIndex(i => Math.max(0, i - 1));
    }, []);
    const goNext = useCallback(() => {
        setShareUrl(null); setCopied(false);
        setIndex(i => Math.min(total - 1, i + 1));
    }, [total]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowLeft' && index > 0) goPrev();
            else if (e.key === 'ArrowRight' && index < total - 1) goNext();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [index, total, goPrev, goNext, onClose]);

    if (!applicant) return null;

    const handleSend = async () => {
        if (!applicant.adopterId || busy) return;
        setBusy(true);
        try {
            const result = await createContractInvitation(animalId, applicant.adopterId, locale);
            if (result.success && result.url) {
                setShareUrl(result.url);
                onContractIssued?.(result.url, applicant);
            } else {
                toast.error(t('errors.generic') || 'Error', result.error || 'No se pudo generar la invitación');
            }
        } catch (e) {
            toast.error(t('errors.generic') || 'Error', undefined, extractErrorId(e));
        } finally {
            setBusy(false);
        }
    };

    const copy = async () => {
        if (!shareUrl) return;
        try {
            await navigator.clipboard.writeText(shareUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch { /* ignore */ }
    };

    const sourcePill = (() => {
        const s = applicant.adopterContext?.source;
        if (!s || s === 'manual') return null;
        if (s === 'form') return <span className="text-[11px] px-1.5 py-0.5 rounded-full font-semibold bg-teal-50 text-teal-700">📝 {t('myAdopters.source_form') || 'Form'}</span>;
        if (s === 'contract') return <span className="text-[11px] px-1.5 py-0.5 rounded-full font-semibold bg-amber-50 text-amber-800">✍️ {t('myAdopters.source_contract') || 'Contract'}</span>;
        if (s === 'imported') return <span className="text-[11px] px-1.5 py-0.5 rounded-full font-semibold bg-stone-100 text-stone-600">📥 {t('myAdopters.source_imported') || 'Imported'}</span>;
        return null;
    })();

    const flagPills: React.ReactNode[] = [];
    if (applicant.flags) {
        const f = applicant.flags;
        if (f.verified_identity) flagPills.push(<FlagBadge key="vid" icon="✓" label={t('flags.verified_identity') || 'Verified ID'} tone="ok" />);
        if (f.verified_address) flagPills.push(<FlagBadge key="vad" icon="✓" label={t('flags.verified_address') || 'Verified address'} tone="ok" />);
        if (f.inaccurate) flagPills.push(<FlagBadge key="ina" icon="⚠" label={t('flags.inaccurate') || 'Inaccurate'} tone="warn" />);
        if (f.duplicate) flagPills.push(<FlagBadge key="dup" icon="📄" label={t('flags.duplicate') || 'Duplicate'} tone="warn" />);
    }

    const fullAnswers = (() => {
        try { return applicant.submission.answersJson ? JSON.parse(applicant.submission.answersJson) : {}; }
        catch { return {}; }
    })();

    const primaryAction: React.ReactNode = applicant.isSigned ? (
        <span className="w-full flex items-center justify-center px-4 py-3 rounded-xl bg-teal-100 text-teal-800 font-semibold">
            ✓ {t('myAnimals.applicants_signed') || 'Firmado'}
        </span>
    ) : !applicant.adopterId ? (
        <Link
            href={`/form-results/${applicant.submissionId}`}
            className="w-full flex items-center justify-center px-4 py-3 rounded-xl bg-stone-700 text-white font-semibold hover:bg-stone-600 transition-colors"
        >
            {t('myAnimals.applicants_view_form') || 'Ver formulario'}
        </Link>
    ) : (
        <button
            type="button"
            onClick={handleSend}
            disabled={busy}
            className="w-full px-4 py-3 rounded-xl bg-teal-700 text-white font-semibold hover:bg-teal-600 disabled:opacity-50 transition-colors shadow-lg shadow-teal-700/20"
        >
            {busy
                ? (t('common.processing') || 'Procesando...')
                : applicant.hasInvite
                    ? (t('myAnimals.applicants_resend') || 'Reenviar contrato')
                    : (t('myAnimals.applicants_send_contract') || 'Enviar contrato')}
        </button>
    );

    const wa = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
    const mailto = (subject: string, body: string) => `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    const shareText = shareUrl ? `Contrato de adopción para ${animalName} — ${applicant.adopterName}\n${shareUrl}` : '';

    return (
        <div
            className="fixed inset-0 z-[60]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="applicant-panel-title"
            onClick={onClose}
        >
            <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm animate-in fade-in duration-200" />
            <div
                className={[
                    'absolute bg-white shadow-2xl border-stone-200 animate-in duration-300 flex flex-col',
                    // Mobile: bottom sheet
                    'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl border-t slide-in-from-bottom-4',
                    // Desktop: right-side panel
                    'md:left-auto md:top-0 md:bottom-0 md:right-0 md:w-[32rem] md:max-h-none md:rounded-none md:rounded-l-2xl md:border-l md:border-t-0 md:slide-in-from-right-4',
                ].join(' ')}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Sticky header — paging + close */}
                <div className="sticky top-0 z-10 bg-white border-b border-stone-200 px-4 py-3 flex items-center justify-between gap-2">
                    <button
                        type="button"
                        onClick={goPrev}
                        disabled={index === 0}
                        className="px-2 py-1 text-xs font-semibold text-stone-700 hover:bg-stone-100 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        ← {t('myAnimals.applicants_panel_prev') || 'Anterior'}
                    </button>
                    <div className="flex items-center gap-1.5 flex-1 justify-center" aria-label={`${index + 1} / ${total}`}>
                        {applicants.map((_, i) => (
                            <span
                                key={i}
                                className={`w-1.5 h-1.5 rounded-full ${i === index ? 'bg-teal-700' : 'bg-stone-300'}`}
                            />
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={goNext}
                        disabled={index === total - 1}
                        className="px-2 py-1 text-xs font-semibold text-stone-700 hover:bg-stone-100 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        {t('myAnimals.applicants_panel_next') || 'Siguiente'} →
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={t('common.close') || 'Close'}
                        className="ml-1 w-8 h-8 rounded-full flex items-center justify-center text-stone-500 hover:bg-stone-100"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>

                {/* Scrolling body */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                    {/* Identity block */}
                    <div>
                        <h2 id="applicant-panel-title" className="text-xl font-bold text-stone-900 break-words">{applicant.adopterName}</h2>
                        <div className="flex items-center flex-wrap gap-2 mt-1.5">
                            {applicant.adopterRating != null ? (
                                <RatingExplainer rating={applicant.adopterRating}>
                                    <RatingBadge rating={applicant.adopterRating} size="sm" label="short" />
                                </RatingExplainer>
                            ) : (
                                <span className="text-xs text-stone-400 italic">{t('myAdopters.rating_empty_hint')?.split(' — ')[0] || 'Sin actividad calificada'}</span>
                            )}
                            {sourcePill}
                            {applicant.appliedAt && (
                                <span className="text-xs text-stone-500">{formatShortDate(applicant.appliedAt)}</span>
                            )}
                        </div>
                    </div>

                    {/* PERFIL section */}
                    <section>
                        <h3 className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-2">
                            {t('myAnimals.applicants_panel_section_profile') || 'Perfil del adoptante'}
                        </h3>
                        {applicant.adopterId ? (
                            <div className="space-y-2">
                                {flagPills.length > 0 ? (
                                    <div className="flex flex-wrap gap-1">{flagPills}</div>
                                ) : (
                                    <p className="text-xs text-stone-400 italic">{t('myAnimals.applicants_panel_no_flags') || 'Sin alertas'}</p>
                                )}
                                <p className="text-sm text-stone-700">
                                    📊 {(t('myAnimals.applicants_panel_activity') || '{adoptions} adopciones · {requests} pedidos')
                                        .replace('{adoptions}', String(applicant.adoptionCount))
                                        .replace('{requests}', String(applicant.requestCount))}
                                </p>
                                {applicant.adopterContext?.addedBy && (
                                    <p className="text-xs text-stone-500 truncate">
                                        👤 {(t('myAnimals.applicants_panel_added_by') || 'Agregado por {email}').replace('{email}', emailHandle(applicant.adopterContext.addedBy))}
                                    </p>
                                )}
                                <a
                                    href={`/adopter/${applicant.adopterId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-800 mt-1"
                                >
                                    {t('myAnimals.applicants_panel_view_full_profile') || 'Ver perfil completo'}
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                </a>
                            </div>
                        ) : (
                            <p className="text-sm text-stone-500 italic">
                                {t('myAnimals.applicants_panel_no_adopter') || 'Sin perfil vinculado — el formulario no creó un adoptante automáticamente.'}
                            </p>
                        )}
                    </section>

                    {/* RESPUESTAS section */}
                    <section>
                        <h3 className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-2">
                            {t('myAnimals.applicants_panel_section_form') || 'Respuestas del formulario'}
                        </h3>
                        <div className="space-y-2 text-sm">
                            {applicant.intent && (
                                <p className="text-stone-700">
                                    🎯 <span className="font-medium">{t('myAnimals.applicants_panel_intent_label') || 'Intención'}:</span>{' '}
                                    {applicant.intent === 'self'
                                        ? (t('myAnimals.applicants_row_summary_intent_self') || 'Para sí')
                                        : applicant.intent === 'gift'
                                            ? (t('myAnimals.applicants_row_summary_intent_gift') || 'Como regalo')
                                            : applicant.intent}
                                </p>
                            )}
                            {(applicant.species || applicant.lifeStage) && (
                                <p className="text-stone-700">
                                    🐾 <span className="font-medium">{t('myAnimals.applicants_panel_pref_label') || 'Prefiere'}:</span>{' '}
                                    {[
                                        applicant.species && t(`myAnimals.applicants_row_summary_species_${applicant.species}`),
                                        applicant.lifeStage && t(`myAnimals.applicants_row_summary_lifestage_${applicant.lifeStage}`),
                                    ].filter(Boolean).join(' · ')}
                                </p>
                            )}
                            {applicant.submission.household && applicant.submission.household.length > 0 && (
                                <p className="text-stone-700">
                                    🏠 <span className="font-medium">{t('myAnimals.applicants_panel_household_label') || 'Hogar'}:</span>{' '}
                                    {applicant.submission.household.join(' · ')}
                                </p>
                            )}
                            {applicant.submission.selfieUrl && (
                                <div>
                                    <p className="text-xs font-medium text-stone-500 mb-1">{t('myAnimals.applicants_panel_selfie_label') || 'Selfie'}</p>
                                    <img
                                        src={applicant.submission.selfieUrl.includes('r2.dev')
                                            ? `/api/proxy-image?url=${encodeURIComponent(applicant.submission.selfieUrl)}`
                                            : applicant.submission.selfieUrl}
                                        alt=""
                                        className="w-24 h-24 rounded-xl object-cover border border-stone-200"
                                    />
                                </div>
                            )}
                            {(applicant.submission.latitude && applicant.submission.longitude) && (
                                <p className="text-xs text-stone-500">
                                    📍 {applicant.submission.latitude}, {applicant.submission.longitude}
                                </p>
                            )}
                            <a
                                href={`/form-results/${applicant.submissionId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-800 mt-1"
                            >
                                {t('myAnimals.applicants_panel_view_full_form') || 'Ver formulario completo'}
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                            </a>
                        </div>

                        {Object.keys(fullAnswers).length > 0 && (
                            <details className="mt-3 group">
                                <summary className="cursor-pointer text-xs font-semibold text-stone-600 hover:text-stone-800 select-none">
                                    ▸ {t('myAnimals.applicants_panel_all_answers') || 'Todas las respuestas'}
                                </summary>
                                <div className="mt-2 pl-2 border-l-2 border-stone-200">
                                    <FormAnswersPanel fullAnswers={fullAnswers} />
                                </div>
                            </details>
                        )}
                    </section>
                </div>

                {/* Sticky footer — primary action */}
                <div className="sticky bottom-0 bg-white border-t border-stone-200 px-5 py-3 space-y-2">
                    {shareUrl ? (
                        <div className="space-y-2">
                            <p className="text-xs font-semibold text-teal-700">
                                ✓ {(t('myAnimals.applicants_panel_invite_ready') || 'Invitación lista para {name}').replace('{name}', applicant.adopterName)}
                            </p>
                            <code className="block text-[11px] text-stone-500 truncate p-2 bg-stone-50 rounded-lg" title={shareUrl}>{shareUrl}</code>
                            <div className="grid grid-cols-3 gap-2">
                                <button
                                    type="button"
                                    onClick={copy}
                                    className="px-2 py-1.5 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg transition-colors"
                                >
                                    {copied ? '✅' : '🔗'} {copied ? (t('myAnimals.showcase_copied') || 'Copiado') : (t('common.copy_link') || 'Copiar')}
                                </button>
                                <a
                                    href={wa(shareText)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-2 py-1.5 text-xs font-semibold text-stone-700 bg-green-50 hover:bg-green-100 rounded-lg text-center transition-colors"
                                >
                                    💬 WhatsApp
                                </a>
                                <a
                                    href={mailto(`Contrato — ${animalName}`, shareText)}
                                    className="px-2 py-1.5 text-xs font-semibold text-stone-700 bg-blue-50 hover:bg-blue-100 rounded-lg text-center transition-colors"
                                >
                                    📧 Email
                                </a>
                            </div>
                        </div>
                    ) : (
                        primaryAction
                    )}
                </div>
            </div>
        </div>
    );
}
