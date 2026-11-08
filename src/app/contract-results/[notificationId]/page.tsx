export const runtime = 'edge';

import { AlertTriangle, CheckCircle2, FileSignature, Search, User } from 'lucide-react';
import { redirect, notFound } from 'next/navigation';
import type { OpenFlagKind } from '@/domain/flags';
import { getDb } from '@/lib/db';
import { notifications, adopters } from '@/db/schema';
import { eq, or, and, isNull } from 'drizzle-orm';
import { getUser } from '@/app/actions/_db';
import { markNotificationRead } from '@/app/actions/notifications';
import { adopterDisplayName } from '@/lib/adopterDisplay';
import Link from 'next/link';
import { formBackLink } from '@/domain/formBackLink';
import { logger } from '@/lib/logger';
import { loadOpenPairs } from '@/lib/openPairs';
import { isOrgMate } from '@/lib/orgMembership';
import { isAdminAsync } from '@/config/admins';
import { maskMatchCardsForViewer } from '@/lib/piiAccessServer';
import { householdLinesFor, HOUSEHOLD_LINE_CARDS } from '@/lib/households';
import { countsFor } from '@/lib/profileSummary';
import { isMinor, type CardHousehold } from '@/domain/households';
import ContractResultsMatchCard from '@/components/ContractResultsMatchCard';
import ContractResultsKeepNewButton from '@/components/ContractResultsKeepNewButton';
import { Tr } from '@/components/ui/Tr';

interface MatchedAdopter {
    id: string;
    name: string;
    matchTypes: string[];
    /** Search score; stored on notifications since 2026-10-25, admins only. */
    score?: number;
}

interface NotificationMetadata {
    notificationId?: string;
    animalId: string;
    animalName: string;
    adopterId: string;
    adopterName: string;
    matchCount: number;
    matchedAdopters?: MatchedAdopter[];
    submittedData?: {
        name: string;
        phone: string;
        email: string;
        dni: string;
        address: string;
        socialNetworks: string;
    };
}


