'use client';

/**
 * Per-animal applicants disclosure for the /my-animals card (Phase 4 of
 * v2.14.10-21). Rendered between the adoption-status block and the actions
 * footer. Collapsed by default; expanding reveals each applicant + a
 * "Enviar contrato" button that issues a token-locked contract URL.
 *
 * Themed Tailwind only (per memory feedback_themed_colors_only). The
 * share modal mirrors ShareMenu's option list but takes an externally
 * computed URL instead of building one from a contract base + animalId.
 */

import { useEffect, useState } from 'react';
import { Home, Users } from 'lucide-react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { createContractInvitation } from '@/app/actions/contract';
import { getApplicantsForAnimal } from '@/app/actions/applicants';
import { applicantsOrThrow } from '@/lib/applicantsLoad';
import { zarazTrack } from '@/lib/zaraz';
import ApplicantDetailPanel, { sendOutcome } from '@/components/ApplicantDetailPanel';
import { AdopterName } from '@/components/AdopterName';
import { FlagSummary } from '@/components/AlertPill';
import { openFlagKinds, rescuerFlagKinds } from '@/domain/flags';
import { adopterDisplayName } from '@/lib/adopterDisplay';

// Sentinel: tracking the busy row by submissionId (always present) avoids the
// `null === null` collision that occurred when an applicant had adopterId: null
// — the comparison was true from initial render and the button showed
// "Procesando..." forever without anything being clicked.

import type { ApplicantSummary } from '@/app/actions/applicants';
import { formatShortDate } from '@/lib/dates';
import { useDateFormat, useTimezone } from '@/context/TimezoneContext';
import { statusLineText } from '@/components/evaluation/ApplicationStatusLine';
import { RatingBadge } from '@/components/RatingBadge';
export type ApplicantRow = ApplicantSummary;

/**
 * `applicants` is a server prop rendered on first paint, so the >30-day branch
 * used to call a bare `toLocaleDateString()` — host locale *and* host timezone —
 * once on the Worker and once in the browser, which is a React #418 (see
 * src/lib/dates.ts). It now goes through the shared formatter with an explicit
 * zone.
 *
 * The day buckets above it still read `Date.now()`, so they can in principle
 * drift across a bucket edge between the two passes. Left as-is: fixing it means
 * making this client-only (see `useRelativeTime`), which is a bigger change than
 * this fix warrants.
 */
function relativeDate(unixSec: number | null, locale: string, timeZone: string): string {
    if (!unixSec) return '';
    const diffMs = Date.now() - unixSec * 1000;
    const days = Math.floor(diffMs / (24 * 3600 * 1000));
    if (days <= 0) return locale === 'en' ? 'today' : 'hoy';
    if (days === 1) return locale === 'en' ? 'yesterday' : 'ayer';
    if (days < 7) return locale === 'en' ? `${days}d ago` : `hace ${days}d`;
    if (days < 30) {
        const w = Math.floor(days / 7);
        return locale === 'en' ? `${w}w ago` : `hace ${w}sem`;
    }
    return formatShortDate(unixSec, timeZone, locale);
}

/** 1-line summary of the form submission for the disclosure row. */
function summaryLine(a: ApplicantRow, t: (k: string) => string): string {
    const parts: string[] = [];
    if (a.intent) {
        const key = a.intent === 'self'
            ? 'myAnimals.applicants_row_summary_intent_self'
            : a.intent === 'gift'
                ? 'myAnimals.applicants_row_summary_intent_gift'
                : null;
        if (key) parts.push(t(key));
    }
    if (a.lifeStage) {
        const k = `myAnimals.applicants_row_summary_lifestage_${a.lifeStage}`;
        const v = t(k);
        if (v && v !== k) parts.push(v);
    }
    if (a.species) {
        const k = `myAnimals.applicants_row_summary_species_${a.species}`;
        const v = t(k);
        if (v && v !== k) parts.push(v);
    }
    return parts.join(' · ');
}


