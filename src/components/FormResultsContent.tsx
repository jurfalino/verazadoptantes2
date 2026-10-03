'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import { useTimezone } from '@/context/TimezoneContext';
import { useLanguage } from '@/context/LanguageContext';
import FormAnswersPanel, { renderFormAnswerValue } from '@/components/FormAnswersPanel';
import FormResultMatchCard from '@/components/FormResultMatchCard';
import { buttonClasses } from '@/components/ui/Button';
import { en } from '@/i18n/locales/en';
import { ChevronDown, ChevronRight, CheckCircle2, Users, UserPlus, UserCheck, ArrowRight } from 'lucide-react';
import { formResultsView, type FormLinkKind, type FormResultsAction, type FormResultsBanner } from '@/domain/formLink';

// Single source of truth: fallbacks come from English locale so labels always render
const formResultsFallbacks = en.formResults as Record<string, string>;

/**
 * `submission.createdAt` arrives as a server prop and renders on first paint,
 * so this runs once on the Worker and once in the browser. It used to pass
 * `undefined` as the locale and no `timeZone`, meaning *both* varied between
 * the two passes — a React #418 waiting to happen (see src/lib/dates.ts).
 * Locale and zone are both explicit now.
 */
function formatSubmissionDate(date: Date | null | undefined, timeZone: string): string {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date as unknown as string | number);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('es-AR', { dateStyle: 'medium', timeZone });
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
                className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left text-sm font-semibold text-stone-700 hover:bg-[var(--accent-subtle-bg)] transition-colors"
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
        autoAdopterId: string | null;
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
    linkKind: FormLinkKind;
    /** The live profile the form points at — null when unlinked, or linked to a since-merged profile. */
    linkedProfile: { id: string; name: string; profileImageUrl: string | null } | null;
}

/** Status tones map to the semantic tokens (style guide §1.2), which both themes define. */
const BANNER_TONE: Record<FormResultsBanner, 'success' | 'warning' | 'info'> = {
    linked_existing: 'success',
    review_matches: 'warning',
    unlinked_with_matches: 'warning',
    new_profile: 'info',
    unlinked: 'info',
};

function proxied(url: string): string {
    return url.includes('r2.dev') ? `/api/proxy-image?url=${encodeURIComponent(url)}` : url;
}

