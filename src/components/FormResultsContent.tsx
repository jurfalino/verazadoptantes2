'use client';

import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import FormAnswersPanel from '@/components/FormAnswersPanel';

interface MatchedAdopter {
    id: string;
    name: string;
    matchTypes: string[];
}

interface MatchedProfile {
    id: string;
    name: string;
    contactInfo: string | null;
    status: string | null;
}

interface FormResultsContentProps {
    notificationId: string;
    submitted: {
        name: string;
        email: string;
        phone: string;
        address: string;
        species: string;
        lifeStage: string;
        intent: string;
        household: string;
    } | undefined;
    submission: {
        id: string;
        selfieUrl: string | null;
        species: string | null;
        lifeStage: string | null;
        specialNeeds: number | null;
        intent: string | null;
        household: string | null;
        latitude: string | null;
        longitude: string | null;
        status: string | null;
        linkedAdopterId: string | null;
        answersJson: string | null;
    } | undefined;
    fullAnswers: Record<string, any>;
    householdItems: string[];
    hasMatches: boolean;
    matchCount: number;
    matchedAdopters: MatchedAdopter[] | undefined;
    matchedFormSubmissions?: Array<{ id: string; name: string; notificationId: string | null }>;
    matchedProfiles: MatchedProfile[];
}