function MiniShareModal({
    url,
    adopterName,
    animalName,
    onClose,
}: {
    url: string;
    adopterName: string;
    animalName: string;
    onClose: () => void;
}) {
    const { t } = useLanguage();
    const [copied, setCopied] = useState(false);
    const displayAdopterName = adopterDisplayName({ name: adopterName }, t('adopter.nameless'));
    const shareText = (t('myAnimals.applicants_share_text') || 'Contrato de adopción para {animal} — {adopter}')
        .replace('{animal}', animalName)
        .replace('{adopter}', displayAdopterName);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(url);
        } catch {
            const ta = document.createElement('textarea');
            ta.value = url;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    const wa = () => window.open(`https://wa.me/?text=${encodeURIComponent(`${shareText}\n${url}`)}`, '_blank');
    const email = () => window.open(`mailto:?subject=${encodeURIComponent(shareText)}&body=${encodeURIComponent(`${shareText}\n\n${url}`)}`, '_blank');

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={onClose}>
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div
                className="relative bg-white rounded-2xl shadow-2xl border border-stone-200 w-full max-w-sm animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-5 pb-3 border-b border-stone-100 flex items-center justify-between">
                    <div>
                        <h3 className="font-semibold text-stone-900 text-sm">
                            {t('myAnimals.applicants_share_title') || 'Compartir contrato'}
                        </h3>
                        <p className="text-xs text-stone-500 mt-0.5 truncate max-w-[240px]">
                            {(t('myAnimals.applicants_share_subtitle') || 'Para {adopter}').replace('{adopter}', displayAdopterName)}
                        </p>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-stone-500 hover:bg-stone-100">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
                <div className="p-3 space-y-1">
                    <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={onClose}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left hover:bg-stone-50 transition-colors"
                    >
                        <div className="w-10 h-10 rounded-xl bg-teal-100 flex items-center justify-center text-teal-700">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-stone-900">{t('share.open_in_new_tab') || 'Open in new tab'}</p>
                            <p className="text-xs text-stone-500 truncate max-w-[220px]">{url}</p>
                        </div>
                    </a>
                    <button onClick={copy} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left hover:bg-stone-50 transition-colors">
                        <div className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center text-lg">{copied ? '✅' : '🔗'}</div>
                        <div>
                            <p className="text-sm font-semibold text-stone-900">{copied ? '¡Copiado!' : (t('common.copy_link') || 'Copiar enlace')}</p>
                            <p className="text-xs text-stone-500 truncate max-w-[220px]">{url}</p>
                        </div>
                    </button>
                    <button onClick={wa} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left hover:bg-green-50 transition-colors">
                        <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center text-lg">💬</div>
                        <div>
                            <p className="text-sm font-semibold text-stone-900">WhatsApp</p>
                            <p className="text-xs text-stone-500">{t('share.via_message') || 'via message'}</p>
                        </div>
                    </button>
                    <button onClick={email} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left hover:bg-blue-50 transition-colors">
                        <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center text-lg">📧</div>
                        <div>
                            <p className="text-sm font-semibold text-stone-900">Email</p>
                            <p className="text-xs text-stone-500">{t('share.via_email') || 'via email'}</p>
                        </div>
                    </button>
                </div>
                <div className="px-5 pb-4 pt-1">
                    <p className="text-xs text-stone-500 text-center">
                        {t('myAnimals.applicants_share_footer') || 'Solo este adoptante podrá firmar este link.'}
                    </p>
                </div>
            </div>
        </div>
    );
}

/**
 * The row's own action: «Enviar contrato» / «Reenviar» only while the application is still being
 * decided (to evaluate, or a live contract). An outcome reads as its status line instead — a
 * declined or closed candidate must not get a fresh link («No avanzar» just voided theirs).
 */
