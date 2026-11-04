/**
 * Side effects of an open contribution — someone with no special standing on a
 * profile adds data to it (collaborative-vetting model: contributing is open,
 * exposing PII is what gating restricts). Shared by `addContactEntry` (the
 * titular's contacts) and the household actions (D54: a member, or a contact
 * on a member). NOT a 'use server' module: these must never be browser-callable
 * endpoints (`insertContributionGrant` would let anyone grant themselves any
 * entry).
 *
 * - `insertContributionGrant`: an entry-scope pii_access_grant on the value the
 *   contributor typed, so they see it unmasked even under PII gating.
 * - `notifyApprovers`: the owner + editors hear about it (never the actor).
 * - `fileContributionAccessRequest`: the auto access request filed on the
 *   contributor's behalf (justification 'auto:contribution').
 *
 * Callers run the last two through `runAfterResponse` (Workers kill bare
 * fire-and-forget work).
 */
import { and, eq, isNull } from 'drizzle-orm';
import { piiAccessGrants } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { hashEntryValue } from '@/lib/piiAccess';
import type { ContactEntry } from '@/lib/contactEntries';
import { fileAccessRequestFor } from '@/lib/piiAccessRequest';
import { notificationContent, type NotificationTemplate } from '@/domain/notificationTemplates';
import { createNotification, resolveDisplayName } from '@/app/actions/notifications';
import { getAdopterApprovers } from '@/app/actions/piiAccess';
import type { NotificationType } from '@/domain/constants';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/**
 * Grant the contributor entry-scope visibility on the value they typed — same
 * model as origin='search_match'. Idempotent: returns false (and inserts
 * nothing) when a live grant for this (grantee, adopter, ref) already exists.
 */
export async function insertContributionGrant(
    db: Db,
    adopterId: string,
    actor: string,
    entry: Pick<ContactEntry, 'type' | 'value'>,
): Promise<boolean> {
    const ref = hashEntryValue(entry.type, entry.value);
    const existing = await db.select({ id: piiAccessGrants.id }).from(piiAccessGrants)
        .where(and(
            eq(piiAccessGrants.adopterId, adopterId),
            eq(piiAccessGrants.granteeEmail, actor),
            eq(piiAccessGrants.entryRef, ref),
            isNull(piiAccessGrants.revokedAt),
        )).get();
    if (existing) return false;
    await db.insert(piiAccessGrants).values({
        id: crypto.randomUUID(),
        adopterId,
        granteeEmail: actor,
        scope: 'entry',
        entryRef: ref,
        origin: 'contribution',
        grantedByEmail: actor,
        createdAt: new Date(),
    });
    return true;
}

/**
 * A contributor took back contacts they added (a household contact, or their
 * member with its contacts): revoke the entry grants THEY hold BY CONTRIBUTION
 * on those values — the counterpart of removeContactEntry's revoke, narrowed to
 * the actor's own contribution grants (a grant from a search match, a request
 * or someone else's stays). A value still on the profile (`stillOnProfile`, the
 * entry refs left after the remove) keeps its grant: they showed they know it.
 * One statement per ref (D1: no IN (array)); a failure is logged, never a
 * failed remove — the remove already landed.
 */
export async function revokeContributionGrants(
    db: Db,
    opts: { op: string; adopterId: string; actor: string; removed: Array<Pick<ContactEntry, 'type' | 'value'>>; stillOnProfile: Set<string>; memberId?: string },
): Promise<void> {
    const { op, adopterId, actor } = opts;
    const refs = [...new Set(opts.removed
        .filter(e => e.type !== 'alias') // aliases are never masked: no grant to take back
        .map(e => hashEntryValue(e.type, e.value)))]
        .filter(ref => !opts.stillOnProfile.has(ref));
    if (refs.length === 0) return;
    const now = new Date();
    const results = await Promise.all(refs.map(ref => (async () => {
        await db.update(piiAccessGrants)
            .set({ revokedAt: now, revokedByEmail: actor })
            .where(and(
                eq(piiAccessGrants.adopterId, adopterId),
                eq(piiAccessGrants.granteeEmail, actor),
                eq(piiAccessGrants.entryRef, ref),
                eq(piiAccessGrants.origin, 'contribution'),
                isNull(piiAccessGrants.revokedAt),
            ));
        return true;
    })().catch((e: unknown) => {
        logger.error(`${op}: contribution grant not revoked`, e, { adopterId, actor, memberId: opts.memberId });
        return false;
    })));
    logger.info(`${op}: contribution grants revoked`, { adopterId, actor, memberId: opts.memberId, refs: refs.length, failed: results.filter(ok => !ok).length });
}

/** Every entry ref on a profile: its titular contacts plus every household member's. */
export function entryRefsOnProfile(titular: Array<Pick<ContactEntry, 'type' | 'value'>>, members: Array<{ contactEntries: Array<Pick<ContactEntry, 'type' | 'value'>> }>): Set<string> {
    const refs = new Set<string>();
    for (const e of titular) refs.add(hashEntryValue(e.type, e.value));
    for (const m of members) for (const e of m.contactEntries) refs.add(hashEntryValue(e.type, e.value));
    return refs;
}

/**
 * Notify the profile's owner + editors that `actor` contributed. `build` gets
 * the actor's display name and returns the template; `metadata` always carries
 * `adopterId` and `contributor`. `op` names the caller in the log line.
 */
export async function notifyApprovers(opts: {
    op: string;
    adopterId: string;
    actor: string;
    type: NotificationType;
    build: (actorName: string) => NotificationTemplate;
    metadata?: Record<string, unknown>;
}): Promise<void> {
    const { op, adopterId, actor } = opts;
    const { owner, editors } = await getAdopterApprovers(adopterId);
    // loadApprovers returns them lowercased; the actor may not be.
    const recipients = new Set<string>([...(owner ? [owner] : []), ...editors]);
    recipients.delete(actor.trim().toLowerCase());
    if (recipients.size === 0) {
        // Own record, an import with no real owner, or the only approver acted.
        logger.info(`${op}: approvers notified`, { adopterId, actor, recipients: 0 });
        return;
    }
    const actorName = await resolveDisplayName(actor);
    const content = notificationContent(opts.build(actorName));
    await Promise.all([...recipients].map(email => createNotification({
        userId: email,
        type: opts.type,
        ...content,
        url: `/adopter/${adopterId}`,
        icon: '+',
        metadata: { adopterId, contributor: actor, ...(opts.metadata ?? {}) },
    })));
    logger.info(`${op}: approvers notified`, { adopterId, actor, recipients: recipients.size });
}

/**
 * Auto-file a PII access request on the contributor's behalf (v2.19.51).
 * `fileAccessRequestFor` handles every edge case — already-privileged actors
 * get `has_access`, pending requests dedup, the denial cooldown is respected.
 * `actor` must be resolved before the response (never look the session up
 * after it; see src/lib/piiAccessRequest.ts).
 */
export async function fileContributionAccessRequest(op: string, actor: string, adopterId: string): Promise<void> {
    const res = await fileAccessRequestFor(actor, adopterId, { justification: 'auto:contribution' });
    if (res.status === 'error') {
        logger.warn(`${op}: auto access-request did not file`, { adopterId, actor, error: res.error });
    } else {
        logger.info(`${op}: auto access-request`, { adopterId, actor, status: res.status });
    }
}
