'use client';

import { useRouter } from 'next/navigation';
import type { OpenAlertKind } from '@/domain/flags';
import { useLanguage } from '@/context/LanguageContext';
import { linkFormToExistingAdopter } from '@/app/actions/formSubmission';
import { HOUSEHOLD_NOT_CONVERTED } from '@/domain/households';
import { useShowToast } from '@/components/ui/Toast';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { en } from '@/i18n/locales/en';
import MatchCompare, { entriesAsShown } from '@/components/MatchCompare';
import { MatchCard } from '@/components/MatchCardParts';
import type { HouseholdLine } from '@/domain/households';

// Single source of truth: fallbacks from English locale
const formResultsFallbacks = en.formResults as Record<string, string>;

function proxyImageUrl(url: string): string {
    return url.includes('r2.dev') ? `/api/proxy-image?url=${encodeURIComponent(url)}` : url;
}

export interface FormResultMatchCardProps {
    applicant: { name: string; email?: string; phone?: string; address?: string };
    profile: {
        id: string; name: string; contactInfo: string | null; contactEntries?: string | null; addressInfo: string | null; status: string | null; profileImageUrl?: string | null;
        /** Final fix P2: the same «Menor de edad» tag and household line as every card showing one person. */
        isMinor?: boolean; households?: HouseholdLine[];
        /** Their own standing in the card's header (audit B6). */
        rating?: number | null; openAlerts?: OpenAlertKind[];
    };
    applicantSelfieUrl?: string | null;
    matchTypes: string[];
    /** Search score — admins only. */
    score?: number;
    submissionId: string;
    /** Offer "Es la misma persona" (and "No es esta persona"). Off once the form is linked. */
    canLink: boolean;
    /** This is the profile the form is linked to. */
    linked?: boolean;
    /** Linking folds the profile auto-created from the form into this one. */
    willMerge: boolean;
    onDismiss?: () => void;
}

export default function FormResultMatchCard({
    applicant,
    profile,
    applicantSelfieUrl,
    matchTypes,
    score,
    submissionId,
    canLink,
    linked = false,
    willMerge,
    onDismiss,
}: FormResultMatchCardProps) {
    const { t } = useLanguage();
    const router = useRouter();
    const toast = useShowToast();
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [linking, setLinking] = useState(false);
    const L = (key: string) => (t(`formResults.${key}`) || '').trim() || formResultsFallbacks[key] || key;

    const applicantEntries = [
        { type: 'phone', value: applicant.phone ?? '' },
        { type: 'email', value: applicant.email ?? '' },
        { type: 'address', value: applicant.address ?? '' },
    ].filter(e => e.value.trim());
    const profileEntries = [
        ...entriesAsShown(profile).filter(e => e.type !== 'address' || !profile.addressInfo),
        ...(profile.addressInfo ? [{ type: 'address', value: profile.addressInfo }] : []),
    ];

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
                // Households as profiles: the merge into this profile was refused (household data not converted yet).
                : result.error === HOUSEHOLD_NOT_CONVERTED ? t('errors.merge_household_not_converted')
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
            {/* The shared match card (audit B6): header (their photo or initial, name + their own standing,
                household line) → «Qué coincide y qué no» → the same actions as every match card. The
                applicant's values against the profile's, as this viewer may see them (masked stays masked). */}
            <MatchCard
                className="px-4 py-3"
                person={profile}
                thumbnail={profile.profileImageUrl ? proxyImageUrl(profile.profileImageUrl) : null}
                compare={(
                    <div id={`comparison-${profile.id}`}>
                        <MatchCompare
                            adopterId={profile.id}
                            matchTypes={matchTypes}
                            profileName={profile.name}
                            source={{ kind: 'form', name: applicant.name, entries: applicantEntries }}
                            profileEntries={profileEntries}
                            score={score}
                            bare
                            t={t}
                        />
                    </div>
                )}
                actions={{
                    busy: linking,
                    onSame: canLink ? () => setConfirmOpen(true) : undefined, sameLabel: L('same_person'),
                    onNotThis: canLink && onDismiss ? onDismiss : undefined,
                }}
            />

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
