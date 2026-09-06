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

export interface FollowupEmailItem {
    animalName: string | null;
    body: string;
    /** Deep link to that animal's «Para hacer ahora». */
    url: string;
}

/** A single email carries at most this many reminders; the rest are summarized. */
export const EMAIL_DIGEST_MAX_ITEMS = 25;

/**
 * v2.55.19 (single) / v2.55.21 (digest): opt-in email delivery.
 *
 * ONE template that adapts to the number of reminders — not two. Same shell
 * (header, type, CTA, footer) in both shapes: with a single item it renders
 * exactly what it always did (title + body + button to that animal); with
 * several it lists them, one line each with its own link, and the button
 * points at /my-animals — the triage board whose «N pendientes» badges are
 * the list version of the same information. Pure: unit-testable, no Worker APIs.
 */
export function buildFollowupEmail(items: FollowupEmailItem[], listUrl?: string): { subject: string; html: string; text: string } {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const shown = items.slice(0, EMAIL_DIGEST_MAX_ITEMS);
    const overflow = items.length - shown.length;
    const single = items.length === 1;

    const subject = single
        ? notificationTitle(items[0].animalName)
        : `${items.length} seguimientos pendientes`;
    const lead = single ? subject : `Tenés ${items.length} seguimientos pendientes:`;

    const bodyHtml = single
        ? `  <p style="margin:0 0 20px;">${esc(shown[0].body)}</p>\n`
        : shown.map(i =>
            `  <p style="margin:0 0 12px;"><a href="${i.url}" style="color:#0f766e;font-weight:700;text-decoration:none;">${esc(i.animalName || 'Animal')}</a> — ${esc(i.body)}</p>\n`
        ).join('') + (overflow > 0 ? `  <p style="margin:0 0 12px;color:#57534e;">…y ${overflow} más.</p>\n` : '');

    const ctaUrl = single ? shown[0].url : (listUrl || shown[0]?.url || '');
    const ctaLabel = single ? 'Ver en BuenAdoptante' : 'Ver mis animales';

    const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1c1917;">
  <h2 style="color:#134e4a;margin:0 0 16px;">BuenAdoptante</h2>
  <p style="margin:0 0 8px;font-weight:700;">${esc(lead)}</p>
${bodyHtml}  <p style="margin:0 0 20px;"><a href="${ctaUrl}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;border-radius:12px;padding:12px 24px;font-weight:700;">${ctaLabel}</a></p>
  <p style="margin:0;font-size:13px;color:#57534e;">Recibís este correo porque activaste los recordatorios por e-mail en Configuración → Seguimientos. Podés desactivarlos ahí cuando quieras.</p>
</div>`;

    const bodyText = single
        ? shown[0].body
        : shown.map(i => `- ${i.animalName || 'Animal'} — ${i.body}\n  ${i.url}`).join('\n')
            + (overflow > 0 ? `\n…y ${overflow} más.` : '');
    const text = `${lead}\n\n${bodyText}\n\n${ctaUrl}\n\nRecibís este correo porque activaste los recordatorios por e-mail en Configuración → Seguimientos.`;
    return { subject, html, text };
}
