'use client';

/**
 * The household line of a card that shows ONE person — a search result or a
 * «¿Es este perfil?» candidate (households as profiles, prototype S1/S2):
 *
 *   ⌂ Convive con
 *     Pedro Paez ★1.0 Peligroso  1 alerta
 *     Marta Paez ★4.0 Bueno
 *     En otro hogar, con
 *     Ana Gómez ★3.0 Regular
 *
 * One block per home, one housemate per line so a name never wraps away from
 * its rating — written by PersonStanding, as on a household row and «¿Es este
 * perfil?». A minor shows «Menor de edad» before the rating. Names are
 * plain text: the search card is itself a link. Gift-only lines are left out
 * (a gift recipient doesn't live there). Renders nothing with no housemates.
 */

import { Home } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { PersonStanding } from '@/components/PersonStanding';
import { householdLineGroups, type HouseholdLine } from '@/domain/households';

export function CardHouseholdLine({ lines, className = 'mt-2' }: { lines: HouseholdLine[] | null | undefined; className?: string }) {
    const { t } = useLanguage();
    const homes = householdLineGroups(lines);
    if (homes.length === 0) return null;
    return (
        <div
            className={`${className} flex items-start gap-2 text-xs text-stone-600 bg-stone-50 px-3 py-2 rounded-lg border border-stone-100`}
            data-testid="card-household-line"
            aria-label={t('adopter.hh_card_aria')}
        >
            <Home className="w-3.5 h-3.5 shrink-0 mt-0.5 text-teal-600" aria-hidden="true" />
            <div className="min-w-0 space-y-1.5">
                {homes.map((home, i) => (
                    <div key={home[0].householdId || i} className="min-w-0">
                        <div className="font-semibold text-stone-500">
                            {i === 0 ? t('adopter.hh_lives_with_title') : t('adopter.hh_other_home_title')}
                        </div>
                        {home.map(p => (
                            <div key={p.profileId} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0">
                                <span className="font-medium text-stone-800 break-words">{p.name}</span>
                                <PersonStanding rating={p.rating} openAlerts={p.openAlerts} isMinor={p.isMinor} minorTestId="card-household-minor" alertsTestId="card-household-alerts" />
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}
