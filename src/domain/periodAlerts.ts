/**
 * The two ALERTS the app computes from a person's activity over a period —
 * «{count} adopciones en {days} días» (`tooManyAdoptions`) and «Pidió en
 * {count} rescates en {days} días» (`tooManyRequests`). ONE rule: the search
 * card's own alerts (enrichAdopters) and a housemate's on a card's household
 * line (householdLinesFor) both come from here, with the same adoption config
 * (getAdoptionConfig). Alerts are not FLAGS: flags are what rescuers report
 * («Inexacto», «Duplicado» — openAlertKinds in ./flags).
 *
 * Requests count RESCUES (./requestDensity): pass records with their
 * `rescueKey` set (withRescueKeys) or members of one organization count apart.
 * Pure.
 */
import type { AdopterFlags, AdoptionConfig, AdoptionRecord } from '@/types/adopter';
import { RECORD_TYPES } from './constants';
import { computeMaxDensityPeriod } from '@/lib/adoptionFilters';
import { computeRequestRescueDensity } from './requestDensity';

export type PeriodAlerts = Pick<AdopterFlags, 'tooManyAdoptions' | 'tooManyRequests'>;
export type PeriodAlert = NonNullable<AdopterFlags['tooManyAdoptions']>;

export const NO_PERIOD_ALERTS: PeriodAlerts = { tooManyAdoptions: null, tooManyRequests: null };

type PeriodRecord = { recordType?: string | null; date?: Date | number | string | null; addedBy?: string | null; rescueKey?: string | null };

export function periodAlerts(records: readonly PeriodRecord[], config: AdoptionConfig): PeriodAlerts {
    const out: PeriodAlerts = { tooManyAdoptions: null, tooManyRequests: null };
    const adoptionsDensity = computeMaxDensityPeriod(records as unknown as AdoptionRecord[], RECORD_TYPES.ADOPTION, config.periodDays);
    if (adoptionsDensity.count >= config.threshold) {
        out.tooManyAdoptions = {
            count: adoptionsDensity.count, threshold: config.threshold, periodDays: config.periodDays,
            actualSpanDays: adoptionsDensity.timeSpanDays, startDate: adoptionsDensity.startDate, endDate: adoptionsDensity.endDate,
        };
    }
    const requestsDensity = computeRequestRescueDensity([...records], config.requestsPeriodDays);
    if (requestsDensity.count >= config.requestsThreshold) {
        out.tooManyRequests = {
            count: requestsDensity.count, threshold: config.requestsThreshold, periodDays: config.requestsPeriodDays,
            actualSpanDays: requestsDensity.timeSpanDays, startDate: requestsDensity.startDate, endDate: requestsDensity.endDate,
        };
    }
    return out;
}

/** The days an alert reads as («… en {days} días»): its actual span, at least 1 — one formula for every pill. */
export function periodAlertDays(alert: Pick<PeriodAlert, 'actualSpanDays' | 'periodDays'>): number {
    return Math.max(1, Math.round(alert.actualSpanDays || alert.periodDays));
}
