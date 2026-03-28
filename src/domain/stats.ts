import { EVENT_TYPES, RECORD_TYPES } from './constants';

/**
 * Compute flat stats totals from event rows and adoption records.
 * 
 * Replaces 3 independent implementations that all did the same
 * event type → counter mapping.
 */
export function computeStats(
    eventRows: { eventType: string | null }[],
    adoptionRecords: { recordType: string | null }[]
): { searchHits: number; profileViews: number; requests: number; adoptions: number } {
    const stats = { searchHits: 0, profileViews: 0, requests: 0, adoptions: 0 };

    for (const s of eventRows) {
        if (s.eventType === EVENT_TYPES.SEARCH_HIT) stats.searchHits++;
        else if (s.eventType === EVENT_TYPES.PROFILE_VIEW) stats.profileViews++;
    }

    for (const a of adoptionRecords) {
        if (a.recordType === RECORD_TYPES.ADOPTION) stats.adoptions++;
        else if (a.recordType === RECORD_TYPES.REQUEST) stats.requests++;
    }

    return stats;
}