export default async function ContractResultsPage({ params }: { params: Promise<{ notificationId: string }> }) {
    const { notificationId } = await params;
    let currentUser = '';
    try {
        currentUser = await getUser();
    } catch (e: any) {
        if (e?.digest?.startsWith('NEXT_REDIRECT')) throw e;
        redirect(`/?authRequired=1&callbackUrl=${encodeURIComponent(`/contract-results/${notificationId}`)}`);
    }

    const db = await getDb();
    if (!db) {
        return <ErrorState message="error_db" />;
    }

    // Find notification by ID
    const notification = await db.select().from(notifications).where(eq(notifications.id, notificationId)).get();

    // Missing → 404. Not the recipient → teammates/admins keep the "no permission"
    // screen; strangers get the 404 (PII: don't confirm it exists). `userId` is the recipient email.
    if (!notification) notFound();
    if (notification.userId !== currentUser) {
        const teammateOrAdmin = (await isOrgMate(currentUser, notification.userId)) || (await isAdminAsync(currentUser));
        logger.info('contract-results: denied', { notificationId, userEmail: currentUser, teammateOrAdmin });
        if (!teammateOrAdmin) notFound();
        return <ErrorState message="error_no_permission" />;
    }

    // Mark as read
    await markNotificationRead(notificationId, currentUser);

    const metadata: NotificationMetadata = notification.metadata ? JSON.parse(notification.metadata) : {};

    // A contract match is an ordinary duplicate pair (spec 2026-11-05): the cards
    // are the new profile's OPEN PAIRS, so an answer given anywhere clears them.
    let matchList: Array<MatchedAdopter & { candidateId: string; canAnswer: boolean }> = [];
    if (metadata.adopterId) {
        try {
            const pairs = await loadOpenPairs(db, metadata.adopterId, currentUser, { limit: 20 });
            matchList = pairs.map(p => ({ id: p.otherAdopterId, name: p.otherAdopterName, matchTypes: p.matchTypes, score: p.score, candidateId: p.id, canAnswer: p.onViewerList }));
        } catch (e) {
            const errorId = logger.error('contract-results: open pairs unreadable', e, { notificationId, user: currentUser, adopterId: metadata.adopterId });
            return <ErrorState message="error_load" errorId={errorId} />;
        }
    }

    // Fetch full adopter profiles for matches
    let matchedProfiles: Array<{ id: string; name: string; contactInfo: string | null; contactEntries: string | null; status: string | null; isMinor?: boolean; households?: CardHousehold; rating?: number | null; openFlags?: OpenFlagKind[] }> = [];
    if (matchList.length > 0) {
        const adopterIds = matchList.map(a => a.id);
        // Filter soft-deleted (merged-duplicate) adopters at read time so even legacy
        // notifications whose stored matchedAdopters contains since-deleted IDs render correctly.
        type Row = {
            id: string; name: string; status: string | null;
            addedBy: string | null; isPublic: number | null;
            contactInfo: string | null; contactEntries: string | null; addressInfo: string | null;
            age: number | null; ageAsOf: string | null; isMinor: number | null;
        };
        const rows: Row[] = await db
            .select({
                id: adopters.id, name: adopters.name, status: adopters.status,
                // Masking inputs only — never forwarded to the client.
                addedBy: adopters.addedBy, isPublic: adopters.isPublic,
                contactInfo: adopters.contactInfo, contactEntries: adopters.contactEntries, addressInfo: adopters.addressInfo,
                age: adopters.age, ageAsOf: adopters.ageAsOf, isMinor: adopters.isMinor,
            })
            .from(adopters)
            .where(and(or(...adopterIds.map(id => eq(adopters.id, id)))!, isNull(adopters.deletedAt)))
            .all();
        // Another rescuer's protected profile must not reach the card raw: the
        // same masking discovery search applies, unlocking only what this
        // contract's adopter typed. Built field by field — never spread a row.
        const sd = metadata.submittedData;
        const masked = await maskMatchCardsForViewer(
            currentUser,
            rows,
            [sd?.phone, sd?.email, sd?.dni, ...(sd?.socialNetworks ?? '').split(/[\s,;]+/)],
            { notificationId },
        );
        matchedProfiles = rows.map(r => ({
            id: r.id,
            name: r.name,
            contactInfo: masked.get(r.id)?.contactInfo ?? null,
            contactEntries: masked.get(r.id)?.contactEntries ?? null,
            status: r.status,
            ...(isMinor(r) ? { isMinor: true } : {}),
        }));
        // Final fix P2: who each one lives with, as on every card showing one person (never throws).
        if (matchedProfiles.length) {
            // Every card its housemate chips; the first HOUSEHOLD_LINE_CARDS their list whatever it says.
            const homes = await householdLinesFor(db, currentUser, matchedProfiles.map(p => p.id), { listCards: HOUSEHOLD_LINE_CARDS });
            matchedProfiles = matchedProfiles.map(p => (homes[p.id] ? { ...p, households: homes[p.id] } : p));
            // Each card's own rating and alerts (audit B6); countsFor never throws (it logs and shows «Sin calificación»).
            const standing = await Promise.all(matchedProfiles.slice(0, HOUSEHOLD_LINE_CARDS).map(p => countsFor(db, p.id, { notificationId, user: currentUser }, { activity: false })));
            matchedProfiles = matchedProfiles.map((p, i) => (standing[i] ? { ...p, rating: standing[i].rating, openFlags: standing[i].openFlags } : p));
        }
    }

    const hasMatches = matchList.length > 0;
    // Matched at signing, but every match has been answered since: never say "no records".
    const answeredAll = !hasMatches && (metadata.matchCount ?? 0) > 0;
    const signer = {
        name: metadata.submittedData?.name ?? metadata.adopterName ?? '',
        entries: [
            { type: 'phone', value: metadata.submittedData?.phone ?? '' },
            { type: 'email', value: metadata.submittedData?.email ?? '' },
            { type: 'id', value: metadata.submittedData?.dni ?? '' },
            { type: 'address', value: metadata.submittedData?.address ?? '' },
            { type: 'social', value: metadata.submittedData?.socialNetworks ?? '' },
        ].filter(e => e.value.trim()),
    };
    const submitted = metadata.submittedData;

    return (
        <main className="container mx-auto px-4 py-8 max-w-2xl">
            {/* Header */}
            <div className="mb-6">
                {/* D3: names where it goes, as the form screen does when opened from a notice. */}
                <Link href={formBackLink(null, {}).href} data-testid="contract-back-link" className="text-sm text-stone-500 hover:text-stone-600 transition-colors">
                    ← <Tr k={formBackLink(null, {}).label.key} />
                </Link>
                <h1 className="flex items-center gap-2 text-xl font-semibold text-stone-800 mt-2">
                    {hasMatches
                        ? <AlertTriangle className="w-5 h-5 shrink-0 text-amber-700" strokeWidth={1.75} aria-hidden="true" />
                        : <CheckCircle2 className="w-5 h-5 shrink-0 text-teal-700" strokeWidth={1.75} aria-hidden="true" />}
                    <Tr k="contractResults.title" />
                </h1>
                <p className="text-sm text-stone-500 mt-1">
                    {metadata.adopterName?.trim()
                        ? <Tr k="contractResults.adopted_by" vars={{ animal: metadata.animalName ?? '', name: adopterDisplayName({ name: metadata.adopterName }, '') }} />
                        : <Tr k="contractResults.adopted_by_unnamed" vars={{ animal: metadata.animalName ?? '' }} />}
                </p>
            </div>

            {/* Status Banner */}
            <div className={`rounded-xl p-4 mb-6 ${hasMatches ? 'bg-amber-50 border border-amber-200' : 'bg-teal-50 border border-teal-200'}`}>
                <p className={`text-sm font-semibold ${hasMatches ? 'text-amber-800' : 'text-teal-800'}`}>
                    {hasMatches
                        ? (matchList.length === 1 ? <Tr k="contractResults.banner_one" /> : <Tr k="contractResults.banner_many" vars={{ n: matchList.length }} />)
                        : answeredAll
                            ? <Tr k="contractResults.banner_answered" />
                            : <Tr k="contractResults.banner_none" />
                    }
                </p>
                <p className={`text-xs mt-1 ${hasMatches ? 'text-amber-600' : 'text-teal-700'}`}>
                    {hasMatches
                        ? <Tr k="contractResults.desc_matches" />
                        : answeredAll
                            ? <Tr k="contractResults.desc_answered" />
                            : <Tr k="contractResults.desc_none" />
                    }
                </p>
            </div>

            {/* Submitted Data */}
            {submitted && (
                <div className="bg-white rounded-xl border border-stone-200 p-4 mb-6 shadow-sm">
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-700 mb-3"><FileSignature className="w-4 h-4 shrink-0 text-teal-700" strokeWidth={1.75} aria-hidden="true" /><Tr k="contractResults.data_title" /></h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {submitted.name && <DataPill label={<Tr k="contractResults.field_name" />} value={submitted.name} />}
                        {submitted.phone && <DataPill label={<Tr k="contractResults.field_phone" />} value={submitted.phone} />}
                        {submitted.email && <DataPill label={<Tr k="contractResults.field_email" />} value={submitted.email} />}
                        {submitted.dni && <DataPill label={<Tr k="contractResults.field_document" />} value={submitted.dni} />}
                        {submitted.address && <DataPill label={<Tr k="contractResults.field_address" />} value={submitted.address} />}
                        {submitted.socialNetworks && <DataPill label={<Tr k="contractResults.field_social" />} value={submitted.socialNetworks} />}
                    </div>
                </div>
            )}

            {/* Matched Profiles */}
            {hasMatches && (
                <div className="space-y-3">
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-700"><Search className="w-4 h-4 shrink-0 text-teal-700" strokeWidth={1.75} aria-hidden="true" /><Tr k="samePerson.concept_many" /></h2>
                    {matchList.map((match) => {
                        const profile = matchedProfiles.find(p => p.id === match.id);
                        if (!profile) return null;

                        return (
                            <ContractResultsMatchCard
                                key={match.id}
                                matchId={match.id}
                                notificationId={notificationId}
                                profile={profile}
                                matchTypes={match.matchTypes}
                                score={match.score}
                                signer={signer}
                                compareOpen={matchList.length === 1}
                                candidateId={match.candidateId}
                                canAnswer={match.canAnswer}
                            />
                        );
                    })}
                </div>
            )}

            {/* "None of these match?" — explicit affordance for the keep-new outcome.
                Only shown when there ARE matches (without matches there's nothing to dismiss). */}
            {hasMatches && metadata.adopterId && (
                <div className="mt-6">
                    <h2 className="text-sm font-semibold text-stone-700 mb-2"><Tr k="contractResults.none_match_heading" /></h2>
                    <p className="text-xs text-stone-500 mb-3 leading-relaxed">
                        <Tr k="contractResults.none_match_desc" />
                    </p>
                    <ContractResultsKeepNewButton orphanAdopterId={metadata.adopterId} />
                </div>
            )}

            {/* Soft-investigation exit — the user wants to look at the new profile without
                committing to a triage decision. Wording is explicit about the "without deciding"
                intent so it doesn't compete with the keep-new CTA above. */}
            {metadata.adopterId && (
                <div className="mt-6 pt-4 border-t border-stone-200">
                    <Link
                        href={`/adopter/${metadata.adopterId}`}
                        className="inline-flex items-center gap-2 text-xs text-stone-500 hover:text-stone-700 transition-colors"
                    >
                        <User className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                        <Tr k="contractResults.view_new_without_deciding" />
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                    </Link>
                </div>
            )}
        </main>
    );
}

function DataPill({ label, value }: { label: React.ReactNode; value: string }) {
    return (
        <div className="flex items-start gap-2 text-xs">
            <span className="text-stone-500 font-medium whitespace-nowrap">{label}:</span>
            <span className="text-stone-700 break-all">{value}</span>
        </div>
    );
}

/** `message`: a contractResults.error_* key. */
function ErrorState({ message, errorId }: { message: 'error_db' | 'error_no_permission' | 'error_load'; errorId?: string }) {
    return (
        <main className="container mx-auto px-4 py-16 text-center">
            <p className="text-2xl mb-2">😕</p>
            <p className="text-sm text-stone-500 font-medium"><Tr k={`contractResults.${message}`} /></p>
            {errorId && <p className="text-xs text-stone-400 font-mono mt-2">Error ID: {errorId}</p>}
            <Link href="/" className="text-sm text-blue-600 hover:text-blue-700 mt-4 inline-block">
                <Tr k="contractResults.back_home" />
            </Link>
        </main>
    );
}
