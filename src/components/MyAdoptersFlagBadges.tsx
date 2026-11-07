'use client';

/**
 * A /my-adopters row's «Alertas» (warnings only — v39+: verified_identity /
 * verified_address are positive signals and live on the profile page): the
 * person's own period alerts, then the housemate chips (Jon, 2026-11-01), then
 * their flags, neutral, by name — never «Inexacto» (rescuerFlagKinds).
 *
 * The housemate chips («Conviviente con calificación 2.0», «Conviviente con
 * alertas») are the same AlertPill kinds every card uses, as REAL links to the
 * profile at «Familiares / Convivientes», where everyone is listed — never a
 * list here (the row gets only the two answers, never names). The row itself
 * is not a link (its one link is the name, stretched over it), so a chip is an
 * ordinary <a> beside it, never nested; AlertPill's 44px touch area is
 * positioned, so it paints above the stretched name link.
 */
import { AlertPill } from '@/components/AlertPill';
import { openFlagKinds, rescuerFlagKinds } from '@/domain/flags';
import { formatRating } from '@/domain/ratings';
import { HOUSEHOLD_SECTION_HREF, type HousemateAlertSummary } from '@/domain/profileHouseholds';
import type { AdopterFlags } from '@/types/adopter';

/** The profile at «Familiares / Convivientes», opened from /my-adopters. */
export const myAdoptersHouseholdHref = (adopterId: string) => `/adopter/${adopterId}?ref=my-adopters${HOUSEHOLD_SECTION_HREF}`;

/** Does the row draw a housemate chip? (Its rows space the chips' 44px touch areas apart: review fix 6.) */
export const hasHousemateChip = (a: HousemateAlertSummary | null | undefined): boolean => !!a && (a.lowRating != null || a.hasAlerts);

export function MyAdoptersFlagBadges({ flags, housemateAlert, adopterId, personName, t }: {
    flags: AdopterFlags;
    housemateAlert?: HousemateAlertSummary | null;
    adopterId: string;
    /** The ROW's person, for the chip's accessible name — never a housemate (the row has none to name). */
    personName: string;
    t: (key: string) => string;
}) {
    const badges = [];

    if (flags.tooManyAdoptions) {
        badges.push(
            <AlertPill key="too_many_adoptions" kind="too_many_adoptions">
                {t('alerts.too_many_adoptions').replace('{count}', String(flags.tooManyAdoptions.count)).replace('{days}', String(Math.max(1, Math.round(flags.tooManyAdoptions.actualSpanDays || flags.tooManyAdoptions.periodDays))))}
            </AlertPill>
        );
    }
    if (flags.tooManyRequests) {
        badges.push(
            <AlertPill key="too_many_requests" kind="too_many_requests">
                {t('alerts.too_many_requests').replace('{count}', String(flags.tooManyRequests.count)).replace('{days}', String(Math.max(1, Math.round(flags.tooManyRequests.actualSpanDays || flags.tooManyRequests.periodDays))))}
            </AlertPill>
        );
    }

    const href = myAdoptersHouseholdHref(adopterId);
    // «Conviviente con alertas — {person}»: the visible words first (label-in-name), then whose profile it opens.
    const named = (words: string) => t('alerts.housemate_chip_of').replace('{chip}', words).replace('{name}', personName);
    if (housemateAlert?.lowRating != null) {
        const words = t('alerts.housemate_low_rating').replace('{rating}', formatRating(housemateAlert.lowRating));
        badges.push(
            <AlertPill key="housemate_low_rating" kind="housemate_low_rating" wrap href={href} ariaLabel={named(words)} testId="my-adopters-housemate-alert-rating">
                {words}
            </AlertPill>
        );
    }
    if (housemateAlert?.hasAlerts) {
        badges.push(
            <AlertPill key="housemate_alerts" kind="housemate_alerts" wrap href={href} ariaLabel={named(t('alerts.housemate_alerts'))} testId="my-adopters-housemate-alert-alerts">
                {t('alerts.housemate_alerts')}
            </AlertPill>
        );
    }

    for (const kind of rescuerFlagKinds(openFlagKinds(flags))) {
        badges.push(<AlertPill key={kind} kind={kind}>{t(`flags.${kind}`)}</AlertPill>);
    }

    if (badges.length === 0) {
        return <span className="text-xs text-stone-300">—</span>;
    }

    // A chip's 44px touch area reaches 11px past its 22px pill: 12px between wrapped lines keeps it off the line above.
    return <div className={`flex flex-wrap gap-x-1 ${hasHousemateChip(housemateAlert) ? 'gap-y-3' : 'gap-y-1'} max-w-full min-w-0`}>{badges}</div>;
}
