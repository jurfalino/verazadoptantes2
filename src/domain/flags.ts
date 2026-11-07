import { FLAG_REASONS } from './constants';
import { isOpenDuplicateFlag, type DuplicateFlagRow } from './dedupPair';
import type { ProfileFlags } from '@/types/adopter';

/**
 * An inaccuracy report, under either reason it has been stored with: today's
 * `inaccurate_information` and the legacy `inaccurate` (the profile header has
 * always counted both). The one test — the header, every list and the public API
 * (through buildFlags) use it.
 */
export function isInaccurateReason(reason: string | null | undefined): boolean {
    return reason === FLAG_REASONS.INACCURATE || reason === 'inaccurate';
}

/**
 * Build a profile's FLAGS from its flag rows (never its alerts: periodAlerts).
 *
 * Uses FLAG_REASONS constants to prevent string mismatches
 * (e.g., 'inaccurate' vs 'inaccurate_information' bug).
 *
 * `duplicate` is an OPEN duplicate question only (isOpenDuplicateFlag) — the
 * profile header's rule: a flag closed by a merge or a «mantener separados» is
 * history, so a search card or a list never shows «Duplicado» for it while the
 * profile itself doesn't (audit fix round 2, item 9). The public API's
 * `flags: ['duplicate']` follows the same rule (Jon, 2026-10-28).
 *
 * A result that also carries its period alerts spreads periodAlerts (or
 * NO_PERIOD_ALERTS) next to this.
 */
export function buildFlags(
    flagRows: readonly DuplicateFlagRow[],
    systemDuplicateCount: number
): ProfileFlags {
    return {
        inaccurate: flagRows.some(f => isInaccurateReason(f.reason)),
        duplicate: flagRows.some(f => isOpenDuplicateFlag(f)),
        systemDuplicate: systemDuplicateCount > 0,
        verified_identity: flagRows.some(f => f.reason === FLAG_REASONS.VERIFIED_IDENTITY),
        verified_address: flagRows.some(f => f.reason === FLAG_REASONS.VERIFIED_ADDRESS),
    };
}

/**
 * A kind of open FLAG on a person — something on the profile that may need
 * doing (Jon, 2026-11-07) — what the profile header draws a flag pill for.
 * Not an ALERT: alerts say the person may not be trustworthy to adopt
 * (periodAlerts, the housemate chips) and are never counted here.
 */
export type OpenFlagKind = 'inaccurate' | 'duplicate';

/**
 * The person's open flags — ONE rule everywhere (audit fix round 2, item 9),
 * the profile header's: one per KIND, in the header's order («Inexacto», then
 * «Duplicado»), never one per report (two inaccuracy reports are one flag).
 * Every surface that shows a person's flags — household rows, match cards,
 * «¿Es este perfil?», a card's household line, the applicants list — draws
 * this list, each kind as its own pill (FlagSummary). The public API's
 * `duplicate` flag is this list too, without `inaccurate` (lib/api/profiles.ts).
 *
 * The «N adopciones / pedidos en N días» warnings are not counted here: they
 * come from activity over a period, not from a flag, and are shown as their own
 * pills only where that period is computed (profile header, search card,
 * /my-adopters).
 */
export function openFlagKinds(flags: { inaccurate?: boolean | null; duplicate?: boolean | null } | null | undefined): OpenFlagKind[] {
    const kinds: OpenFlagKind[] = [];
    if (flags?.inaccurate) kinds.push('inaccurate');
    if (flags?.duplicate) kinds.push('duplicate');
    return kinds;
}

/** The same rule from a profile's flag rows (household lines, the profile header). */
export function openFlagKindsOfRows(flagRows: readonly DuplicateFlagRow[]): OpenFlagKind[] {
    return openFlagKinds(buildFlags(flagRows, 0));
}

/**
 * THE rule for which open FLAGS a rescuer-facing surface draws (Jon,
 * 2026-11-01) — the profile header, search cards, match cards and
 * «¿Es este perfil?» (FlagSummary / PersonStanding), household rows,
 * /my-adopters, an applicant's row and panel: every kind except «Inexacto»
 * (`inaccurate_information`, legacy `inaccurate`). "Only admins care about
 * that — in the admin UI": /admin keeps drawing it from its own rows, and the
 * data (openFlagKinds, the public API's `flags`) still carries it.
 *
 * A flag is not an alert (Jon, 2026-11-07): these are drawn as neutral flag
 * chips after the alerts, never counted as «N alertas».
 */
export function rescuerFlagKinds(kinds: readonly OpenFlagKind[]): OpenFlagKind[] {
    return kinds.filter(kind => kind !== 'inaccurate');
}
