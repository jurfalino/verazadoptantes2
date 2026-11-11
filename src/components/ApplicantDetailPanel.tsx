'use client';

/**
 * Per-animal applicant deep-dive panel (v34). Slides in from the right on
 * desktop, becomes a bottom sheet on mobile. Built to consolidate the two
 * pages a rescuer otherwise has to ping-pong between to decide who to send
 * a contract to: the adopter profile (rating + flags + history) and the
 * form answers.
 *
 * The evaluation (spec docs/superpowers/specs/2026-11-10-applicant-evaluation-design.md):
 * where the application stands (ApplicationStatusLine), the possible duplicate
 * as the same side-by-side compare every same-person screen uses, the answers
 * that need a look, and the two ways an evaluation ends — «No avanzar» plus
 * «Enviar contrato» for an animal, «No avanzar» plus «Proponer un animal» for a
 * general application (`animal` null, «Sin animal elegido»). After an outcome
 * the list is re-read (`onOutcome`) and the panel moves to the next one to
 * evaluate, or closes when none is left.
 *
 * Includes Prev/Next paging so the rescuer cycles through applicants without
 * losing the comparison context. Keyboard: ←/→ paging, Esc closes — not while
 * a dialog over it has the keys.
 */

import { OpenProfileLink } from '@/components/OpenProfileLink';
import { useCallback, useEffect, useRef, useState } from 'react';
import { emailHandle } from '@/lib/userDisplay';
import { adopterDisplayName } from '@/lib/adopterDisplay';
import { AdopterName } from '@/components/AdopterName';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { useDateFormat } from '@/context/TimezoneContext';
import { RatingBadge } from '@/components/RatingBadge';
import { RatingExplainer } from '@/components/RatingExplainer';
import FormAnswersPanel, { AnswerRow } from '@/components/FormAnswersPanel';
import FormPhotos from '@/components/FormPhotos';
import { createContractInvitation } from '@/app/actions/contract';
import { zarazTrack } from '@/lib/zaraz';
import type { ApplicantSummary } from '@/app/actions/applicants';
import LocationMap from '@/components/LocationMap';
import { AlertPill, PeriodAlertPills } from '@/components/AlertPill';
import { openFlagKinds, rescuerFlagKinds } from '@/domain/flags';
import { formatRating } from '@/domain/ratings';
import { nextToEvaluateIndex, type ApplicationStatus } from '@/domain/applications';
import { Button, buttonClasses } from '@/components/ui/Button';
import { handledAsStale } from '@/lib/errorMessage';
import { ApplicationStatusLine, animalLine } from '@/components/evaluation/ApplicationStatusLine';
import { ApplicationAnswersSummary } from '@/components/evaluation/ApplicationAnswersSummary';
import { ApplicationDuplicate } from '@/components/evaluation/ApplicationDuplicate';
import { DeclineApplicationDialog } from '@/components/evaluation/DeclineApplicationDialog';
import { ProposeAnimalSheet } from '@/components/evaluation/ProposeAnimalSheet';

interface Props {
    applicants: ApplicantSummary[];
    initialIndex: number;
    /** The animal evaluated for; null = «Sin animal elegido» (general applications). */
    animal: { id: string; name: string; sex: string | null } | null;
    onClose: () => void;
    /** After an outcome: re-read the list; the panel moves to nextToEvaluateIndex or closes on -1. */
    onOutcome?: () => Promise<ApplicantSummary[] | null>;
    /** Opened from a page: the header's close reads «← Volver». */
    returnLabel?: boolean;
    /** Fired after a contract invitation is issued; lets the parent refresh state. */
    onContractIssued?: (url: string, applicant: ApplicantSummary) => void;
    /** The dialog's data-testid (the home opens it as `home-applicants-panel`). */
    testId?: string;
}

/**
 * Where the panel goes after an outcome on the applicant at `decidedIndex`: the
 * decided one leaves the «por evaluar» group, so the next one slid into its
 * slot — search from there, wrapping to the first; -1 when none is left.
 */
export function indexAfterOutcome(statuses: readonly ApplicationStatus[], decidedIndex: number): number {
    return nextToEvaluateIndex(statuses, decidedIndex - 1);
}

const isEditable = (el: EventTarget | null) =>
    el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

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

