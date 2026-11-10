/**
 * «Reportar inexactitud» tells everyone who can fix the profile (Jon 2026-10-31:
 * «should notify all people with edit access to the profile»): whoever added it,
 * every member of their organizations, and anyone else privileged on it who has
 * edited it (loadApprovers' editors) — `inaccuracy_reported`, opening the
 * profile. Once per person, never the reporter, and a teammate of the reporter
 * only if they chose «Otros rescatistas y mi equipo» (keepChangeRecipients,
 * Jon 2026-11-08). The admins are told by the
 * caller (notifyAdmins, opening /admin/data-requests), skipping whoever this
 * already told. An ownerless profile (an import) tells the admins only.
 *
 * A plain server module, NOT 'use server'. Throws on a DB error; the caller
 * (/api/data-request, after the response) logs it and the request stands.
 */
import { eq } from 'drizzle-orm';
import { adopters } from '@/db/schema';
import { getDb } from '@/lib/db';
import { normEmail, getOrgMemberEmailsFor } from '@/lib/orgMembership';
import { loadApprovers } from '@/lib/piiAccessRequest';
import { realOwner } from '@/domain/dedupPair';
import { notificationContent } from '@/domain/notificationTemplates';
import { logger } from '@/lib/logger';
import { keepChangeRecipients } from '@/lib/teamChangeAudience';

/** What the reporter wrote, as the notice quotes it: one line, at most NOTICE_DETAILS_MAX characters. */
export const NOTICE_DETAILS_MAX = 280;
export function noticeDetails(details: string | null | undefined): string | undefined {
    const one = (details ?? '').replace(/\s+/g, ' ').trim();
    if (!one) return undefined;
    return one.length > NOTICE_DETAILS_MAX ? `${one.slice(0, NOTICE_DETAILS_MAX - 1).trimEnd()}…` : one;
}

/** Owner + their team + privileged editors, normalized, once each, never the reporter. */
export function inaccuracyReportRecipients(groups: ReadonlyArray<ReadonlyArray<string | null | undefined>>, reporter: string): string[] {
    const self = normEmail(reporter);
    const seen = new Set<string>();
    for (const email of groups.flat()) {
        const key = email && email.includes('@') ? normEmail(email) : '';
        if (key && key !== self) seen.add(key);
    }
    return [...seen];
}

/**
 * Returns who was told (normalized), who was left out by their own «Avisame de
 * cambios hechos por:» choice (`skipped` — the reporter's teammates who chose
 * «Otros rescatistas»; the admins' copy skips them too, so that choice means no
 * notice at all) and the profile's name, for the admins' notice.
 */
export async function notifyInaccuracyReportEditors(input: { adopterId: string; reporter: string; details?: string | null }): Promise<{ told: string[]; skipped: string[]; adopterName: string | null }> {
    const { adopterId, reporter } = input;
    const details = noticeDetails(input.details);
    const db = await getDb();
    if (!db) throw new Error('No database');
    const row = await db.select({ name: adopters.name, addedBy: adopters.addedBy })
        .from(adopters).where(eq(adopters.id, adopterId)).get() as { name: string | null; addedBy: string | null } | undefined;
    const adopterName = row?.name?.trim() || null;
    const owner = realOwner(row?.addedBy);
    if (!owner) return { told: [], skipped: [], adopterName };
    const [team, { editors }] = await Promise.all([getOrgMemberEmailsFor(normEmail(owner)), loadApprovers(adopterId)]);
    const everyone = inaccuracyReportRecipients([[owner], team, editors], reporter);
    const recipients = await keepChangeRecipients(everyone, reporter, { op: 'notifyInaccuracyReportEditors', adopterId });
    const skipped = everyone.filter(e => !recipients.includes(e));
    if (recipients.length === 0) return { told: [], skipped, adopterName };
    const { createNotification, resolveDisplayName } = await import('@/app/actions/notifications');
    const reporterName = await resolveDisplayName(reporter);
    const content = notificationContent({
        key: 'inaccuracy_reported',
        params: { reporterName, ...(adopterName ? { adopterName } : {}), ...(details ? { details } : {}) },
    });
    const told: string[] = [];
    await Promise.all(recipients.map(async userId => {
        try {
            await createNotification({ userId, type: 'inaccuracy_reported', ...content, url: `/adopter/${adopterId}`, icon: '✏️', metadata: { adopterId } });
            told.push(userId);
        } catch (e) {
            logger.warn('notifyInaccuracyReportEditors: notice not sent', { adopterId, actor: reporter, error: e instanceof Error ? e.message : String(e) });
        }
    }));
    return { told, skipped, adopterName };
}
