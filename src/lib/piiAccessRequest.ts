import { piiAccessRequests, adopters, adopterHistory } from '@/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { resolveAdopterVisibility } from '@/lib/piiAccessServer';
import { isRealActorEmail, piiCooldownUntil, type RequestPiiAccessResult } from '@/lib/piiAccess';
import { createNotification, resolveDisplayName } from '@/app/actions/notifications';
import { notificationContent } from '@/domain/notificationTemplates';

/**
 * The core of "request access to a record's contact data", for a requester the
 * CALLER has already authenticated.
 *
 * Deliberately NOT a server action (no 'use server'): anything exported from a
 * 'use server' file is callable from the browser, and a function that takes the
 * requester as an argument would let a client file requests in anyone's name.
 * The public action is `requestPiiAccess` in src/app/actions/piiAccess.ts, which
 * resolves the session and delegates here.
 *
 * It exists because the contribution path files a request AFTER the response has
 * been sent (src/lib/background.ts). Re-resolving the user there — NextAuth's
 * `auth()` reading request headers — is unproven on Cloudflare once the response
 * is gone, and a failure is silent (`Not authenticated`, no throw). The caller
 * already knows who acted, so it says so.
 */

/**
 * The emails that may approve PII requests for an adopter (real users only):
 * the owner, always, plus `editors` — people who wrote a kind='edit' history
 * row on it AND are privileged on it right now (a teammate of the owner, an
 * admin or a moderator — isPrivilegedOnProfile). Writing an 'edit' row alone
 * grants nothing: until the final fix wave paths open to any rescuer wrote one
 * (flagging, logging an adoption, deleting images, merges) — they now write
 * 'contribution' (src/lib/profilePrivilege.ts) — and an approver can approve
 * anyone's request and revoke grants. Contributors (kind='contribution') are
 * never candidates. Callers also use `editors` as "who to notify" — same people.
 */
export async function loadApprovers(adopterId: string): Promise<{ owner: string | null; editors: string[]; all: string[] }> {
    const db = await getDb();
    if (!db) return { owner: null, editors: [], all: [] };
    const adopter = await db.select({ addedBy: adopters.addedBy })
        .from(adopters).where(eq(adopters.id, adopterId)).get();
    const owner = isRealActorEmail(adopter?.addedBy) ? adopter!.addedBy : null;
    const editorRows = await db.selectDistinct({ email: adopterHistory.changedBy })
        .from(adopterHistory).where(and(
            eq(adopterHistory.adopterId, adopterId),
            eq(adopterHistory.kind, 'edit'),
        ));
    const candidates: string[] = [...new Set<string>(editorRows
        .map((r: { email: string | null }) => r.email)
        .filter(isRealActorEmail))]
        .filter(email => !owner || email.trim().toLowerCase() !== owner.trim().toLowerCase());
    // One check per candidate (D1: no IN (array)); a failed check drops that one, logged.
    const { isPrivilegedOnProfile } = await import('@/lib/profilePrivilege');
    const verdicts = await Promise.all(candidates.map(async (email) => {
        try {
            return await isPrivilegedOnProfile(email, owner);
        } catch (e) {
            logger.warn('loadApprovers: privilege check failed, editor not counted', { adopterId, editor: email, error: e instanceof Error ? e.message : String(e) });
            return false;
        }
    }));
    const editors = candidates.filter((_, i) => verdicts[i]);
    const all = [...new Set([...(owner ? [owner] : []), ...editors])];
    return { owner, editors, all };
}


export async function fileAccessRequestFor(
    viewer: string,
    adopterId: string,
    opts: { activityId?: string | null; justification?: string | null } = {},
): Promise<RequestPiiAccessResult> {
    if (!isRealActorEmail(viewer)) return { ok: false, status: 'error', error: 'Not authenticated' };
    const db = await getDb();
    if (!db) return { ok: false, status: 'error', error: 'No database' };

    const adopter = await db.select({ id: adopters.id, addedBy: adopters.addedBy, name: adopters.name })
        .from(adopters).where(eq(adopters.id, adopterId)).get();
    if (!adopter) return { ok: false, status: 'error', error: 'Adopter not found' };

    // Already privileged or holding an all-contact grant — no request needed.
    const visibility = await resolveAdopterVisibility(viewer, { id: adopter.id, addedBy: adopter.addedBy });
    if (visibility.nothingMasked) return { ok: false, status: 'has_access' };

    // Dedupe against an existing pending request.
    const pending = await db.select({ id: piiAccessRequests.id }).from(piiAccessRequests)
        .where(and(
            eq(piiAccessRequests.adopterId, adopterId),
            eq(piiAccessRequests.requesterEmail, viewer),
            eq(piiAccessRequests.status, 'pending'),
        )).get();
    if (pending) return { ok: true, status: 'duplicate', requestId: pending.id };

    // Denial cooldown — block a re-request within the cooldown window.
    const lastDenied = await db.select({ resolvedAt: piiAccessRequests.resolvedAt }).from(piiAccessRequests)
        .where(and(
            eq(piiAccessRequests.adopterId, adopterId),
            eq(piiAccessRequests.requesterEmail, viewer),
            eq(piiAccessRequests.status, 'denied'),
        ))
        .orderBy(desc(piiAccessRequests.resolvedAt)).get();
    if (lastDenied?.resolvedAt) {
        const until = piiCooldownUntil(lastDenied.resolvedAt);
        if (until.getTime() > Date.now()) {
            return { ok: false, status: 'cooldown', cooldownUntil: until.getTime() };
        }
    }

    const requestId = crypto.randomUUID();
    await db.insert(piiAccessRequests).values({
        id: requestId,
        adopterId,
        requesterEmail: viewer,
        justification: opts.justification?.trim() || null,
        activityId: opts.activityId || null,
        status: 'pending',
        createdAt: new Date(),
    });

    // Notify owner + editors (push). Admins see it via the dashboard (pull).
    const { all: approvers } = await loadApprovers(adopterId);
    const recipients = approvers.filter(e => e !== viewer);
    const requesterName = await resolveDisplayName(viewer);
    // v2.19.51: differentiate the auto-fired contribution requests from
    // cold "please let me see X" requests. The body tells the approver
    // this came from a contribution they probably already received a
    // notification for, so the mental sequence is "contributor added
    // something → contributor is asking for access to validate / see
    // more." Reduces "who is this person and why are they asking?"
    // friction at approval time.
    const isAutoContribution = opts.justification?.trim() === 'auto:contribution';
    const content = notificationContent({
        key: 'pii_access_request',
        params: { requesterName, kind: isAutoContribution ? 'contribution' : 'direct', ...(adopter.name ? { adopterName: adopter.name } : {}) },
    });
    await Promise.all(recipients.map(email => createNotification({
        userId: email,
        type: 'pii_access_request',
        ...content,
        url: `/adopter/${adopterId}`,
        icon: '🔒',
        metadata: { adopterId, requestId },
    })));

    logAudit({
        userEmail: viewer, action: 'pii_access_requested', target: adopterId,
        details: { requestId, activityLinked: !!opts.activityId, approverCount: recipients.length },
    });
    return { ok: true, status: 'created', requestId };
}