export default function FormResultsContent(props: FormResultsContentProps) {
    const { t } = useLanguage();
    const {
        notificationId,
        submitted,
        submission,
        fullAnswers,
        householdItems,
        hasMatches,
        matchCount,
        matchedAdopters,
        matchedFormSubmissions = [],
        matchedProfiles,
    } = props;

    const speciesLabel = (code: string | null | undefined): string | null => {
        if (!code) return null;
        switch (code) {
            case 'dog': return '🐶 ' + t('species.dog');
            case 'cat': return '🐱 ' + t('species.cat');
            case 'bird': return '🐦 ' + t('species.bird');
            case 'both': return '🐾 Both';
            default: return code;
        }
    };

    const lifeStageLabel = (code: string | null | undefined): string | null => {
        if (!code) return null;
        switch (code) {
            case 'puppy': return t('adoption.lifeStage_puppy') || 'Puppy';
            case 'young': return t('adoption.lifeStage_young') || 'Young';
            case 'senior': return t('adoption.lifeStage_senior') || 'Senior';
            case 'none': return t('adoption.lifeStage_none') || 'No preference';
            default: return code;
        }
    };

    return (
        <main className="container mx-auto px-4 py-8 max-w-2xl">
            {/* Header */}
            <div className="mb-6">
                <Link href="/my-animals" className="text-sm text-stone-500 hover:text-stone-600 transition-colors">
                    ← {t('formResults.back_to_animals')}
                </Link>
                <h1 className="text-xl font-semibold text-stone-800 mt-2">
                    📋 {t('formResults.title')}
                </h1>
                {submitted?.name && (
                    <p className="text-sm text-stone-500 mt-1">
                        {t('formResults.completed_by')}{' '}
                        <span className="font-semibold text-stone-700">{submitted.name}</span>
                    </p>
                )}
            </div>

            {/* Status Banner */}
            {(() => {
                const isLinked = submission?.status === 'linked' && submission?.linkedAdopterId;
                if (isLinked && submission?.linkedAdopterId) {
                    return (
                        <div className="rounded-xl p-4 mb-6 bg-teal-50 border border-teal-200">
                            <p className="text-sm font-semibold text-teal-800">
                                {t('formResults.status_linked')}
                            </p>
                            <p className="text-xs mt-1 text-teal-700 mb-3">
                                {t('formResults.status_linked_desc')}
                            </p>
                            <Link
                                href={`/adopter/${submission.linkedAdopterId}`}
                                className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700 hover:text-teal-800 underline underline-offset-2"
                            >
                                👤 {t('formResults.view_linked_profile_cta')}
                            </Link>
                        </div>
                    );
                }
                return (
                    <div className={`rounded-xl p-4 mb-6 ${hasMatches ? 'bg-amber-50 border border-amber-200' : 'bg-teal-50 border border-teal-200'}`}>
                        <p className={`text-sm font-semibold ${hasMatches ? 'text-amber-800' : 'text-teal-800'}`}>
                            {hasMatches
                                ? t('formResults.status_found_matches').replace('{count}', String(matchCount))
                                : t('formResults.status_no_matches')}
                        </p>
                        <p className={`text-xs mt-1 ${hasMatches ? 'text-amber-600' : 'text-teal-700'}`}>
                            {hasMatches
                                ? t('formResults.status_found_desc')
                                : t('formResults.status_no_matches_desc')}
                        </p>
                    </div>
                );
            })()}

            {/* Selfie */}
            {submission?.selfieUrl && (
                <div className="mb-6 text-center">
                    <img
                        src={submission.selfieUrl.includes('r2.dev') ? `/api/proxy-image?url=${encodeURIComponent(submission.selfieUrl)}` : submission.selfieUrl}
                        alt={t('formResults.selfie_alt')}
                        className="w-24 h-24 rounded-full object-cover mx-auto border-2 border-stone-200 shadow-sm"
                    />
                </div>
            )}

            {/* Contact Data */}
            {submitted && (
                <div className="bg-white rounded-xl border border-stone-200 p-4 mb-4 shadow-sm">
                    <h2 className="text-sm font-semibold text-stone-700 mb-3">
                        {t('formResults.contact_section')}
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {submitted.name && <DataPill label={t('formResults.name_label')} value={submitted.name} />}
                        {submitted.email && <DataPill label={t('formResults.email_label')} value={submitted.email} />}
                        {submitted.phone && <DataPill label={t('formResults.phone_label')} value={submitted.phone} />}
                        {submitted.address && <DataPill label={t('formResults.address_label')} value={submitted.address} />}
                    </div>
                </div>
            )}

            {/* Preferences */}
            <div className="bg-white rounded-xl border border-stone-200 p-4 mb-4 shadow-sm">
                <h2 className="text-sm font-semibold text-stone-700 mb-3">
                    {t('formResults.preferences_section')}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {submitted?.species && (
                        <DataPill label={t('formResults.species_label')} value={speciesLabel(submitted.species) || submitted.species} />
                    )}
                    {submitted?.lifeStage && (
                        <DataPill label={t('formResults.lifeStage_label')} value={lifeStageLabel(submitted.lifeStage) || submitted.lifeStage} />
                    )}
                    {submitted?.intent && (
                        <DataPill
                            label={t('formResults.intent_label')}
                            value={submitted.intent === 'self' ? t('formResults.intent_self') : t('formResults.intent_gift')}
                        />
                    )}
                    {submission?.specialNeeds === 1 && (
                        <DataPill label={t('formResults.specialNeeds_label')} value={t('formResults.specialNeeds_open')} />
                    )}
                </div>
            </div>

            {/* Household */}
            {householdItems.length > 0 && (
                <div className="bg-white rounded-xl border border-stone-200 p-4 mb-4 shadow-sm">
                    <h2 className="text-sm font-semibold text-stone-700 mb-3">
                        {t('formResults.household_section')}
                    </h2>
                    <div className="flex flex-wrap gap-2">
                        {householdItems.map(item => (
                            <span key={item} className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-stone-100 text-stone-700">
                                {t(`formResults.household_${item}`)}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Full Answers (grouped & translated in client) */}
            {Object.keys(fullAnswers).length > 0 && (
                <FormAnswersPanel fullAnswers={fullAnswers} />
            )}

            {/* Geolocation */}
            {submission?.latitude && submission?.longitude && (
                <div className="bg-white rounded-xl border border-stone-200 p-4 mb-4 shadow-sm">
                    <h2 className="text-sm font-semibold text-stone-700 mb-2">
                        {t('formResults.location_section')}
                    </h2>
                    <p className="text-xs text-stone-500">
                        {submission.latitude}, {submission.longitude}
                    </p>
                </div>
            )}

            {/* Matched Profiles */}
            {hasMatches && matchedAdopters && matchedAdopters.length > 0 && (
                <div className="space-y-3 mb-6">
                    <h2 className="text-sm font-semibold text-stone-700">
                        {t('formResults.matches_section')}
                    </h2>
                    {matchedAdopters.map((match) => {
                        const profile = matchedProfiles.find(p => p.id === match.id);
                        if (!profile) return null;

                        return (
                            <Link
                                key={match.id}
                                href={`/adopter/${match.id}`}
                                className="block bg-white rounded-xl border border-stone-200 p-4 shadow-sm hover:shadow-md hover:border-stone-300 transition-all"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-stone-800">{profile.name}</p>
                                        {profile.contactInfo && (
                                            <p className="text-xs text-stone-500 mt-0.5 line-clamp-2">{profile.contactInfo}</p>
                                        )}
                                    </div>
                                    <svg className="w-4 h-4 text-stone-500 flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                </div>
                            </Link>
                        );
                    })}
                </div>
            )}

            {/* Actions */}
            {submission?.status !== 'linked' && (
                <div className="mt-6 pt-4 border-t border-stone-200 space-y-3">
                    <p className="text-xs text-stone-500 font-medium mb-2">
                        {t('formResults.actions_section')}
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2">
                        <Link
                            href={`/adopter/create?fromForm=${submission?.id ?? ''}`}
                            className="flex items-center justify-center gap-2 px-4 py-3 bg-teal-50 rounded-xl border border-teal-200 text-sm font-semibold text-teal-700 hover:bg-teal-100 transition-colors"
                        >
                            ➕ {t('formResults.create_profile_cta')}
                        </Link>
                        <Link
                            href={`/form-results/${notificationId}/link`}
                            prefetch={false}
                            className="flex items-center justify-center gap-2 px-4 py-3 bg-white rounded-xl border border-stone-200 text-sm font-semibold text-stone-700 hover:bg-stone-50 transition-colors"
                        >
                            🔗 {t('formResults.link_to_existing_cta')}
                        </Link>
                    </div>
                </div>
            )}
        </main>
    );
}

function DataPill({ label, value }: { label: string; value: string | null }) {
    if (!value) return null;
    return (
        <div className="flex items-start gap-2 text-xs">
            <span className="text-stone-500 font-medium whitespace-nowrap">{label}:</span>
            <span className="text-stone-700 break-all">{value}</span>
        </div>
    );
}