export default function FormResultsContent(props: FormResultsContentProps) {
    const timeZone = useTimezone();
    const { t } = useLanguage();
    const L = (key: string) => (t(`formResults.${key}`) || '').trim() || formResultsFallbacks[key] || key;
    const {
        submitted,
        submission,
        fullAnswers,
        householdItems,
        hasMatches,
        matchCount,
        matchedAdopters,
        matchedFormSubmissions: _matchedFormSubmissions = [],
        matchedProfiles,
        linkKind,
        linkedProfile,
    } = props;

    const [completeAnswersOpen, setCompleteAnswersOpen] = useState(!hasMatches || (matchCount ?? 0) <= 1);
    const [dismissedMatchIds, setDismissedMatchIds] = useState<string[]>([]);
    const matchesSectionRef = useRef<HTMLDivElement>(null);

    // Matches that can still render a card: live profile, not dismissed.
    // The linked one goes first, so "which did I pick?" is answered on open.
    const linkedId = submission?.linkedAdopterId ?? null;
    const visibleMatches = (matchedAdopters ?? [])
        .filter((m) => !dismissedMatchIds.includes(m.id) && matchedProfiles.some((p) => p.id === m.id))
        .sort((a, b) => Number(b.id === linkedId) - Number(a.id === linkedId));
    const view = formResultsView(linkKind, visibleMatches.length);
    const [matchesOpen, setMatchesOpen] = useState(view.matchesOpenByDefault);
    // Only a live profile gets a link: one merged away before merges carried
    // form links along would 404.
    const profileHref = linkedProfile ? `/adopter/${linkedProfile.id}` : null;
    const createHref = `/adopter/create?fromForm=${submission?.id ?? ''}`;

    const scrollToMatchingProfiles = () => {
        setMatchesOpen(true);
        setTimeout(() => {
            matchesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    };

    /** One renderer for every placement, so banner, bottom and sticky bar can't drift. */
    const renderAction = (action: FormResultsAction, variant: 'primary' | 'secondary', fullWidth = false) => {
        const className = buttonClasses({ variant, fullWidth });
        switch (action) {
            case 'review_matches':
                return (
                    <button key={action} type="button" onClick={scrollToMatchingProfiles} className={className}>
                        <Users className="w-5 h-5" strokeWidth={1.5} aria-hidden="true" />
                        {L('action_review_matches')}
                    </button>
                );
            case 'view_profile':
                if (!profileHref) return null;
                return (
                    <Link key={action} href={profileHref} className={className}>
                        {linkKind === 'new_profile' ? L('action_view_new_profile') : L('action_view_profile')}
                        <ArrowRight className="w-5 h-5" strokeWidth={1.5} aria-hidden="true" />
                    </Link>
                );
            case 'create_profile':
                return (
                    <Link key={action} href={createHref} className={className}>
                        <UserPlus className="w-5 h-5" strokeWidth={1.5} aria-hidden="true" />
                        {L('create_profile_cta')}
                    </Link>
                );
        }
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
                            {L('submitted_on')} {formatSubmissionDate(submission.createdAt, timeZone)}
                        </p>
                    )}
                </div>
            </div>

            <StatusBanner
                banner={view.banner}
                count={visibleMatches.length}
                applicantName={submitted?.name || null}
                linkedProfile={linkedProfile}
                hadMatches={matchCount > 0}
                L={L}
                actions={
                    <>
                        {renderAction(view.primary, 'primary')}
                        {view.secondary && renderAction(view.secondary, 'secondary')}
                    </>
                }
            />

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
                                        <span className="text-stone-800 min-w-0 [overflow-wrap:anywhere]">{submitted.name}</span>
                                    </div>
                                )}
                                {submitted?.email && (
                                    <div className="flex items-baseline gap-2 text-xs">
                                        <span className="font-semibold text-stone-600 min-w-[140px]">{L('email_label')}:</span>
                                        <span className="text-stone-800 min-w-0 [overflow-wrap:anywhere]">{submitted.email}</span>
                                    </div>
                                )}
                                {submitted?.phone && (
                                    <div className="flex items-baseline gap-2 text-xs">
                                        <span className="font-semibold text-stone-600 min-w-[140px]">{L('phone_label')}:</span>
                                        <span className="text-stone-800 min-w-0 [overflow-wrap:anywhere]">{submitted.phone}</span>
                                    </div>
                                )}
                                {submitted?.address && (
                                    <div className="flex items-baseline gap-2 text-xs">
                                        <span className="font-semibold text-stone-600 min-w-[140px]">{L('address_label')}:</span>
                                        <span className="text-stone-800 min-w-0 [overflow-wrap:anywhere]">{submitted.address}</span>
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
                                            <span className="text-stone-800 min-w-0 [overflow-wrap:anywhere]">{display}</span>
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
                                                <span className="text-stone-800 min-w-0 [overflow-wrap:anywhere]">{display}</span>
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
            {visibleMatches.length > 0 && submission && (
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
                                    submissionId={submission.id}
                                    canLink={view.canLinkMatches}
                                    linked={linkKind === 'linked_existing' && match.id === linkedId}
                                    willMerge={linkKind === 'new_profile' && !!linkedProfile}
                                    onDismiss={() => setDismissedMatchIds((ids) => [...ids, match.id])}
                                />
                            );
                        })}
                    </div>
                </CollapsibleSection>
                </div>
            )}

            {/* Bottom actions + mobile sticky bar: only while there is no profile
                yet. Once one exists the banner's "Ver perfil" is the only next
                step, and matches carry their own decision buttons. */}
            {view.primary === 'create_profile' && (
                <>
                    <div className="mt-6 pt-4 border-t border-stone-200">
                        <p className="text-xs text-stone-500 font-semibold mb-2">
                            {L('actions_section')}
                        </p>
                        <div className="flex flex-col sm:flex-row gap-2">
                            {renderAction('create_profile', 'primary')}
                            {view.secondary && renderAction(view.secondary, 'secondary')}
                        </div>
                    </div>
                    {/* --surface-card, not bg-white/95: that opacity variant has no
                        [data-theme] remap and rendered a white slab in Azul Noche. */}
                    <div
                        className="md:hidden fixed bottom-0 left-0 right-0 p-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] safe-area-pb z-10"
                        style={{ background: 'var(--surface-card)', borderTop: '1px solid var(--border-default)' }}
                    >
                        {renderAction('create_profile', 'primary', true)}
                    </div>
                    <div className="md:hidden h-20" aria-hidden />
                </>
            )}
        </main>
    );
}

