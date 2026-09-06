/**
 * Notification copy for the follow-up cron (v2.55.17, animal-timeline PR4).
 * Spanish only — notifications created by the app are Spanish literals too
 * (see createNotification callers). Pure module: unit-testable, no Worker APIs.
 */

import type { ProjectedFollowup } from '../../../src/domain/followups';

/** Stable per-(placement, slot, recipient) dedup key stored in
 *  notifications.metadata — v2.55.18 notifies the WHOLE team, each member
 *  deduped independently. */
export function dedupKey(placementId: string, slotKey: string, recipientEmail: string): string {
    return `followup:${placementId}:${slotKey}:${recipientEmail.toLowerCase()}`;
}

export function slotLabel(slot: Pick<ProjectedFollowup, 'copyKey' | 'offsetDays'>): string {
    switch (slot.copyKey) {
        case 'checkin_7d': return 'Control de la primera semana';
        case 'checkin_30d': return 'Control del primer mes';
        case 'checkin_180d': return 'Control de los 6 meses';
        case 'health_vaccines': return 'Plan de vacunas';
        case 'health_neuter': return 'Castración';
        case 'foster_checkin': return `Control de tránsito (día ${slot.offsetDays ?? ''})`;
        case 'checkin_custom': return `Control del día ${slot.offsetDays ?? ''}`;
        default: return 'Seguimiento';
    }
}

export function notificationTitle(animalName: string | null): string {
    return `Seguimiento pendiente: ${animalName || 'un animal'}`;
}

export function notificationBody(slot: Pick<ProjectedFollowup, 'copyKey' | 'offsetDays'>, adopterName: string | null, isFoster: boolean): string {
    const label = slotLabel(slot);
    const who = adopterName ? ` con ${adopterName}` : '';
    return isFoster
        ? `${label}${who} (hogar de tránsito). Tocá para verlo en la ficha del animal.`
        : `${label}${who}. Tocá para verlo en la ficha del animal.`;
}
