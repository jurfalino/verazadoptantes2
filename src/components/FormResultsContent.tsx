'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import FormAnswersPanel, { renderFormAnswerValue } from '@/components/FormAnswersPanel';
import FormResultMatchCard from '@/components/FormResultMatchCard';
import { en } from '@/i18n/locales/en';
import { ChevronDown, ChevronRight } from 'lucide-react';

// Single source of truth: fallbacks come from English locale so labels always render
const formResultsFallbacks = en.formResults as Record<string, string>;

function formatSubmissionDate(date: Date | null | undefined): string {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date as unknown as string | number);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function CollapsibleSection({
    title,
    open,
    onToggle,
    children,
}: {
    title: string;
    open: boolean;
    onToggle: () => void;
    children: React.ReactNode;
}) {
    return (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden mb-4 shadow-sm">
            <button
                type="button"
                onClick={onToggle}
                className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left text-sm font-semibold text-stone-700 hover:bg-stone-50 transition-colors"
                aria-expanded={open}
            >
                {open ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                <span className="flex-1">{title}</span>
            </button>
            {open && <div className="px-4 pb-4">{children}</div>}
        </div>
    );
}

interface MatchedAdopter {
    id: string;
    name: string;
    matchTypes: string[];
}

interface MatchedProfile {
    id: string;
    name: string;
    contactInfo: string | null;
    addressInfo: string | null;
    status: string | null;
    profileImageUrl?: string | null;
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
        createdAt?: Date | null;
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
    const L = (key: string) => (t(`formResults.${key}`) || '').trim() || formResultsFallbacks[key] || key;
    const {
        notificationId,
        submitted,
        submission,
        fullAnswers,
        householdItems,
        hasMatches,
        matchCount,
        matchedAdopters,
        matchedFormSubmissions: _matchedFormSubmissions = [],
        matchedProfiles,
    } = props;

    const [completeAnswersOpen, setCompleteAnswersOpen] = useState(!hasMatches || (matchCount ?? 0) <= 1);
    const [matchesOpen, setMatchesOpen] = useState(true);
    const [dismissedMatchIds, setDismissedMatchIds] = useState<string[]>([]);
    const matchesSectionRef = useRef<HTMLDivElement>(null);

    const visibleMatches = (matchedAdopters ?? []).filter((m) => !dismissedMatchIds.includes(m.id));

    const scrollToMatchingProfiles = () => {
        setMatchesOpen(true);
        setTimeout(() => {
            matchesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    };

    return (
        <main className="container mx-auto px-4 py-8 max-w-2xl">
            {/* Header */}
            <div className="mb-6">
                <Link href="/my-animals" className="text-sm text-stone-500 hover:text-stone-600 transition-colors">
                    ← {L('back_to_animals')}
                </Link>
                <h1 className="text-xl font-semibold text-stone-800 mt-2">
                    📋 {L('title')}
                </h1>
                <div className="text-sm text-stone-500 mt-1 space-y-0.5">
                    {submitted?.name && (
                        <p>
                            {L('completed_by')}{' '}
                            <span className="font-semibold text-stone-700">{submitted.name}</span>
                        </p>
                    )}
                    {submission?.createdAt && (
                        <p>
                            {L('submitted_on')} {formatSubmissionDate(submission.createdAt)}
                        </p>
                    )}
                </div>
            </div>

            {/* Status Banner */}
            {(() => {
                const isLinked = submission?.status === 'linked' && submission?.linkedAdopterId;
                if (isLinked && submission?.linkedAdopterId) {
                    return (
                        <div className="rounded-xl p-4 mb-6 bg-teal-50 border border-teal-200">
                            <p className="text-sm font-semibold text-teal-800">
                                {L('status_linked')}
                            </p>
                            <p className="text-xs mt-1 text-teal-700 mb-3">
                                {L('status_linked_desc')}
                            </p>
                            <Link
                                href={`/adopter/${submission.linkedAdopterId}`}
                                className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700 hover:text-teal-800 underline underline-offset-2"
                            >
                                👤 {L('view_linked_profile_cta')}
                            </Link>
                        </div>
                    );
                }
                return (
                    <div className={`rounded-xl p-4 mb-6 ${hasMatches ? 'bg-amber-50 border border-amber-200' : 'bg-teal-50 border border-teal-200'}`}>
                        <p className={`text-sm font-semibold ${hasMatches ? 'text-amber-800' : 'text-teal-800'}`}>
                            {hasMatches
                                ? L('status_found_matches').replace('{count}', String(matchCount))
                                : L('status_no_matches')}
                        </p>
                        <p className={`text-xs mt-1 mb-3 ${hasMatches ? 'text-amber-600' : 'text-teal-700'}`}>
                            {hasMatches
                                ? L('status_found_desc')
                                : L('status_no_matches_desc')}
                        </p>
                        {/* Primary CTAs in banner: Create profile; when matches exist, "See matching profiles" scrolls down */}
                        <div className="flex flex-wrap gap-2">
                            <Link
                                href={`/adopter/create?fromForm=${submission?.id ?? ''}`}
                                className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-3 bg-teal-600 text-white rounded-xl text-sm font-semibold hover:bg-teal-700 transition-colors"
                            >
                                ➕ {L('create_profile_cta')}
                            </Link>
                            {hasMatches && visibleMatches.length > 0 && (
                                <button
                                    type="button"
                                    onClick={scrollToMatchingProfiles}
                                    className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-3 bg-white rounded-xl border border-stone-300 text-sm font-semibold text-stone-700 hover:bg-stone-50 transition-colors"
                                >
                                    👤 {L('see_matching_profiles')}
                                </button>
                            )}
                        </div>
                    </div>
                );
            })()}

            {/* Selfie */}
            {submission?.selfieUrl && (
                <div className="mb-6 text-center">
                    <img
                        src={submission.selfieUrl.includes('r2.dev') ? `/api/proxy-image?url=${encodeURIComponent(submission.selfieUrl)}` : submission.selfieUrl}
                        alt={L('selfie_alt')}
                        className="w-24 h-24 rounded-full object-cover mx-auto border-2 border-stone-200 shadow-sm"
                    />
                </div>
            )}

            {/* Complete answers: adopter data, other pets, then preferences/commitments/context */}
            {(submitted || Object.keys(fullAnswers).length > 0) && (
                <CollapsibleSection
                    title={L('section_complete_answers')}
                    open={completeAnswersOpen}
                    onToggle={() => setCompleteAnswersOpen((o) => !o)}
                >
                    <div>
                        {/* Adopter information – same box and row styles as FormAnswersPanel */}
                        <div className="bg-white rounded-xl border border-stone-200 p-4 mb-4 shadow-sm">
                            <h2 className="text-sm font-semibold text-stone-700 mb-3">{L('section_adopter_info')}</h2>
                            <div className="space-y-1">
                                {submitted?.name && (
                                    <div className="flex items-baseline gap-2 text-xs">
                                        <span className="font-semibold text-stone-600 min-w-[140px]">{L('name_label')}:</span>
                                        <span className="text-stone-800">{submitted.name}</span>
                                    </div>
                                )}
                                {submitted?.email && (
                                    <div className="flex items-baseline gap-2 text-xs">
                                        <span className="font-semibold text-stone-600 min-w-[140px]">{L('email_label')}:</span>
                                        <span className="text-stone-800">{submitted.email}</span>
                                    </div>
                                )}
                                {submitted?.phone && (
                                    <div className="flex items-baseline gap-2 text-xs">
                                        <span className="font-semibold text-stone-600 min-w-[140px]">{L('phone_label')}:</span>
                                        <span className="text-stone-800">{submitted.phone}</span>
                                    </div>
                                )}
                                {submitted?.address && (
                                    <div className="flex items-baseline gap-2 text-xs">
                                        <span className="font-semibold text-stone-600 min-w-[140px]">{L('address_label')}:</span>
                                        <span className="text-stone-800">{submitted.address}</span>
                                    </div>
                                )}
                                {['ageRange', 'children', 'housingType', 'hasOutdoor', 'isSafe', 'hoursAlone'].map((field) => {
                                    const raw = fullAnswers[field];
                                    const display = renderFormAnswerValue(field, raw, t);
                                    if (!display) return null;
                                    return (
                                        <div key={field} className="flex items-baseline gap-2 text-xs">
                                            <span className="font-semibold text-stone-600 min-w-[140px]">
                                                {t(`petshield.fields.${field}`)}:
                                            </span>
                                            <span className="text-stone-800">{display}</span>
                                        </div>
                                    );
                                })}
                                {householdItems.length > 0 && (
                                    <>
                                        <div className="pt-1">
                                            <span className="text-xs font-medium text-stone-500">{L('household_section')}</span>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {householdItems.map(item => (
                                                <span key={item} className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-stone-100 text-stone-700">
                                                    {(t(`formResults.household_${item}`) || '').trim() || formResultsFallbacks[`household_${item}`] || item}
                                                </span>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Other pets – same box and row styles as FormAnswersPanel */}
                        {(fullAnswers.petExperience !== undefined || (typeof fullAnswers.existingPets === 'object' && fullAnswers.existingPets && Object.values(fullAnswers.existingPets).some((v) => typeof v === 'number' && v > 0))) && (
                            <div className="bg-white rounded-xl border border-stone-200 p-4 mb-4 shadow-sm">
                                <h2 className="text-sm font-semibold text-stone-700 mb-3">{L('section_other_pets')}</h2>
                                <div className="space-y-1">
                                    {['petExperience', 'existingPets'].map((field) => {
                                        const raw = fullAnswers[field];
                                        const display = renderFormAnswerValue(field, raw, t);
                                        if (!display) return null;
                                        return (
                                            <div key={field} className="flex items-baseline gap-2 text-xs">
                                                <span className="font-semibold text-stone-600 min-w-[140px]">
                                                    {t(`petshield.fields.${field}`)}:
                                                </span>
                                                <span className="text-stone-800">{display}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Preferences, commitments, context */}
                        {Object.keys(fullAnswers).length > 0 && (
                            <FormAnswersPanel fullAnswers={fullAnswers} excludeSections={['identity', 'household']} />
                        )}
                    </div>
                </CollapsibleSection>
            )}

            {/* Geolocation */}
            {submission?.latitude && submission?.longitude && (
                <div className="bg-white rounded-xl border border-stone-200 p-4 mb-4 shadow-sm">
                    <h2 className="text-sm font-semibold text-stone-700 mb-2">
                        {L('location_section')}
                    </h2>
                    <p className="text-xs text-stone-500">
                        {submission.latitude}, {submission.longitude}
                    </p>
                </div>
            )}

            {/* Matched Profiles – comparison cards (collapsible) */}
            {hasMatches && visibleMatches.length > 0 && submission && (
                <div id="section-matching-profiles" ref={matchesSectionRef}>
                <CollapsibleSection
                    title={`${L('section_matches')} (${visibleMatches.length})`}
                    open={matchesOpen}
                    onToggle={() => setMatchesOpen((o) => !o)}
                >
                    <div className="space-y-4">
                        {visibleMatches.map((match) => {
                            const profile = matchedProfiles.find(p => p.id === match.id);
                            if (!profile) return null;
                            const applicant = {
                                name: submitted?.name ?? '',
                                email: submitted?.email,
                                phone: submitted?.phone,
                                address: submitted?.address,
                            };
                            return (
                                <FormResultMatchCard
                                    key={match.id}
                                    applicant={applicant}
                                    profile={profile}
                                    applicantSelfieUrl={submission.selfieUrl}
                                    matchTypes={match.matchTypes ?? []}
                                    notificationId={notificationId}
                                    submissionId={submission.id}
                                    onDismiss={() => setDismissedMatchIds((ids) => [...ids, match.id])}
                                />
                            );
                        })}
                    </div>
                </CollapsibleSection>
                </div>
            )}

            {/* Actions (scenario-based: primary = Create when no matches; both when has matches) */}
            {submission?.status !== 'linked' && (
                <>
                    <div className="mt-6 pt-4 border-t border-stone-200 space-y-3">
                        <p className="text-xs text-stone-500 font-medium mb-2">
                            {L('actions_section')}
                        </p>
                        <div className="flex flex-col sm:flex-row gap-2">
                            <Link
                                href={`/adopter/create?fromForm=${submission?.id ?? ''}`}
                                className="flex items-center justify-center gap-2 min-h-[44px] px-4 py-3 bg-teal-600 text-white rounded-xl text-sm font-semibold hover:bg-teal-700 transition-colors"
                            >
                                ➕ {L('create_profile_cta')}
                            </Link>
                            {hasMatches && (
                                <Link
                                    href={`/form-results/${notificationId}/link`}
                                    prefetch={false}
                                    className="flex items-center justify-center gap-2 min-h-[44px] px-4 py-3 bg-white rounded-xl border border-stone-300 text-sm font-semibold text-stone-700 hover:bg-stone-50 transition-colors"
                                >
                                    🔗 {L('link_to_existing_cta')}
                                </Link>
                            )}
                        </div>
                    </div>
                    {/* Sticky CTA on mobile (same primary action) */}
                    <div className="md:hidden fixed bottom-0 left-0 right-0 p-3 bg-white/95 border-t border-stone-200 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] safe-area-pb z-10">
                        <Link
                            href={`/adopter/create?fromForm=${submission?.id ?? ''}`}
                            className="flex items-center justify-center gap-2 min-h-[48px] w-full px-4 py-3 bg-teal-600 text-white rounded-xl text-sm font-semibold hover:bg-teal-700 transition-colors"
                        >
                            ➕ {L('create_profile_cta')}
                        </Link>
                    </div>
                    <div className="md:hidden h-20" aria-hidden />
                </>
            )}
        </main>
    );
}

function _DataPill({ label, value }: { label: string; value: string | null }) {
    if (!value) return null;
    return (
        <div className="flex items-start gap-2 text-xs">
            <span className="text-stone-500 font-medium whitespace-nowrap">{label}:</span>
            <span className="text-stone-700 break-all">{value}</span>
        </div>
    );
}

