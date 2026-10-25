'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { linkFormToExistingAdopter } from '@/app/actions/formSubmission';
import { useShowToast } from '@/components/ui/Toast';
import { buttonClasses } from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { useState } from 'react';
import { CheckCircle2, ArrowRight } from 'lucide-react';
import { en } from '@/i18n/locales/en';
import MatchCompare from '@/components/MatchCompare';

// Single source of truth: fallbacks from English locale
const formResultsFallbacks = en.formResults as Record<string, string>;

function proxyImageUrl(url: string): string {
    return url.includes('r2.dev') ? `/api/proxy-image?url=${encodeURIComponent(url)}` : url;
}

export interface FormResultMatchCardProps {
    applicant: { name: string; email?: string; phone?: string; address?: string };
    profile: { id: string; name: string; contactInfo: string | null; addressInfo: string | null; status: string | null; profileImageUrl?: string | null };
    applicantSelfieUrl?: string | null;
    matchTypes: string[];
    submissionId: string;
    /** Offer "Es la misma persona" (and "No es esta persona"). Off once the form is linked. */
    canLink: boolean;
    /** This is the profile the form is linked to. */
    linked?: boolean;
    /** Linking folds the profile auto-created from the form into this one. */
    willMerge: boolean;
    onDismiss?: () => void;
    /** Open the comparison by itself — when this is the only possible match. */
    compareOpen?: boolean;
}

function DataRow({ label, value }: { label: string; value: string | null | undefined }) {
    if (value == null || value === '') return null;
    return (
        <div className="flex flex-col gap-0.5 py-1">
            <span className="text-xs font-medium text-stone-500">{label}</span>
            <span className="text-sm text-stone-800 break-words">{value}</span>
        </div>
    );
}

