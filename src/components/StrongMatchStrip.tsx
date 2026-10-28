'use client';

/**
 * Persistent inline strip rendered above the AdopterForm save button. Surfaces
 * up to 2 "strong" duplicate matches (exact phone / email / social hits) that
 * the user MUST see — identity collisions are the highest-cost dup vector and
 * must not be missable.
 *
 * Each row is the shared match card; «No es esta persona» dismisses it. Dismissed adopter ids are tracked by the parent
 * and feed the save-time modal gate: the modal only fires for strong matches
 * that are still on the strip when the user clicks save.
 */

import type { DiscoveryMatch } from '@/app/actions';
import { hasStrongMatch } from '@/lib/matchChips';
import { useLanguage } from '@/context/LanguageContext';
import { AlertTriangle } from 'lucide-react';
import { AdopterName } from '@/components/AdopterName';
import { isNamelessAdopter } from '@/lib/adopterDisplay';
import MatchCompare, { entriesAsShown, type MatchSourceKind } from '@/components/MatchCompare';
import { MatchCard } from '@/components/MatchCardParts';
import { openAlertKinds } from '@/domain/flags';

interface Props {
    /** What the rescuer has typed — their side of «Qué coincide y qué no». */
    compareSource: { kind: MatchSourceKind; name: string; entries: Array<{ type: string; value: string }> };
    results: DiscoveryMatch[] | null;
    dismissedIds: Set<string>;
    onDismiss: (adopterId: string) => void;
    onContinueWith?: (adopterId: string) => Promise<void> | void;
    busyAdopterId?: string | null;
}

export default function StrongMatchStrip({ results, dismissedIds, onDismiss, onContinueWith, busyAdopterId, compareSource }: Props) {
    const { t } = useLanguage();

    const strong = (results ?? [])
        .filter(r => hasStrongMatch(r.matchValues))
        .filter(r => !dismissedIds.has(r.adopter.id))
        .slice(0, 2);

    if (strong.length === 0) return null;

    return (
        <div className="md:col-span-2 rounded-xl border-2 border-amber-300 bg-amber-50 overflow-hidden" data-testid="strong-match-strip">
            <div className="px-4 py-2.5 bg-amber-100 border-b border-amber-300 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 shrink-0 text-amber-700" strokeWidth={1.75} aria-hidden="true" />
                <h3 className="text-sm font-bold text-amber-900">
                    {t('adopter.dup_strong_strip_title') || 'Likely exact match'}
                </h3>
            </div>
            <ul className="divide-y divide-amber-200">
                {strong.map(result => (
                    <li key={result.adopter.id} className="px-4 py-3 bg-white">
                        {/* The shared match card (audit B6): the same header, order and actions as the
                            «Posibles coincidencias» panel; «No es esta persona» takes it off the strip
                            (and out of the save check), where a small × used to. */}
                        <MatchCard newTab thumbnail={result.thumbnail} headTestId="strong-match-head"
                            person={{ id: result.adopter.id, name: result.adopter.name ?? '', rating: result.avgRating, openAlerts: openAlertKinds(result.flags), isMinor: result.isMinor, households: result.households }}
                            nameNode={isNamelessAdopter(result.adopter) ? <AdopterName adopter={result.adopter} className="break-words" /> : undefined}
                            compare={(
                                <MatchCompare
                                    adopterId={result.adopter.id}
                                    matchTypes={result.matchTypes}
                                    profileName={result.adopter.name ?? ''}
                                    source={compareSource}
                                    profileEntries={entriesAsShown(result.adopter)}
                                    score={result.relevancePercent}
                                    defaultOpen={strong.length === 1}
                                    t={t}
                                />
                            )}
                            actions={{
                                busy: busyAdopterId === result.adopter.id,
                                onSame: onContinueWith ? () => onContinueWith(result.adopter.id) : undefined,
                                sameLabel: t('adopter.dup_action_continue_with_existing') || 'Continue with this profile',
                                onNotThis: () => onDismiss(result.adopter.id),
                                notThisTestId: 'strong-match-not-this',
                            }} />
                    </li>
                ))}
            </ul>
        </div>
    );
}
