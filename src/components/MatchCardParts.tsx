'use client';

/**
 * The parts every «¿Es esta persona?» match card shares (audit B6): form
 * results, contract results and «Nuevo adoptante → Posibles coincidencias».
 * One order on every card:
 *
 *   (P) Pedro Paez ★ 4.0 · Bueno  [1 alerta]        ← MatchCardHeader
 *       Convive con …                               ← its household line
 *   «Qué coincide y qué no» (MatchCompare)          ← the caller's
 *   [Es la misma persona] [Ver perfil completo →] [No es esta persona]   ← MatchCardActions
 *
 * The header is the household row's (teal initial, the name as a link,
 * PersonStanding: the matched person's own rating and alerts, or «Menor de
 * edad»); long names and emails wrap inside the card (`min-w-0`,
 * `overflow-wrap:anywhere`). The actions are the matrix's compact buttons
 * (≥44px) with the same three labels wherever the step is the same.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { PersonStanding } from '@/components/PersonStanding';
import { CardHouseholdLine } from '@/components/CardHouseholdLine';
import { Button, buttonClasses } from '@/components/ui/Button';
import type { HouseholdLine } from '@/domain/households';

export type MatchCardPerson = {
    id: string;
    name: string;
    /** The person's own average rating; null/undefined: «Sin calificación». */
    rating?: number | null;
    openAlerts?: number;
    isMinor?: boolean;
    households?: HouseholdLine[];
};

export function MatchCardHeader({ person, newTab = false, testId = 'match-card-head', nameNode, thumbnail }: {
    person: MatchCardPerson; newTab?: boolean; testId?: string;
    /** The name as the caller renders it (e.g. with the typed words highlighted). */
    nameNode?: ReactNode;
    /** Their photo, in the initial's place. */
    thumbnail?: string | null;
}) {
    const { t } = useLanguage();
    const name = person.name?.trim() || t('adopter.nameless');
    return (
        <div data-testid={testId}>
            <div className="flex items-start gap-2">
                {thumbnail
                    ? <img src={thumbnail} alt="" className="mt-0.5 w-8 h-8 rounded-full object-cover shrink-0" />
                    : <span className="mt-0.5 w-8 h-8 rounded-full bg-teal-600 text-white font-bold text-xs flex items-center justify-center shrink-0" aria-hidden="true">
                        {(name[0] || '?').toUpperCase()}
                    </span>}
                <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm py-1">
                    <a href={`/adopter/${encodeURIComponent(person.id)}`} {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                        className="min-w-0 font-semibold text-[15px] text-teal-700 hover:underline [overflow-wrap:anywhere]" data-testid={`${testId}-name`}>
                        {nameNode ?? name}
                    </a>
                    <PersonStanding rating={person.rating ?? null} openAlerts={person.openAlerts ?? 0} isMinor={!!person.isMinor} alertsTestId={`${testId}-alerts`} />
                </div>
            </div>
            <CardHouseholdLine lines={person.households} className="mt-1 pl-10" />
        </div>
    );
}

/**
 * «Es la misma persona» (primary, optional), «Ver perfil completo →» (secondary
 * link) and «No es esta persona» (secondary, optional) — or a caller's own
 * primary label for the same slot (e.g. «Continuar con este perfil»).
 */
export function MatchCardActions({ profileId, onSame, sameLabel, onNotThis, busy = false, newTab = false, sameTestId, viewTestId }: {
    profileId: string;
    onSame?: () => void;
    sameLabel?: string;
    onNotThis?: () => void;
    busy?: boolean;
    newTab?: boolean;
    sameTestId?: string;
    viewTestId?: string;
}) {
    const { t } = useLanguage();
    const layout = 'w-full sm:w-auto';
    return (
        <div className="flex flex-wrap items-center gap-2">
            {onSame && (
                <Button type="button" size="compact" onClick={onSame} disabled={busy} data-testid={sameTestId} layoutClassName={layout}
                    icon={<CheckCircle2 className="w-4 h-4" aria-hidden="true" />}>
                    {sameLabel || t('formResults.same_person')}
                </Button>
            )}
            <Link href={`/adopter/${encodeURIComponent(profileId)}`} {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                data-testid={viewTestId} className={`${buttonClasses({ variant: 'secondary', size: 'compact' })} ${layout}`}>
                {t('formResults.view_full_profile')}
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
            {onNotThis && (
                <Button type="button" variant="secondary" size="compact" onClick={onNotThis} disabled={busy} layoutClassName={`${layout} sm:ml-auto`}>
                    {t('formResults.not_this_person')}
                </Button>
            )}
        </div>
    );
}