export default function FormResultMatchCard({
    applicant,
    profile,
    applicantSelfieUrl,
    matchTypes,
    submissionId,
    canLink,
    linked = false,
    willMerge,
    onDismiss,
    compareOpen = false,
}: FormResultMatchCardProps) {
    const { t } = useLanguage();
    const router = useRouter();
    const toast = useShowToast();
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [linking, setLinking] = useState(false);
    // Option B (Jon to choose, 2026-10-25): the card explains; the raw data waits behind a tap.
    const [showDetails, setShowDetails] = useState(false);
    const L = (key: string) => (t(`formResults.${key}`) || '').trim() || formResultsFallbacks[key] || key;

    const applicantEntries = [
        { type: 'phone', value: applicant.phone ?? '' },
        { type: 'email', value: applicant.email ?? '' },
        { type: 'address', value: applicant.address ?? '' },
    ].filter(e => e.value.trim());

    const fail = (errorId: string, message: string) => {
        toast.error(t('errors.generic'), message, errorId);
        setLinking(false);
        setConfirmOpen(false);
    };

    const handleConfirmLink = async () => {
        setLinking(true);
        try {
            const result = await linkFormToExistingAdopter(submissionId, profile.id);
            if (!result) {
                fail(resolveErrorId(new Error('linkFormToExistingAdopter returned undefined'), 'FormResultMatchCard'), L('link_error'));
                return;
            }
            if (result.success) {
                toast.success(L('link_success').replace('{name}', result.adopterName ?? profile.name));
                router.push(`/adopter/${profile.id}`);
                return;
            }
            // Refusals (already linked elsewhere, match gone) are expected
            // outcomes the server logs at warn without an id; mint one here so
            // the toast still carries a code that matches an Axiom row.
            const message =
                result.error === 'already_linked' ? L('link_error_already_linked')
                : result.error === 'busy' ? L('link_error_busy')
                : result.error === 'target_unavailable' ? L('link_error_unavailable')
                : L('link_error');
            fail(result.errorId ?? resolveErrorId(new Error(`linkFormToExistingAdopter: ${result.error}`), 'FormResultMatchCard'), message);
        } catch (e) {
            fail(resolveErrorId(e, 'FormResultMatchCard'), L('link_error'));
        }
    };

    const showPhotos = !!(applicantSelfieUrl || profile.profileImageUrl);

    return (
        <article
            // No border-stone-200: globals.css remaps it with !important, which
            // would beat the success colour on the linked card.
            className="bg-white rounded-2xl border shadow-sm overflow-hidden"
            style={{ borderColor: linked ? 'var(--status-success-border)' : 'var(--border-default)' }}
            aria-describedby={`comparison-${profile.id}`}
        >
            {/* The answer to "which one did I pick?" — first thing on the card. */}
            {linked && (
                <div
                    className="px-4 py-2 flex items-center gap-2 text-sm font-bold border-b"
                    style={{ background: 'var(--status-success-bg)', color: 'var(--status-success-text)', borderColor: 'var(--status-success-border)' }}
                >
                    <CheckCircle2 className="w-4 h-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                    {L('linked_badge')}
                </div>
            )}
            {/* Applicant vs profile photos (when available) */}
            {showPhotos && (
                <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-center gap-6 bg-stone-50">
                    <div className="flex flex-col items-center gap-1">
                        {applicantSelfieUrl ? (
                            <img
                                src={proxyImageUrl(applicantSelfieUrl)}
                                alt=""
                                className="w-14 h-14 rounded-full object-cover border-2 border-teal-200 bg-stone-100"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                        ) : (
                            <div className="w-14 h-14 rounded-full border-2 border-dashed border-teal-200 bg-stone-100 flex items-center justify-center text-stone-400 text-xs" aria-hidden>
                                —
                            </div>
                        )}
                        <span className="text-xs font-medium text-teal-800">{L('form_applicant')}</span>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                        {profile.profileImageUrl ? (
                            <img
                                src={proxyImageUrl(profile.profileImageUrl)}
                                alt=""
                                className="w-14 h-14 rounded-full object-cover border-2 border-stone-300 bg-stone-100"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                        ) : (
                            <div className="w-14 h-14 rounded-full border-2 border-dashed border-stone-300 bg-stone-100 flex items-center justify-center text-stone-400 text-xs" aria-hidden>
                                —
                            </div>
                        )}
                        <span className="text-xs font-medium text-stone-600">{L('existing_profile')}</span>
                    </div>
                </div>
            )}
            {/* What matches and what doesn't, field by field — the same card as every
                "same person?" screen. No strength label: it came from the search score
                and could contradict the rows (Jon, 2026-10-25). */}
            <div id={`comparison-${profile.id}`} className="px-4 pb-2 border-b border-stone-200">
                <MatchCompare
                    adopterId={profile.id}
                    matchTypes={matchTypes}
                    profileName={profile.name}
                    source={{ kind: 'form', name: applicant.name, entries: applicantEntries }}
                    defaultOpen={compareOpen}
                    t={t}
                />
            </div>

            {/* Both sides in full — the profile's contact only when this viewer may see it. */}
            <button
                type="button"
                aria-expanded={showDetails}
                onClick={() => setShowDetails(v => !v)}
                className="w-full flex items-center gap-1 min-h-[44px] px-4 text-sm font-semibold text-teal-700 hover:text-teal-800 border-b border-stone-200"
            >
                <svg className={`w-4 h-4 shrink-0 transition-transform ${showDetails ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                {showDetails ? L('hide_full_details') : L('show_full_details')}
            </button>
            {/* Two-block comparison */}
            {showDetails && <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-stone-200">
                {/* Form applicant */}
                <div className="p-4 bg-teal-50">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-teal-800 mb-2">
                        {L('form_applicant')}
                    </h3>
                    <DataRow label={L('name_label')} value={applicant.name} />
                    <DataRow label={L('email_label')} value={applicant.email} />
                    <DataRow label={L('phone_label')} value={applicant.phone} />
                    <DataRow label={L('address_label')} value={applicant.address} />
                </div>

                {/* Existing profile */}
                <div className="p-4 bg-stone-50">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-600 mb-2">
                        {L('existing_profile')}
                    </h3>
                    <DataRow label={L('name_label')} value={profile.name} />
                    <DataRow label={L('contact_section')} value={profile.contactInfo} />
                    <DataRow label={L('address_label')} value={profile.addressInfo} />
                </div>
            </div>}

            {/* Actions. The decision pair sits together — "Es la misma persona"
                first, "No es esta persona" last — with navigation between. */}
            <div className="px-4 py-3 border-t border-stone-200 flex flex-wrap items-center gap-2">
                {canLink && (
                    <button
                        type="button"
                        onClick={() => setConfirmOpen(true)}
                        disabled={linking}
                        className={`${buttonClasses({ variant: 'primary', size: 'compact' })} w-full sm:w-auto`}
                    >
                        <CheckCircle2 className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
                        {L('same_person')}
                    </button>
                )}
                <Link
                    href={`/adopter/${profile.id}`}
                    className={`${buttonClasses({ variant: 'secondary', size: 'compact' })} w-full sm:w-auto`}
                >
                    {L('view_full_profile')}
                    <ArrowRight className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
                </Link>
                {canLink && onDismiss && (
                    <button
                        type="button"
                        onClick={onDismiss}
                        disabled={linking}
                        className="w-full sm:w-auto sm:ml-auto min-h-[44px] px-2 text-[13px] font-semibold text-stone-500 hover:text-stone-700 transition-colors"
                    >
                        {L('not_this_person')}
                    </button>
                )}
            </div>

            <ConfirmDialog
                open={confirmOpen}
                title={L('confirm_link_title').replace('{name}', profile.name)}
                message={(willMerge ? L('confirm_link_body_merge') : L('confirm_link_body'))
                    .replace('{applicant}', applicant.name || L('form_applicant'))
                    .replace('{name}', profile.name)}
                confirmLabel={linking ? L('linking') : L('confirm_link_action')}
                destructive={false}
                busy={linking}
                onConfirm={handleConfirmLink}
                onCancel={() => setConfirmOpen(false)}
            />
        </article>
    );
}
