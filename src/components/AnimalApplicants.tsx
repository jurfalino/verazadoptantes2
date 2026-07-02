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

import { useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { extractErrorId } from '@/lib/errorUtils';
import { createContractInvitation } from '@/app/actions/contract';
import ApplicantDetailPanel from '@/components/ApplicantDetailPanel';

// Sentinel: tracking the busy row by submissionId (always present) avoids the
// `null === null` collision that occurred when an applicant had adopterId: null
// — the comparison was true from initial render and the button showed
// "Procesando..." forever without anything being clicked.

import type { ApplicantSummary } from '@/app/actions/applicants';
export type ApplicantRow = ApplicantSummary;

function relativeDate(unixSec: number | null, locale: string): string {
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
    return new Date(unixSec * 1000).toLocaleDateString();
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

/** Count of negative flags + whether identity is verified, for the row badge. */
function flagSummary(flags: ApplicantRow['flags']): { warnCount: number; verified: boolean } {
    if (!flags) return { warnCount: 0, verified: false };
    let warnCount = 0;
    if (flags.inaccurate) warnCount++;
    if (flags.duplicate) warnCount++;
    if (flags.tooManyAdoptions) warnCount++;
    if (flags.tooManyRequests) warnCount++;
    return { warnCount, verified: !!flags.verified_identity };
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
    const shareText = (t('myAnimals.applicants_share_text') || 'Contrato de adopción para {animal} — {adopter}')
        .replace('{animal}', animalName)
        .replace('{adopter}', adopterName);

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
                            {(t('myAnimals.applicants_share_subtitle') || 'Para {adopter}').replace('{adopter}', adopterName)}
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

export default function AnimalApplicants({
    animalId,
    animalName,
    applicants,
}: {
    animalId: string;
    animalName: string;
    applicants: ApplicantRow[];
}) {
    const { t, locale } = useLanguage();
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
            if (result.success && result.url) {
                setShareUrl({ url: result.url, adopterName: applicant.adopterName });
            } else {
                toast.error(t('errors.generic') || 'Error', result.error || 'Could not issue invitation');
            }
        } catch (e) {
            toast.error(t('errors.generic') || 'Error', undefined, extractErrorId(e));
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
                        <span>👥</span>
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
                            const { warnCount, verified } = flagSummary(a.flags);
                            return (
                                <li
                                    key={a.submissionId}
                                    onClick={() => setPanelIndex(idx)}
                                    className="px-3 py-2 flex items-center gap-2 bg-white hover:bg-teal-50/60 transition-colors cursor-pointer"
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="font-medium text-sm text-stone-900 truncate">{a.adopterName}</span>
                                            {warnCount > 0 && (
                                                <span
                                                    className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 flex-shrink-0"
                                                    title={t('myAnimals.applicants_row_flags_tooltip') || 'Alertas en el perfil'}
                                                >
                                                    ⚠ {warnCount}
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
                                            {a.adopterRating != null && <span>★ {a.adopterRating.toFixed(1)}</span>}
                                            {a.appliedAt && <span>· {relativeDate(a.appliedAt, locale)}</span>}
                                        </div>
                                        {summary && (
                                            <div className="text-[11px] text-stone-500 truncate mt-0.5">
                                                🏠 {summary}
                                            </div>
                                        )}
                                    </div>
                                    <div onClick={(e) => e.stopPropagation()} className="flex-shrink-0">
                                        {a.isSigned ? (
                                            <span className="text-[11px] px-2 py-1 rounded-lg bg-teal-100 text-teal-800 font-semibold">✓ {t('myAnimals.applicants_signed') || 'Firmado'}</span>
                                        ) : !a.adopterId ? (
                                            <Link
                                                href={`/form-results/${a.submissionId}`}
                                                className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-stone-100 text-stone-700 hover:bg-stone-200 transition-colors inline-block"
                                                title={t('myAnimals.applicants_no_adopter') || 'This applicant has no linked adopter yet.'}
                                            >
                                                {t('myAnimals.applicants_view_form') || 'Ver formulario'}
                                            </Link>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => handleSend(a)}
                                                disabled={busySubmissionId === a.submissionId}
                                                className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-teal-700 text-white hover:bg-teal-600 disabled:opacity-50 transition-colors"
                                            >
                                                {busySubmissionId === a.submissionId
                                                    ? (t('common.processing') || '...')
                                                    : a.hasInvite
                                                        ? (t('myAnimals.applicants_resend') || 'Reenviar')
                                                        : (t('myAnimals.applicants_send_contract') || 'Enviar contrato')}
                                            </button>
                                        )}
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
                    animalId={animalId}
                    animalName={animalName}
                    onClose={() => setPanelIndex(null)}
                />
            )}
        </>
    );
}
