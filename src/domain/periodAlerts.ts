/**
 * The two ALERTS the app computes from a person's activity over a period —
 * «{count} adopciones en {days} días» (`tooManyAdoptions`) and «Pidió en
 * {count} rescates en {days} días» (`tooManyRequests`). ONE rule: the search
 * card's own alerts (enrichAdopters) and a housemate's on a card's household
 * line (householdLinesFor) both come from here, with the same adoption config
 * (getAdoptionConfig). Alerts are not FLAGS (Jon, 2026-11-07): an alert says
 * the person may not be trustworthy to adopt; a flag says something on the
 * profile may need doing («Inexacto», «Duplicado» — openFlagKinds in ./flags).
 *
 * Requests count RESCUES (./requestDensity): pass records with their
 * `rescueKey` set (withRescueKeys) or members of one organization count apart.
 * Pure.
 */
import type { AdoptionConfig, AdoptionRecord, PeriodAlert as PeriodAlertType, PeriodAlertFields } from '@/types/adopter';
import { RECORD_TYPES } from './constants';
import { computeMaxDensityPeriod } from '@/lib/adoptionFilters';
import { computeRequestRescueDensity } from './requestDensity';

export type PeriodAlerts = PeriodAlertFields;
export type PeriodAlert = PeriodAlertType;

export const NO_PERIOD_ALERTS: PeriodAlerts = { tooManyAdoptions: null, tooManyRequests: null };

/** The thresholds when none are set in Admin (app_config) — getAdoptionConfig's fallback, and a screen's before its config arrives. */
export const DEFAULT_ADOPTION_CONFIG: AdoptionConfig = { threshold: 5, periodDays: 90, requestsThreshold: 3, requestsPeriodDays: 30 };

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

/**
 * Can a person with this many adoption / request records have a period alert
 * at all? An alert needs `threshold` adoptions (or `requestsThreshold`
 * rescues, each with at least one request) inside one period, so fewer
 * records in total can never raise one. A cheap screen before reading a
 * person's records for periodAlerts — never a substitute for it: a «true»
 * here still has to be read.
 */
export function mayHavePeriodAlerts(counts: { adoptions: number; requests: number }, config: AdoptionConfig): boolean {
    return counts.adoptions >= config.threshold || counts.requests >= config.requestsThreshold;
}
