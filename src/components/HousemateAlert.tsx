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
import { householdLineGroups, housemateHasAlerts, housemateLowRating, type HouseholdLine, type HousemateAlertLine } from '@/domain/households';
import { formatRating } from '@/domain/ratings';

type Lines = HouseholdLine[] | null | undefined;

/** Does this person carry a housemate alert at all (either chip)? */
export function hasHousemateAlert(lines: ReadonlyArray<HousemateAlertLine> | null | undefined): boolean {
    return housemateLowRating(lines) != null || housemateHasAlerts(lines);
}

/**
 * The open state of one person's housemate list. Open for THESE lines only: a
 * new search keeps the card (keyed by adopter id) but brings a new array, so
 * the list comes back closed — with no open frame, unlike a reset in an effect.
 */
export function useHousemateList(lines: Lines) {
    const [openFor, setOpenFor] = useState<Lines>(null);
    const listId = useId();
    return {
        open: openFor != null && openFor === lines,
        toggle: () => setOpenFor(o => (o === lines ? null : lines)),
        listId,
    };
}

const stop = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); };

/** The chips (none, one or both), each toggling the shared list. */
export function HousemateAlertChips({ lines, open, onToggle, listId, testId = 'housemate-alert' }: {
    lines: Lines;
    open: boolean;
    onToggle: () => void;
    listId: string;
    testId?: string;
}) {
    const { t } = useLanguage();
    const low = housemateLowRating(lines);
    const alerts = housemateHasAlerts(lines);
    if (low == null && !alerts) return null;
    const click = (e: MouseEvent<HTMLButtonElement>) => { stop(e); onToggle(); };
    const hint = <span className="sr-only"> · {open ? t('adopter.hh_card_close') : t('adopter.hh_card_open')}</span>;
    return (
        <>
            {low != null && (
                // A button with its 44px touch area (AlertPill's TAP_TARGET_44).
                <AlertPill kind="housemate_low_rating" wrap onClick={click} expanded={open} controls={listId} testId={`${testId}-rating`}>
                    {t('flags.housemate_low_rating').replace('{rating}', formatRating(low))}{hint}
                </AlertPill>
            )}
            {alerts && (
                <AlertPill kind="housemate_alerts" wrap onClick={click} expanded={open} controls={listId} testId={`${testId}-alerts`}>
                    {t('flags.housemate_alerts')}{hint}
                </AlertPill>
            )}
        </>
    );
}

/** The opened list: everyone in the person's homes, per home, with their own rating and alerts (never flags). */
export function HousemateList({ lines, id, className = '' }: { lines: Lines; id: string; className?: string }) {
    const { t } = useLanguage();
    const homes = householdLineGroups(lines);
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
        </div>
    );
}

/**
 * Chips and list together, for a `flex flex-wrap` alert row: the chips sit in
 * the row, the opened list takes a full line at the row's end (basis-full +
 * order-last), so the flags after the chips stay on the chips' line.
 */
export function HousemateAlert({ lines, testId }: { lines: Lines; testId?: string }) {
    const { open, toggle, listId } = useHousemateList(lines);
    if (!hasHousemateAlert(lines)) return null;
    return (
        <>
            <HousemateAlertChips lines={lines} open={open} onToggle={toggle} listId={listId} testId={testId} />
            {open && <HousemateList lines={lines} id={listId} className="basis-full order-last mt-1" />}
        </>
    );
}
