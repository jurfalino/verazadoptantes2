'use client';

/**
 * The one «¿Es esta persona?» match card (audit B6): form results, contract
 * results, «Nuevo adoptante → Posibles coincidencias», its «Coincidencia casi
 * exacta» strip and save dialog, and the post import's match list. `MatchCard`
 * is the structure — every surface renders it, only its container differs.
 * One order on every card:
 *
 *   (P) Pedro Paez ★ 4.0 · Bueno  [1 alerta]        ← MatchCardHeader
 *       Convive con …                               ← its household line
 *   «Qué coincide y qué no» (MatchCompare)          ← the caller's
 *   [Es la misma persona] [Ver perfil completo →] [No es esta persona]   ← MatchCardActions
 *
 * The header is the household row's (their photo, else the teal initial; the name as a link with a 44px hit area,
 * PersonStanding: the matched person's own rating and alerts, or «Menor de
 * edad»); long names and emails wrap inside the card (`min-w-0`,
 * `overflow-wrap:anywhere`). The actions are the matrix's compact buttons
 * (≥44px) with the same three labels wherever the step is the same.
 */
import Link from 'next/link';
import type { OpenAlertKind } from '@/domain/flags';
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
    openAlerts?: OpenAlertKind[];
    isMinor?: boolean;
    households?: HouseholdLine[];
};

export function MatchCardHeader({ person, newTab = false, testId = 'match-card-head', nameNode, thumbnail, showStanding = true }: {
    person: MatchCardPerson; newTab?: boolean; testId?: string;
    /** False when their standing could not be read: say nothing rather than «Sin calificación». */
    showStanding?: boolean;
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
                        // The household row's name link: a 44px hit area around the text (audit B9).
                        className="relative min-w-0 font-semibold text-[15px] text-teal-700 hover:underline [overflow-wrap:anywhere] after:absolute after:-inset-y-3 after:inset-x-0 after:content-['']" data-testid={`${testId}-name`}>
                        {nameNode ?? name}
                    </a>
                    {showStanding && <PersonStanding rating={person.rating ?? null} openAlerts={person.openAlerts ?? []} isMinor={!!person.isMinor} minorTestId={`${testId}-minor`} alertsTestId={`${testId}-alerts`} />}
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
export type MatchCardActionsProps = {
    profileId: string;
    onSame?: () => void;
    sameLabel?: string;
    onNotThis?: () => void;
    busy?: boolean;
    newTab?: boolean;
    sameTestId?: string;
    viewTestId?: string;
    notThisTestId?: string;
};

export function MatchCardActions({ profileId, onSame, sameLabel, onNotThis, busy = false, newTab = false, sameTestId, viewTestId, notThisTestId }: MatchCardActionsProps) {
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
                <Button type="button" variant="secondary" size="compact" onClick={onNotThis} disabled={busy} data-testid={notThisTestId} layoutClassName={`${layout} sm:ml-auto`}>
                    {t('formResults.not_this_person')}
                </Button>
            )}
        </div>
    );
}

/**
 * The whole card's structure, the same on every surface (audit B6): header
 * (name + standing, household line) → «Qué coincide y qué no» → the actions. Compare and actions span the card's
 * full width (no indent) everywhere. `leading` sits before the header (the
 * post import's selection mark).
 */
export function MatchCard({ person, nameNode, thumbnail, newTab = false, headTestId, showStanding = true, leading, compare, actions, testId, className = '' }: {
    person: MatchCardPerson;
    nameNode?: ReactNode;
    thumbnail?: string | null;
    newTab?: boolean;
    headTestId?: string;
    showStanding?: boolean;
    leading?: ReactNode;
    compare: ReactNode;
    actions: Omit<MatchCardActionsProps, 'profileId' | 'newTab'>;
    testId?: string;
    className?: string;
}) {
    const header = <MatchCardHeader person={person} nameNode={nameNode} thumbnail={thumbnail} newTab={newTab} testId={headTestId} showStanding={showStanding} />;
    return (
        <div className={`min-w-0 space-y-3 ${className}`} data-testid={testId}>
            {leading ? <div className="flex items-start gap-2">{leading}<div className="min-w-0 flex-1">{header}</div></div> : header}
            {compare}
            <MatchCardActions profileId={person.id} newTab={newTab} {...actions} />
        </div>
    );
}
