/**
 * «Reportar inexactitud» tells everyone who can fix the profile (Jon 2026-10-31:
 * «should notify all people with edit access to the profile»): whoever added it,
 * every member of their organizations, and anyone else privileged on it who has
 * edited it (loadApprovers' editors) — `inaccuracy_reported`, opening the
 * profile. Once per person, never the reporter. The admins are told by the
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

/** Returns who was told (normalized) and the profile's name, for the admins' notice. */
export async function notifyInaccuracyReportEditors(input: { adopterId: string; reporter: string }): Promise<{ told: string[]; adopterName: string | null }> {
    const { adopterId, reporter } = input;
    const db = await getDb();
    if (!db) throw new Error('No database');
    const row = await db.select({ name: adopters.name, addedBy: adopters.addedBy })
        .from(adopters).where(eq(adopters.id, adopterId)).get() as { name: string | null; addedBy: string | null } | undefined;
    const adopterName = row?.name?.trim() || null;
    const owner = realOwner(row?.addedBy);
    if (!owner) return { told: [], adopterName };
    const [team, { editors }] = await Promise.all([getOrgMemberEmailsFor(owner), loadApprovers(adopterId)]);
    const recipients = inaccuracyReportRecipients([[owner], team, editors], reporter);
    if (recipients.length === 0) return { told: [], adopterName };
    const { createNotification, resolveDisplayName } = await import('@/app/actions/notifications');
    const reporterName = await resolveDisplayName(reporter);
    const content = notificationContent({
        key: 'inaccuracy_reported',
        params: { reporterName, ...(adopterName ? { adopterName } : {}) },
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
    return { told, adopterName };
}