/**
 * The page's answer to "where does this form stand?". One sentence of state,
 * one of consequence, then the next step. The linked state names the profile
 * and shows its photo — before v2.56.129 it read the same before and after the
 * rescuer chose a match, which is the bug this exists to fix.
 */
function StatusBanner({
    banner,
    count,
    applicantName,
    linkedProfile,
    hadMatches,
    L,
    actions,
}: {
    banner: FormResultsBanner;
    count: number;
    applicantName: string | null;
    linkedProfile: { id: string; name: string; profileImageUrl: string | null } | null;
    hadMatches: boolean;
    L: (key: string) => string;
    actions: React.ReactNode;
}) {
    const tone = BANNER_TONE[banner];
    const reviewTitle = count === 1 ? L('banner_review_title_one') : L('banner_review_title').replace('{count}', String(count));
    const newProfileName = applicantName || linkedProfile?.name;
    const { title, desc } = (() => {
        switch (banner) {
            case 'review_matches':
                return { title: reviewTitle, desc: L('banner_review_desc') };
            case 'unlinked_with_matches':
                return { title: reviewTitle, desc: L('banner_review_unlinked_desc') };
            case 'new_profile':
                return {
                    title: newProfileName ? L('banner_new_profile_title').replace('{name}', newProfileName) : L('banner_new_profile_title_generic'),
                    // "No previous records" is only true when nothing matched at
                    // all — not when matches were dismissed or merged away.
                    desc: hadMatches ? null : L('banner_new_profile_desc'),
                };
            case 'linked_existing':
                return {
                    // No "it's in their history" line: forms moved by a merge
                    // from the duplicates queue never got a request record.
                    title: linkedProfile ? L('banner_linked_title').replace('{name}', linkedProfile.name) : L('status_linked'),
                    desc: null,
                };
            case 'unlinked':
                return { title: L('banner_unlinked_title'), desc: L('banner_unlinked_desc') };
        }
    })();
    const Icon = tone === 'success' ? CheckCircle2 : tone === 'warning' ? Users : UserCheck;
    // The person, not an icon, once there is a profile to show.
    const photo = (banner === 'linked_existing' || banner === 'new_profile') ? linkedProfile?.profileImageUrl : null;

    return (
        <section
            aria-live="polite"
            data-testid="form-status-banner"
            data-state={banner}
            className="rounded-2xl border p-4 mb-6"
            style={{ background: `var(--status-${tone}-bg)`, borderColor: `var(--status-${tone}-border)` }}
        >
            <div className="flex items-start gap-4">
                {photo ? (
                    <span className="relative shrink-0">
                        <img
                            src={proxied(photo)}
                            alt=""
                            className="w-12 h-12 rounded-full object-cover bg-stone-100"
                        />
                        {tone === 'success' && (
                            <span
                                className="absolute -bottom-1 -right-1 rounded-full"
                                style={{ background: 'var(--surface-card)', color: 'var(--status-success-text)' }}
                            >
                                <CheckCircle2 className="w-5 h-5" strokeWidth={2} aria-hidden="true" />
                            </span>
                        )}
                    </span>
                ) : (
                    <span
                        className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
                        style={{ background: 'var(--surface-card)', color: `var(--status-${tone}-text)` }}
                    >
                        <Icon className="w-5 h-5" strokeWidth={2} aria-hidden="true" />
                    </span>
                )}
                <div className="min-w-0 flex-1">
                    <h2 className="text-base font-bold leading-snug break-words" style={{ color: 'var(--text-primary)' }}>
                        {title}
                    </h2>
                    {desc && (
                        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                            {desc}
                        </p>
                    )}
                </div>
            </div>
            {/* From sm up the buttons line up under the title, not under the
                photo: 48px photo / 40px tile + the 16px gap. */}
            <div className={`flex flex-col sm:flex-row sm:flex-wrap gap-2 mt-4 ${photo ? 'sm:pl-16' : 'sm:pl-14'}`}>
                {actions}
            </div>
        </section>
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

