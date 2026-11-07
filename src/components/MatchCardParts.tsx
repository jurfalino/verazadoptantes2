'use client';

/**
 * The one «¿Es esta persona?» match card (audit B6): form results, contract
 * results, «Nuevo adoptante → Posibles coincidencias», its «Coincidencia casi
 * exacta» strip and save dialog, and the post import's match list. `MatchCard`
 * is the structure — every surface renders it, only its container differs.
 * One order on every card:
 *
 *   (P) Pedro Paez ★ 4.0 · Bueno  [⌂ Conviviente con calificación 2.0] [Duplicado]  ← MatchCardHeader
 *       (tapping the housemate chip opens who they live with, under the row)
 *   «Qué coincide y qué no» (MatchCompare)          ← the caller's
 *   [Es la misma persona] [Ver perfil completo →] [No es esta persona]   ← MatchCardActions
 *   (a new tab: «Abrir perfil ↗» — OpenProfileLink — in place of «Ver perfil completo →»)
 *
 * The header is the household row's (their photo, else the teal initial; the name as a link with a 44px hit area,
 * PersonStanding: the matched person's own rating and alerts, or «Menor de
 * edad»); long names and emails wrap inside the card (`min-w-0`,
 * `overflow-wrap:anywhere`). The actions are the matrix's compact buttons
 * (≥44px) with the same three labels wherever the step is the same.
 */
import Link from 'next/link';
import type { OpenFlagKind } from '@/domain/flags';
import type { ReactNode } from 'react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { PersonStanding } from '@/components/PersonStanding';
import { HousemateAlert } from '@/components/HousemateAlert';
import { OpenProfileLink } from '@/components/OpenProfileLink';
import { Button, buttonClasses } from '@/components/ui/Button';
import type { CardHousehold } from '@/domain/households';

export type MatchCardPerson = {
    id: string;
    name: string;
    /** The person's own average rating; null/undefined: «Sin calificación». */
    rating?: number | null;
    openFlags?: OpenFlagKind[];
    isMinor?: boolean;
    households?: CardHousehold;
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
                    {/* The housemate alerts sit in the person's own alert row, before the flags (Jon 2026-11-01). */}
                    {showStanding
                        ? <PersonStanding rating={person.rating ?? null} openFlags={person.openFlags ?? []} isMinor={!!person.isMinor} minorTestId={`${testId}-minor`} flagsTestId={`${testId}-flags`}
                            alerts={<HousemateAlert household={person.households} personId={person.id} testId={`${testId}-housemate-alert`} />} />
                        : <HousemateAlert household={person.households} personId={person.id} testId={`${testId}-housemate-alert`} />}
                </div>
            </div>
        </div>
    );
}

/**
 * «Sí, es la misma persona» (primary, optional), the profile link and «No, es otra
 * persona» (secondary, optional) — the same two answers on every screen (step 3:
 * one way to ask). What a «Sí» does is said by the caller's confirmation.
 */
export type MatchCardActionsProps = {
    profileId: string;
    onSame?: () => void;
    onNotThis?: () => void;
    busy?: boolean;
    newTab?: boolean;
    sameTestId?: string;
    viewTestId?: string;
    notThisTestId?: string;
};

export function MatchCardActions({ profileId, onSame, onNotThis, busy = false, newTab = false, sameTestId, viewTestId, notThisTestId }: MatchCardActionsProps) {
    const { t } = useLanguage();
    const layout = 'w-full sm:w-auto';
    return (
        <div className="flex flex-wrap items-center gap-2">
            {onSame && (
                <Button type="button" size="compact" onClick={onSame} disabled={busy} data-testid={sameTestId} layoutClassName={layout}
                    icon={<CheckCircle2 className="w-4 h-4" aria-hidden="true" />}>
                    {t('samePerson.yes')}
                </Button>
            )}
            {newTab
                // A new tab: «Abrir perfil ↗», the same link on every surface (point B, Jon 2026-11-01).
                ? <OpenProfileLink href={`/adopter/${encodeURIComponent(profileId)}`} testId={viewTestId} className={`justify-center ${layout}`} />
                : <Link href={`/adopter/${encodeURIComponent(profileId)}`}
                    data-testid={viewTestId} className={`${buttonClasses({ variant: 'secondary', size: 'compact' })} ${layout}`}>
                    {t('formResults.view_full_profile')}
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </Link>}
            {onNotThis && (
                <Button type="button" variant="secondary" size="compact" onClick={onNotThis} disabled={busy} data-testid={notThisTestId} layoutClassName={`${layout} sm:ml-auto`}>
                    {t('samePerson.no')}
                </Button>
            )}
        </div>
    );
}

/**
 * The whole card's structure, the same on every surface (audit B6): header
 * (name + standing, housemate alerts) → «Qué coincide y qué no» → the actions. Compare and actions span the card's
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
