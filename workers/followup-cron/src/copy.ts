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

/**
 * v2.55.19: opt-in email delivery. Spanish, mirroring the bell copy, with a
 * button to the animal's «Para hacer ahora». Kept here (pure module) so the
 * builder is unit-testable without Worker APIs.
 */
export function buildFollowupEmail(animalName: string | null, body: string, url: string): { subject: string; html: string; text: string } {
    const subject = notificationTitle(animalName);
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1c1917;">
  <h2 style="color:#134e4a;margin:0 0 16px;">BuenAdoptante</h2>
  <p style="margin:0 0 8px;font-weight:700;">${esc(subject)}</p>
  <p style="margin:0 0 20px;">${esc(body)}</p>
  <p style="margin:0 0 20px;"><a href="${url}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;border-radius:12px;padding:12px 24px;font-weight:700;">Ver en BuenAdoptante</a></p>
  <p style="margin:0;font-size:13px;color:#57534e;">Recibís este correo porque activaste los recordatorios por e-mail en Configuración → Seguimientos. Podés desactivarlos ahí cuando quieras.</p>
</div>`;
    const text = `${subject}\n\n${body}\n\n${url}\n\nRecibís este correo porque activaste los recordatorios por e-mail en Configuración → Seguimientos.`;
    return { subject, html, text };
}