export function ApplicantRowAction({ applicant: a, animal, busy, onSend }: {
    applicant: ApplicantRow;
    animal: { id: string; name: string; sex: string | null };
    busy: boolean;
    onSend: () => void;
}) {
    const { t } = useLanguage();
    const { formatShortDate } = useDateFormat();
    if (a.isSigned) {
        return <span className="text-[11px] px-2 py-1 rounded-lg bg-teal-100 text-teal-800 font-semibold">✓ {t('myAnimals.applicants_signed') || 'Firmado'}</span>;
    }
    if (a.status.kind !== 'to_evaluate' && a.status.kind !== 'contract_sent') {
        const line = statusLineText(a.status, { animal, outcomeAnimal: a.outcomeAnimal }, t, formatShortDate);
        return line ? <span className="block max-w-[10rem] text-right text-[11px] text-stone-500 [overflow-wrap:anywhere]" data-testid="applicant-row-outcome">{line}</span> : null;
    }
    if (!a.adopterId) {
        return (
            <Link
                href={`/form-results/${a.submissionId}?from=animal:${encodeURIComponent(animal.id)}`}
                className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-stone-100 text-stone-700 hover:bg-stone-200 transition-colors inline-block"
                title={t('myAnimals.applicants_no_adopter') || 'This applicant has no linked adopter yet.'}
            >
                {t('myAnimals.applicants_view_form') || 'Ver formulario'}
            </Link>
        );
    }
    return (
        <button
            type="button"
            onClick={onSend}
            disabled={busy}
            className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-teal-700 text-white hover:bg-teal-600 disabled:opacity-50 transition-colors"
        >
            {busy
                ? (t('common.processing') || '...')
                : a.hasInvite
                    ? (t('myAnimals.applicants_resend') || 'Reenviar')
                    : (t('myAnimals.applicants_send_contract') || 'Enviar contrato')}
        </button>
    );
}

