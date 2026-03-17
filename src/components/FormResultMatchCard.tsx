'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { linkFormSubmissionToAdopter } from '@/app/actions/formSubmission';
import { useShowToast } from '@/components/ui/Toast';
import { useState } from 'react';
import { en } from '@/i18n/locales/en';

const MATCH_TYPE_KEYS: Record<string, string> = {
    'token:name_full': 'match_name_full',
    'token:name_word': 'match_name_word',
    'token:phone': 'match_phone',
    'token:phone_suffix': 'match_phone_suffix',
    'token:email': 'match_email',
    'token:social': 'match_social',
    'like:name': 'match_like_name',
    'like:contact': 'match_like_contact',
};

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
    notificationId: string;
    submissionId: string;
    onDismiss?: () => void;
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

function isStrongMatch(matchTypes: string[]): boolean {
    const hasEmail = matchTypes.includes('token:email');
    const hasFullName = matchTypes.includes('token:name_full');
    return matchTypes.length >= 3 || (hasEmail && hasFullName);
}

export default function FormResultMatchCard({
    applicant,
    profile,
    applicantSelfieUrl,
    matchTypes,
    notificationId: _notificationId,
    submissionId,
    onDismiss,
}: FormResultMatchCardProps) {
    const { t } = useLanguage();
    const router = useRouter();
    const toast = useShowToast();
    const [linking, setLinking] = useState(false);
    const L = (key: string) => (t(`formResults.${key}`) || '').trim() || formResultsFallbacks[key] || key;

    const matchLabels = matchTypes
        .map((mt) => L(MATCH_TYPE_KEYS[mt] ?? mt) || mt)
        .filter(Boolean);
    const strongMatch = isStrongMatch(matchTypes);

    const handleLinkToProfile = async () => {
        setLinking(true);
        try {
            const result = await linkFormSubmissionToAdopter(submissionId, profile.id);
            if (result.success) {
                toast.success(
                    L('link_success').replace('{name}', profile.name),
                    undefined
                );
                setTimeout(() => router.push(`/adopter/${profile.id}`), 400);
            } else {
                toast.error('Error', L('link_error'));
                setLinking(false);
            }
        } catch (e) {
            console.error(e);
            toast.error('Error', L('link_error'));
            setLinking(false);
        }
    };

    const showPhotos = !!(applicantSelfieUrl || profile.profileImageUrl);

    return (
        <article
            className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden"
            aria-describedby={`comparison-${profile.id}`}
        >
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
            {/* Match strength + reasons */}
            <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-semibold text-amber-800">
                    {strongMatch ? L('strong_match') : L('possible_match')}
                </span>
                {matchLabels.length > 0 && (
                    <>
                        <span className="text-amber-600">·</span>
                        <span className="text-xs font-medium text-amber-800">{L('matched_on')}:</span>
                        {matchLabels.map((label) => (
                            <span
                                key={label}
                                className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800"
                            >
                                {label}
                            </span>
                        ))}
                    </>
                )}
                {onDismiss && (
                    <>
                        <span className="flex-1" />
                        <button
                            type="button"
                            onClick={onDismiss}
                            className="text-xs font-medium text-stone-500 hover:text-stone-700"
                        >
                            {L('not_this_person')}
                        </button>
                    </>
                )}
            </div>

            {/* Two-block comparison */}
            <div id={`comparison-${profile.id}`} className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-stone-200">
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
            </div>

            {/* Actions (min 44px tap targets) */}
            <div className="px-4 py-3 border-t border-stone-200 flex flex-wrap gap-2">
                <Link
                    href={`/adopter/${profile.id}`}
                    className="inline-flex items-center gap-1.5 min-h-[44px] px-4 py-2.5 text-sm font-semibold text-stone-700 bg-stone-100 rounded-lg hover:bg-stone-200 transition-colors"
                >
                    {L('view_full_profile')} →
                </Link>
                <button
                    type="button"
                    onClick={handleLinkToProfile}
                    disabled={linking}
                    className="inline-flex items-center gap-1.5 min-h-[44px] px-4 py-2.5 text-sm font-semibold text-teal-700 bg-teal-100 rounded-lg hover:bg-teal-200 disabled:opacity-50 transition-colors"
                >
                    {linking ? '…' : `🔗 ${L('link_to_this_profile')}`}
                </button>
            </div>
        </article>
    );
}
