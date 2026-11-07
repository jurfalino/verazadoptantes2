'use client';

/**
 * The housemate ALERTS of a card that shows ONE person (Jon, 2026-11-01 —
 * option B, plus «Conviviente con alertas»). They replace the old collapsed
 * household line («Vive con N personas …») on the search card, the match
 * card header (form / contract results, «Posibles coincidencias», the save
 * check, the import), «¿Es este perfil?» before adding a relative, and a
 * Pendientes side. Never on the dup-hint box or its window (Jon 2026-10-31).
 *
 * - «Conviviente con calificación {rating}»: someone in a non-gift home is
 *   1★/2★ — the lowest such rating, one decimal (housemateLowRating).
 * - «Conviviente con alertas»: someone there has one of their own period
 *   alerts (housemateHasAlerts). Flags never raise either chip.
 * Both answers come from the server (CardHousehold.alert), decided over EVERY
 * housemate, not just the ones the list has room for (review fix 2).
 * The two are independent: a home can show both. Each is the alert pill in
 * the warning tone with the home icon, in the card's own alert row, before
 * the flags.
 *
 * Tapping either chip opens the same list: everyone in the person's homes,
 * grouped per home («Convive con» / «En otro hogar, con»), each with their
 * own rating (or «Sin calificación») and their own alerts — never their
 * flags. Gift-only lines are left out. The chips are real disclosure buttons
 * (aria-expanded / aria-controls, keyboard, 44px to the touch) and wrap inside
 * a narrow row. Inside a card that is a link, a tap opens / closes the list,
 * never the profile (preventDefault + stopPropagation, as RatingExplainer does).
 */

import { useId, useState, type MouseEvent } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { RatingBadge } from '@/components/RatingBadge';
import { MinorTag } from '@/components/MinorTag';
import { AlertPill, PeriodAlertPills } from '@/components/AlertPill';
import { householdLineGroups, raisesHousemateAlert, type CardHousehold } from '@/domain/households';
import { formatRating } from '@/domain/ratings';

type Household = CardHousehold | null | undefined;

/**
 * Does this person carry a housemate alert at all (either chip)? From the
 * card's `alert` answers — every housemate, never only the listed ones
 * (review fix 2).
 */
export function hasHousemateAlert(household: Household): boolean {
    return raisesHousemateAlert(household?.alert);
}

/**
 * The open state of one person's housemate list, kept for THAT person
 * (`personId`, review M3): a refetch that brings the same person back with a
 * new array keeps an opened list open; another person's card never inherits it.
 */
export function useHousemateList(personId: string | null | undefined) {
    const [openFor, setOpenFor] = useState<string | null>(null);
    const listId = useId();
    const key = personId ?? null;
    return {
        open: key != null && openFor === key,
        toggle: () => setOpenFor(o => (o === key ? null : key)),
        listId,
    };
}

const stop = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); };

/** The chips (none, one or both), each toggling the shared list. */
export function HousemateAlertChips({ household, open, onToggle, listId, testId = 'housemate-alert' }: {
    household: Household;
    open: boolean;
    onToggle: () => void;
    listId: string;
    testId?: string;
}) {
    const { t } = useLanguage();
    const low = household?.alert.lowRating ?? null;
    const alerts = !!household?.alert.hasAlerts;
    if (low == null && !alerts) return null;
    const click = (e: MouseEvent<HTMLButtonElement>) => { stop(e); onToggle(); };
    const hint = <span className="sr-only"> · {open ? t('adopter.hh_card_close') : t('adopter.hh_card_open')}</span>;
    return (
        <>
            {low != null && (
                // A button with its 44px touch area (AlertPill's TAP_TARGET_44).
                <AlertPill kind="housemate_low_rating" wrap onClick={click} expanded={open} controls={listId} testId={`${testId}-rating`}>
                    {t('alerts.housemate_low_rating').replace('{rating}', formatRating(low))}{hint}
                </AlertPill>
            )}
            {alerts && (
                <AlertPill kind="housemate_alerts" wrap onClick={click} expanded={open} controls={listId} testId={`${testId}-alerts`}>
                    {t('alerts.housemate_alerts')}{hint}
                </AlertPill>
            )}
        </>
    );
}

/**
 * The opened list: everyone in the person's homes, per home, with their own
 * rating and alerts (never flags) — at most the card's MAX_HOUSEHOLD_LINES
 * people, then «y N más» for the rest (review fix 2).
 */
export function HousemateList({ household, id, className = '' }: { household: Household; id: string; className?: string }) {
    const { t } = useLanguage();
    const homes = householdLineGroups(household?.lines);
    const more = household?.more ?? 0;
    return (
        <div id={id} role="group" aria-label={t('adopter.hh_card_aria')}
            className={`rounded-lg border px-3 py-2 text-xs space-y-1.5 min-w-0 ${className}`}
            style={{ background: 'var(--status-warning-bg)', borderColor: 'var(--status-warning-border)' }}
            data-testid="card-household-list"
            // Inside a card that is a link: reading the list never opens the profile.
            onClick={stop}>
            {homes.map((home, i) => (
                <div key={home[0].householdId || i} className="min-w-0">
                    <div className="font-semibold" style={{ color: 'var(--text-secondary)' }}>
                        {i === 0 ? t('adopter.hh_lives_with_title') : t('adopter.hh_other_home_title')}
                    </div>
                    {home.map(p => (
                        <div key={p.profileId} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0 mt-0.5" data-testid="card-household-person">
                            <span className="font-medium break-words [overflow-wrap:anywhere]" style={{ color: 'var(--text-primary)' }}>{p.name}</span>
                            {p.isMinor && <MinorTag testId="card-household-minor" />}
                            <RatingBadge rating={p.rating} />
                            {/* Their ALERTS only — never their flags. */}
                            <PeriodAlertPills alerts={p.alerts} testId="card-household-alert" />
                        </div>
                    ))}
                </div>
            ))}
            {more > 0 && (
                <div style={{ color: 'var(--text-secondary)' }} data-testid="card-household-more">
                    {t('adopter.hh_card_more').replace('{count}', String(more))}
                </div>
            )}
        </div>
    );
}

/**
 * Chips and list together, for a `flex flex-wrap` alert row: the chips sit in
 * the row, the opened list takes a full line at the row's end (basis-full +
 * order-last), so the flags after the chips stay on the chips' line.
 * `personId` keeps the list open across a refetch of the same person (M3).
 */
export function HousemateAlert({ household, personId, testId }: { household: Household; personId: string | null | undefined; testId?: string }) {
    const { open, toggle, listId } = useHousemateList(personId);
    if (!hasHousemateAlert(household)) return null;
    return (
        <>
            <HousemateAlertChips household={household} open={open} onToggle={toggle} listId={listId} testId={testId} />
            {open && <HousemateList household={household} id={listId} className="basis-full order-last mt-1" />}
        </>
    );
}