export default function AnimalApplicants({
    animalId,
    animalName,
    animalSex = null,
    applicants: initialApplicants,
}: {
    animalId: string;
    animalName: string;
    /** For the sex-agreeing lines of the panel («Cerrada: Luna fue adoptada…»). */
    animalSex?: string | null;
    applicants: ApplicantRow[];
}) {
    const { t, locale } = useLanguage();
    // Re-read after an outcome in the panel, so the list under it is not stale.
    const [applicants, setApplicants] = useState(initialApplicants);
    useEffect(() => { setApplicants(initialApplicants); }, [initialApplicants]);
    const timeZone = useTimezone();
    const toast = useShowToast();
    const [expanded, setExpanded] = useState(false);
    const [busySubmissionId, setBusySubmissionId] = useState<string | null>(null);
    const [shareUrl, setShareUrl] = useState<{ url: string; adopterName: string } | null>(null);
    const [panelIndex, setPanelIndex] = useState<number | null>(null);

    if (applicants.length === 0) return null;

    const handleSend = async (applicant: ApplicantRow) => {
        if (!applicant.adopterId) {
            toast.error(t('errors.generic') || 'Error', t('myAnimals.applicants_no_adopter') || 'This applicant has no linked adopter yet.');
            return;
        }
        if (busySubmissionId) return;
        setBusySubmissionId(applicant.submissionId);
        try {
            const result = await createContractInvitation(animalId, applicant.adopterId, locale);
            const next = sendOutcome(result);
            if (next === 'share' && result.url) {
                zarazTrack('contract_issued', { surface: 'applicants_list' });
                setShareUrl({ url: result.url, adopterName: applicant.adopterName });
            } else if (next === 'refresh') {
                // Decided meanwhile (a teammate): re-read, so the row shows its outcome instead of the button.
                // A failed re-read throws with its errorId (the catch below toasts it).
                const fresh = applicantsOrThrow(await getApplicantsForAnimal(animalId), 'AnimalApplicants: re-read');
                if (fresh.length > 0) setApplicants(fresh);
            } else {
                const message = next === 'not_allowed'
                    ? (t('errors.contract_invite_not_allowed') || 'You can only send the contract to someone who applied for this animal.')
                    : (t('errors.contract_invite_failed') || 'Could not issue invitation');
                toast.error(t('errors.generic') || 'Error', message, result.errorId ?? resolveErrorId(new Error(`createContractInvitation: ${result.error}`), 'AnimalApplicants'));
            }
        } catch (e) {
            toast.error(t('errors.generic') || 'Error', t('errors.contract_invite_failed') || undefined, resolveErrorId(e, 'AnimalApplicants'));
        } finally {
            setBusySubmissionId(null);
        }
    };

    const countLabel = applicants.length === 1
        ? (t('myAnimals.applicants_count_one') || '1 persona interesada')
        : (t('myAnimals.applicants_count_many') || '{n} personas interesadas').replace('{n}', String(applicants.length));

    return (
        <>
            <div className="mb-3 rounded-lg border border-teal-100 bg-teal-50/50 overflow-hidden">
                <button
                    type="button"
                    onClick={() => setExpanded(v => !v)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-teal-50 transition-colors"
                >
                    <span className="text-sm font-semibold text-teal-800 flex items-center gap-2">
                        <Users className="w-4 h-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                        {countLabel}
                    </span>
                    <svg className={`w-4 h-4 text-teal-700 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </button>
                {expanded && (
                    <ul className="divide-y divide-teal-100 border-t border-teal-100">
                        {applicants.map((a, idx) => {
                            const summary = summaryLine(a, t);
                            // The person's open flags a rescuer sees (rescuerFlagKinds: never «Inexacto»), as FlagSummary draws them.
                            const flagKinds = rescuerFlagKinds(openFlagKinds(a.flags));
                            const verified = !!a.flags?.verified_identity;
                            return (
                                <li
                                    key={a.submissionId}
                                    onClick={() => setPanelIndex(idx)}
                                    className="px-3 py-2 flex items-center gap-2 bg-white hover:bg-teal-50/60 transition-colors cursor-pointer"
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <AdopterName adopter={{ name: a.adopterName }} className="font-medium text-sm text-stone-900 truncate" />
                                            {flagKinds.length > 0 && (
                                                <span className="flex-shrink-0" title={t('myAnimals.applicants_row_flags_tooltip') || 'Alertas en el perfil'}>
                                                    <FlagSummary kinds={flagKinds} testId="applicant-row-flags" />
                                                </span>
                                            )}
                                            {verified && (
                                                <span
                                                    className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200 flex-shrink-0"
                                                    title={t('flags.verified_identity') || 'Verified ID'}
                                                >
                                                    ✓
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-xs text-stone-500 flex items-center gap-1.5 flex-wrap">
                                            <RatingBadge rating={a.adopterRating} />
                                            {a.appliedAt && <span>· {relativeDate(a.appliedAt, locale, timeZone)}</span>}
                                        </div>
                                        {summary && (
                                            <div className="flex items-center gap-1 text-[11px] text-stone-500 min-w-0 mt-0.5">
                                                <Home className="w-3 h-3 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                                                <span className="truncate">{summary}</span>
                                            </div>
                                        )}
                                    </div>
                                    <div onClick={(e) => e.stopPropagation()} className="flex-shrink-0">
                                        <ApplicantRowAction
                                            applicant={a}
                                            animal={{ id: animalId, name: animalName, sex: animalSex }}
                                            busy={busySubmissionId === a.submissionId}
                                            onSend={() => handleSend(a)}
                                        />
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
            {shareUrl && (
                <MiniShareModal
                    url={shareUrl.url}
                    adopterName={shareUrl.adopterName}
                    animalName={animalName}
                    onClose={() => setShareUrl(null)}
                />
            )}
            {panelIndex !== null && (
                <ApplicantDetailPanel
                    applicants={applicants}
                    initialIndex={panelIndex}
                    animal={{ id: animalId, name: animalName, sex: animalSex }}
                    onClose={() => setPanelIndex(null)}
                    onOutcome={async () => {
                        // A refusal is an empty list (close the panel); a failure throws with its errorId (the panel toasts it).
                        const fresh = applicantsOrThrow(await getApplicantsForAnimal(animalId), 'AnimalApplicants: re-read');
                        if (fresh.length === 0) return null;
                        setApplicants(fresh);
                        return fresh;
                    }}
                />
            )}
        </>
    );
}
