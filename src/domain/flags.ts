import { FLAG_REASONS } from './constants';
import { isOpenDuplicateFlag, type DuplicateFlagRow } from './dedupPair';
import type { AdopterFlags } from '@/types/adopter';

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
 * Build AdopterFlags from a profile's flag rows.
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
 * Note: tooManyAdoptions/tooManyRequests are left null — callers
 * fill these from period-based threshold logic after calling this function.
 */
export function buildFlags(
    flagRows: readonly DuplicateFlagRow[],
    systemDuplicateCount: number
): AdopterFlags {
    return {
        inaccurate: flagRows.some(f => isInaccurateReason(f.reason)),
        duplicate: flagRows.some(f => isOpenDuplicateFlag(f)),
        systemDuplicate: systemDuplicateCount > 0,
        verified_identity: flagRows.some(f => f.reason === FLAG_REASONS.VERIFIED_IDENTITY),
        verified_address: flagRows.some(f => f.reason === FLAG_REASONS.VERIFIED_ADDRESS),
        tooManyAdoptions: null,
        tooManyRequests: null,
    };
}

/** A kind of open alert on a person: what the profile header draws a flag pill for. */
export type OpenAlertKind = 'inaccurate' | 'duplicate';

/**
 * The person's open alerts — ONE rule everywhere (audit fix round 2, item 9),
 * the profile header's: one per KIND, in the header's order («Inexacto», then
 * «Duplicado»), never one per report (two inaccuracy reports are one alert).
 * Every count of a person's alerts — household rows, match cards, «¿Es este
 * perfil?», a card's household line, the applicants list — is the length of
 * this list; a single kind is drawn as that kind's own pill (AlertSummary).
 * The public API's `inaccurate` / `duplicate` flags are this list too
 * (lib/api/profiles.ts).
 *
 * The «N adopciones / pedidos en N días» warnings are not counted here: they
 * come from activity over a period, not from a flag, and are shown as their own
 * pills only where that period is computed (profile header, search card,
 * /my-adopters).
 */
export function openAlertKinds(flags: { inaccurate?: boolean | null; duplicate?: boolean | null } | null | undefined): OpenAlertKind[] {
    const kinds: OpenAlertKind[] = [];
    if (flags?.inaccurate) kinds.push('inaccurate');
    if (flags?.duplicate) kinds.push('duplicate');
    return kinds;
}

/** The same rule from a profile's flag rows (household lines, the profile header). */
export function openAlertKindsOfRows(flagRows: readonly DuplicateFlagRow[]): OpenAlertKind[] {
    return openAlertKinds(buildFlags(flagRows, 0));
}
