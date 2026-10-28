'use client';

/**
 * Under a minor who can't be picked to carry a record (audit A3): why, and —
 * where picking someone else makes sense — the adults of their household to
 * pick instead, when known. One rendering for
 * every list that picks a person for a record — the adoption wizard's picker
 * (AdopterPicker) and the post import's match list (ImportWizard).
 */
import { useLanguage } from '@/context/LanguageContext';
import { PersonStanding } from '@/components/PersonStanding';
import type { HouseholdLine } from '@/domain/households';

/**
 * A minor's housemates who can carry the record: adults only, never a gift
 * recipient's household, each once. From the person's own household line.
 */
export function adultsToOffer(lines: HouseholdLine[] | null | undefined): HouseholdLine[] {
    const seen = new Set<string>();
    return (lines ?? []).filter(l => !l.isMinor && !l.isGift && !seen.has(l.profileId) && seen.add(l.profileId));
}

export function MinorRecordsNote({ households, onPickAdult, testIdPrefix, className = '' }: {
    households: HouseholdLine[] | null | undefined;
    /** Offer their household's adults to pick instead; without it, only the why. */
    onPickAdult?: (adult: HouseholdLine) => void;
    /** `picker` → picker-minor-note / picker-minor-adult. */
    testIdPrefix: string;
    className?: string;
}) {
    const { t } = useLanguage();
    const adults = onPickAdult ? adultsToOffer(households) : [];
    return (
        <div className={`text-xs text-stone-600 space-y-1.5 ${className}`} data-testid={`${testIdPrefix}-minor-note`}>
            <p>{t('adopter.minor_note')}</p>
            {adults.length > 0 && (
                <div className="space-y-1">
                    <p className="font-semibold text-stone-500">{t('wizard.minor_pick_adult')}</p>
                    {adults.map(a => (
                        <button key={a.profileId} type="button" data-testid={`${testIdPrefix}-minor-adult`} data-profile-id={a.profileId}
                            onClick={() => onPickAdult?.(a)}
                            className="w-full flex flex-wrap items-center gap-x-2 gap-y-0.5 min-h-[44px] px-3 py-2 rounded-xl border border-stone-200 bg-white hover:bg-teal-50 hover:border-teal-400 text-left transition-colors">
                            <span className="font-semibold text-sm text-stone-800 break-words">{a.name}</span>
                            <PersonStanding rating={a.rating} openAlerts={a.openAlerts} isMinor={false} />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