/** Paging dots up to this many applicants; more get a «{i} / {N}» counter. */
const MAX_PAGING_DOTS = 8;

export default function ApplicantDetailPanel({ applicants, initialIndex, animal, onClose, onOutcome, returnLabel = false, onContractIssued, testId }: Props) {
    const { formatShortDate } = useDateFormat();
    const { t, locale } = useLanguage();
    const toast = useShowToast();
    // The list the panel pages through: the parent's, then whatever `onOutcome` re-read.
    const [list, setList] = useState(applicants);
    const [index, setIndex] = useState(initialIndex);
    const [busy, setBusy] = useState(false);
    const [shareUrl, setShareUrl] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [dialog, setDialog] = useState<'decline' | 'propose' | null>(null);
    const [allAnswersOpen, setAllAnswersOpen] = useState(false);
    const allAnswersRef = useRef<HTMLDetailsElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);

    const total = list.length;
    const applicant = list[index];

    const resetPerApplicant = useCallback(() => {
        setShareUrl(null); setCopied(false); setDialog(null); setAllAnswersOpen(false);
    }, []);
    const goPrev = useCallback(() => {
        resetPerApplicant();
        setIndex(i => Math.max(0, i - 1));
    }, [resetPerApplicant]);
    const goNext = useCallback(() => {
        resetPerApplicant();
        setIndex(i => Math.min(total - 1, i + 1));
    }, [total, resetPerApplicant]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            // A dialog over the panel (No avanzar, the picker, «¿Es la misma persona?»'s confirm) has the keys.
            if (dialog || e.defaultPrevented) return;
            const host = e.target instanceof Element ? e.target.closest('[role="dialog"]') : null;
            if (host && host !== rootRef.current) return;
            if (e.key === 'Escape') onClose();
            else if (isEditable(e.target)) return;
            else if (e.key === 'ArrowLeft' && index > 0) goPrev();
            else if (e.key === 'ArrowRight' && index < total - 1) goNext();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [index, total, goPrev, goNext, onClose, dialog]);

    if (!applicant) return null;

    /**
     * After an outcome (or «Sí, es la misma persona»): re-read the list. An outcome moves on to the
     * next one to evaluate (closing when none is left); a link stays on the same application.
     */
    const afterChange = async (mode: 'outcome' | 'linked') => {
        const decidedIndex = index;
        const decidedId = applicant.applicationId;
        setDialog(null);
        if (!onOutcome) {
            if (mode === 'outcome') onClose();
            return;
        }
        let fresh: ApplicantSummary[] | null = null;
        try {
            fresh = await onOutcome();
        } catch (e) {
            if (!handledAsStale(e)) toast.error(t('errors.generic'), t('evaluation.action_failed'), resolveErrorId(e, 'ApplicantDetailPanel'));
        }
        if (!fresh || fresh.length === 0) {
            onClose();
            return;
        }
        resetPerApplicant();
        setList(fresh);
        if (mode === 'linked') {
            const same = fresh.findIndex(a => a.applicationId === decidedId);
            if (same !== -1) {
                setIndex(same);
                return;
            }
        }
        const next = indexAfterOutcome(fresh.map(a => a.status), decidedIndex);
        if (next === -1) onClose();
        else setIndex(next);
    };

    const openAllAnswers = () => {
        setAllAnswersOpen(true);
        requestAnimationFrame(() => allAnswersRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    };

    const handleSend = async () => {
        if (!animal || !applicant.adopterId || busy) return;
        setBusy(true);
        try {
            const result = await createContractInvitation(animal.id, applicant.adopterId, locale);
            if (result.success && result.url) {
                zarazTrack('contract_issued', { surface: 'applicant_detail' });
                setShareUrl(result.url);
                onContractIssued?.(result.url, applicant);
            } else {
                const message = result.error === 'not_allowed'
                    ? (t('errors.contract_invite_not_allowed') || 'Solo podés enviar el contrato a quien se postuló para este animal.')
                    : (t('errors.contract_invite_failed') || 'No se pudo generar la invitación');
                toast.error(t('errors.generic') || 'Error', message, result.errorId ?? resolveErrorId(new Error(`createContractInvitation: ${result.error}`), 'ApplicantDetailPanel'));
            }
        } catch (e) {
            if (!handledAsStale(e)) toast.error(t('errors.generic') || 'Error', t('errors.contract_invite_failed') || undefined, resolveErrorId(e, 'ApplicantDetailPanel'));
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

    // The person's ALERTS, as the full profile shows them (P2): their period alerts, then the
    // housemate chips — the same pills and words. Read on the server; whatever was read is
    // shown, and «Sin alertas» only when the whole check ran (`alertsChecked`) — after a
    // failed read the panel shows no such line.
    const housemate = applicant.housemateAlert;
    const hasAlerts = !!applicant.flags && (
        !!applicant.flags.tooManyAdoptions || !!applicant.flags.tooManyRequests
        || housemate.lowRating != null || housemate.hasAlerts);

    const flagPills: React.ReactNode[] = [];
    if (applicant.flags) {
        const f = applicant.flags;
        if (f.verified_identity) flagPills.push(<FlagBadge key="vid" icon="✓" label={t('flags.verified_identity') || 'Verified ID'} tone="ok" />);
        if (f.verified_address) flagPills.push(<FlagBadge key="vad" icon="✓" label={t('flags.verified_address') || 'Verified address'} tone="ok" />);
        // The flags, neutral, by name — never «Inexacto» (rescuerFlagKinds, Jon 2026-11-01).
        for (const kind of rescuerFlagKinds(openFlagKinds(f))) flagPills.push(<AlertPill key={kind} kind={kind}>{t(`flags.${kind}`)}</AlertPill>);
    }

    const fullAnswers = (() => {
        try { return applicant.submission.answersJson ? JSON.parse(applicant.submission.answersJson) : {}; }
        catch { return {}; }
    })();
    const hasAnswers = Object.keys(fullAnswers).length > 0;

    // A general form's links carry no animal.
    const formHref = `/form-results/${applicant.submissionId}${animal ? `?from=animal:${encodeURIComponent(animal.id)}` : ''}`;
    // Still to decide: to evaluate, or a contract sent (Q1: «No avanzar» voids the live link).
    const deciding = applicant.status.kind === 'to_evaluate' || applicant.status.kind === 'contract_sent';
    const personName = adopterDisplayName({ name: applicant.adopterName }, t('adopter.nameless'));

    // How the evaluation ends. None once it has an outcome: the status line says it.
    const footer: React.ReactNode = !deciding ? null : !applicant.adopterId ? (
        <Link href={formHref} className={buttonClasses({ variant: 'primary', fullWidth: true })}>
            {t('myAnimals.applicants_view_form') || 'Ver formulario'}
        </Link>
    ) : (
        <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" onClick={() => setDialog('decline')} disabled={busy} data-testid="evaluate-decline" layoutClassName="w-full">
                {t('evaluation.decline')}
            </Button>
            {animal ? (
                <Button type="button" variant="primary" onClick={handleSend} loading={busy} data-testid="evaluate-send-contract" layoutClassName="w-full">
                    {applicant.hasInvite
                        ? (t('myAnimals.applicants_resend') || 'Reenviar contrato')
                        : (t('myAnimals.applicants_send_contract') || 'Enviar contrato')}
                </Button>
            ) : (
                <Button type="button" variant="primary" onClick={() => setDialog('propose')} data-testid="evaluate-propose" layoutClassName="w-full">
                    {t('evaluation.propose')}
                </Button>
            )}
        </div>
    );

    // «Prefiere» is asked only on a general form: there it is the first answer to read.
    const prefers = !animal && (applicant.species || applicant.lifeStage)
        ? [
            applicant.species && t(`myAnimals.applicants_row_summary_species_${applicant.species}`),
            applicant.lifeStage && t(`myAnimals.applicants_row_summary_lifestage_${applicant.lifeStage}`),
        ].filter(Boolean).join(' · ')
        : null;

    const animalName = animal?.name ?? '';
    const wa = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
    const mailto = (subject: string, body: string) => `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    const shareText = shareUrl ? `Contrato de adopción para ${animalName} — ${personName}\n${shareUrl}` : '';

    return (
        <div
            ref={rootRef}
            data-testid={testId}
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
                        className="min-h-11 px-2 py-1 text-xs font-semibold text-stone-700 hover:bg-stone-100 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        ← {t('myAnimals.applicants_panel_prev') || 'Anterior'}
                    </button>
                    {/* One dot per applicant fits up to 8; past that the dots would push «Siguiente →»
                        off a phone screen, so a «3 / 25» counter instead. */}
                    {total > MAX_PAGING_DOTS ? (
                        <div className="flex-1 min-w-0 text-center text-xs font-semibold text-stone-600 tabular-nums" aria-label={`${index + 1} / ${total}`} data-testid="applicant-panel-counter">
                            {index + 1} / {total}
                        </div>
                    ) : (
                        <div className="flex items-center gap-1.5 flex-1 justify-center" aria-label={`${index + 1} / ${total}`}>
                            {list.map((_, i) => (
                                <span
                                    key={i}
                                    className={`w-1.5 h-1.5 rounded-full ${i === index ? 'bg-teal-700' : 'bg-stone-300'}`}
                                />
                            ))}
                        </div>
                    )}
                    <button
                        type="button"
                        onClick={goNext}
                        disabled={index === total - 1}
                        className="min-h-11 px-2 py-1 text-xs font-semibold text-stone-700 hover:bg-stone-100 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        {t('myAnimals.applicants_panel_next') || 'Siguiente'} →
                    </button>
                    {returnLabel ? (
                        <button
                            type="button"
                            onClick={onClose}
                            data-testid="applicant-panel-back"
                            className="ml-1 min-h-11 px-3 rounded-xl text-sm font-semibold text-teal-700 hover:bg-stone-100 whitespace-nowrap"
                        >
                            {t('evaluation.back')}
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label={t('common.close') || 'Close'}
                            className="ml-1 w-11 h-11 rounded-full flex items-center justify-center text-stone-500 hover:bg-stone-100"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    )}
                </div>

                {/* Scrolling body */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                    {/* Identity block */}
                    <div>
                        <h2 id="applicant-panel-title" className="text-xl font-bold text-stone-900 break-words">
                            <AdopterName adopter={{ name: applicant.adopterName }} subId={applicant.submission?.email || applicant.submission?.phone || null} />
                        </h2>
                        {applicant.askedAnimal && (
                            <p className="text-sm text-stone-600 mt-0.5 [overflow-wrap:anywhere]" data-testid="applicant-asked-animal">
                                {animalLine(t, 'evaluation.asked_adopted', applicant.askedAnimal)}
                            </p>
                        )}
                        <div className="flex items-center flex-wrap gap-2 mt-1.5">
                            {applicant.adopterRating != null ? (
                                <RatingExplainer rating={applicant.adopterRating}>
                                    <RatingBadge rating={applicant.adopterRating} />
                                </RatingExplainer>
                            ) : (
                                <RatingBadge rating={null} />
                            )}
                            {sourcePill}
                            {applicant.appliedAt && (
                                <span className="text-xs text-stone-500">{formatShortDate(applicant.appliedAt)}</span>
                            )}
                        </div>
                    </div>

                    <ApplicationStatusLine status={applicant.status} animal={animal} outcomeAnimal={applicant.outcomeAnimal} />

                    {/* PERFIL section */}
                    <section>
                        <h3 className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-2">
                            {t('myAnimals.applicants_panel_section_profile') || 'Perfil del adoptante'}
                        </h3>
                        {applicant.adopterId ? (
                            <div className="space-y-2">
                                {hasAlerts ? (
                                    <div className="flex flex-wrap gap-1" data-testid="applicant-panel-alerts">
                                        <PeriodAlertPills alerts={applicant.flags} />
                                        {housemate.lowRating != null && (
                                            <AlertPill kind="housemate_low_rating" wrap>
                                                {t('alerts.housemate_low_rating').replace('{rating}', formatRating(housemate.lowRating))}
                                            </AlertPill>
                                        )}
                                        {housemate.hasAlerts && <AlertPill kind="housemate_alerts" wrap>{t('alerts.housemate_alerts')}</AlertPill>}
                                    </div>
                                ) : applicant.alertsChecked ? (
                                    <p className="text-xs text-stone-400 italic" data-testid="applicant-panel-no-alerts">{t('myAnimals.applicants_panel_no_flags') || 'Sin alertas'}</p>
                                ) : null}
                                {flagPills.length > 0 && <div className="flex flex-wrap gap-1">{flagPills}</div>}
                                <p className="text-sm text-stone-700">
                                    📊 {(t('myAnimals.applicants_panel_activity') || '{adoptions} adopciones · {requests} pedidos')
                                        .replace('{adoptions}', String(applicant.adoptionCount))
                                        .replace('{requests}', String(applicant.requestCount))}
                                </p>
                                {applicant.adopterContext?.addedBy && (
                                    <p className="text-xs text-stone-500 truncate">
                                        👤 {(t('myAnimals.applicants_panel_added_by') || 'Agregado por {email}').replace('{email}', applicant.adopterContext.addedByName || emailHandle(applicant.adopterContext.addedBy))}
                                    </p>
                                )}
                                {/* «Abrir perfil ↗», the new-tab link everywhere (point B). */}
                                <OpenProfileLink href={`/adopter/${encodeURIComponent(applicant.adopterId)}`} className="-ml-1" />
                            </div>
                        ) : (
                            <p className="text-sm text-stone-500 italic">
                                {t('myAnimals.applicants_panel_no_adopter') || 'Sin perfil vinculado — el formulario no creó un adoptante automáticamente.'}
                            </p>
                        )}
                    </section>

                    {/* «¿Es la misma persona?», the same compare as every same-person screen (read per applicant). */}
                    {applicant.adopterId && (
                        <ApplicationDuplicate
                            key={applicant.applicationId}
                            applicationId={applicant.applicationId}
                            submissionId={applicant.submissionId}
                            applicantSelfieUrl={applicant.submission.selfieUrl}
                            onLinked={() => { void afterChange('linked'); }}
                        />
                    )}

                    {/* RESPUESTAS section */}
                    <section>
                        <h3 className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-2">
                            {t('myAnimals.applicants_panel_section_form') || 'Respuestas del formulario'}
                        </h3>
                        <div className="space-y-2 text-sm">
                            {prefers && (
                                <AnswerRow testId="answers-prefers" label={t('myAnimals.applicants_panel_pref_label') || 'Prefiere'}>{prefers}</AnswerRow>
                            )}
                            {hasAnswers && <ApplicationAnswersSummary answers={fullAnswers} onSeeAll={openAllAnswers} />}
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
                            <FormPhotos photos={applicant.submission.photos} compact />
                            <LocationMap
                                latitude={applicant.submission.latitude}
                                longitude={applicant.submission.longitude}
                                title={t('formResults.location_section')}
                                variant="inline"
                            />
                            <a
                                href={formHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-800 mt-1"
                            >
                                {t('myAnimals.applicants_panel_view_full_form') || 'Ver formulario completo'}
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                            </a>
                        </div>

                        {hasAnswers && (
                            // Controlled, so «Ver todas» opens it and a tap on its summary stays in sync.
                            <details
                                ref={allAnswersRef}
                                open={allAnswersOpen}
                                onToggle={(e) => setAllAnswersOpen(e.currentTarget.open)}
                                className="mt-3 group"
                                data-testid="answers-all"
                            >
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

                {/* Sticky footer — how the evaluation ends; after sending, the contract's share block */}
                {(shareUrl || footer) && (
                    <div className="sticky bottom-0 bg-white border-t border-stone-200 px-5 py-3 space-y-2" data-testid="applicant-panel-footer">
                        {shareUrl ? (
                            <div className="space-y-2">
                                <p className="text-xs font-semibold text-teal-700">
                                    ✓ {(t('myAnimals.applicants_panel_invite_ready') || 'Invitación lista para {name}').replace('{name}', personName)}
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
                            footer
                        )}
                    </div>
                )}

                {/* Inside the panel's own box: a click in a dialog must not reach the backdrop's close. */}
                {dialog === 'decline' && (
                    <DeclineApplicationDialog
                        applicationId={applicant.applicationId}
                        personName={personName}
                        animalName={animal?.name ?? null}
                        onClose={() => setDialog(null)}
                        onDone={() => { void afterChange('outcome'); }}
                    />
                )}
                {dialog === 'propose' && (
                    <ProposeAnimalSheet
                        applicationId={applicant.applicationId}
                        personName={personName}
                        onClose={() => setDialog(null)}
                        onDone={() => { void afterChange('outcome'); }}
                    />
                )}
            </div>
        </div>
    );
}
