/**
 * A duplicate flag tells the owners (Jon 2026-10-29): every DUPLICATE flag with
 * a target — the «Ya está en otro perfil» window (flagAdopterAsDuplicate) and
 * the profile menu «Reportar → Duplicado» alike, both through flagAdopter —
 * tells each real owner of either profile AND their org members
 * (`duplicate_flagged`, the same recipient rule as a merge request:
 * getOrgMemberEmailsFor), once per person, never the flagger. «Revisar» opens
 * their «Pendientes de revisar» at the pair.
 *
 * Returns who was told (normalized emails), so the admins' `adopter_flagged`
 * skips them: an owner who is also an admin gets one notice — this one.
 * A plain server module, NOT 'use server'. Throws on a DB error; the caller
 * (flagAdopter, after the response) logs it and the flag stands.
 */
import { eq } from 'drizzle-orm';
import { adopters } from '@/db/schema';
import { getDb } from '@/lib/db';
import { getOrgMemberEmailsFor, normEmail } from '@/lib/orgMembership';
import { realOwner, pairKey } from '@/domain/dedupPair';
import { notificationContent } from '@/domain/notificationTemplates';
import { logger } from '@/lib/logger';

/** Each real owner's team (owner included), normalized, once each, never the flagger. */
export function duplicateFlagRecipients(teams: ReadonlyArray<readonly string[]>, flaggedBy: string): string[] {
    const flagger = normEmail(flaggedBy);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const team of teams) {
        for (const email of team) {
            const key = normEmail(email);
            if (!key || key === flagger || seen.has(key)) continue;
            seen.add(key);
            out.push(key);
        }
    }
    return out;
}

export async function notifyDuplicateFlagOwners(input: { adopterId: string; targetAdopterId: string; flaggedBy: string }): Promise<string[]> {
    const { adopterId, targetAdopterId, flaggedBy } = input;
    const db = await getDb();
    if (!db) throw new Error('No database');
    const read = (id: string) => db.select({ name: adopters.name, addedBy: adopters.addedBy }).from(adopters).where(eq(adopters.id, id)).get() as Promise<{ name: string | null; addedBy: string | null } | undefined>;
    const [a, b] = await Promise.all([read(adopterId), read(targetAdopterId)]);
    const owners = [...new Set([realOwner(a?.addedBy), realOwner(b?.addedBy)].filter((e): e is string => !!e).map(normEmail))];
    if (owners.length === 0) return [];
    const teams = await Promise.all(owners.map(o => getOrgMemberEmailsFor(o)));
    const recipients = duplicateFlagRecipients(teams.map((team, i) => [owners[i], ...team]), flaggedBy);
    if (recipients.length === 0) return [];
    const { createNotification, resolveDisplayName } = await import('@/app/actions/notifications');
    const reporterName = await resolveDisplayName(flaggedBy);
    const content = notificationContent({
        key: 'duplicate_flagged',
        params: { reporterName, ...(a?.name?.trim() ? { nameA: a.name.trim() } : {}), ...(b?.name?.trim() ? { nameB: b.name.trim() } : {}) },
    });
    const url = `/my-adopters?pair=${encodeURIComponent(pairKey(adopterId, targetAdopterId))}#pendientes`;
    const told: string[] = [];
    await Promise.all(recipients.map(async userId => {
        try {
            await createNotification({ userId, type: 'duplicate_flagged', ...content, url, icon: '🔗', metadata: { adopterId, targetAdopterId } });
            told.push(userId);
        } catch (e) {
            logger.warn('notifyDuplicateFlagOwners: notice not sent', { adopterId, targetAdopterId, actor: flaggedBy, error: e instanceof Error ? e.message : String(e) });
        }
    }));
    return told;
}
