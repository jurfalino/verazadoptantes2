'use server';

/**
 * PII access gating — request / approve / revoke workflow (phase 4).
 *
 * Server actions behind ENABLE_PII_ACCESS_GATING. A non-privileged viewer
 * requests access to an adopter's contact info; the record's owner / editors
 * (or an admin) approve or deny it. Approval writes an `all_contact` grant.
 *
 * Notification routing (Resolution #4): a request notifies the owner + editors
 * (push); admins act on it via the dashboard (pull). A denial starts a cooldown
 * before the same requester can re-request the same adopter.
 */

import { piiAccessRequests, piiAccessGrants, adopters, adopterHistory } from '@/db/schema';
import { and, eq, desc, asc, isNull } from 'drizzle-orm';
import { getDb, getUser } from './_db';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { isAdminAsync } from '@/config/admins';
import { isPiiGatingEnabled, resolveAdopterVisibility } from '@/lib/piiAccessServer';
import {
    isRealActorEmail,
    piiCooldownUntil,
    maskAdopterContact,
    matchSearchEntries,
    type RequestPiiAccessResult,
    type PiiAccessRequestView,
    type PiiAccessRequestState,
    type AdopterPiiContext,
    type PiiAllContactGrant,
} from '@/lib/piiAccess';
import { deserializeContactEntries } from '@/lib/contactEntries';
import { createNotification, resolveDisplayName } from './notifications';
import { requestPiiAccessSchema, resolvePiiRequestSchema, verifyKnownInfoSchema } from './validation';

type PiiRequest = typeof piiAccessRequests.$inferSelect;
type PiiGrant = typeof piiAccessGrants.$inferSelect;

/** The owner + editor emails that may approve PII requests for an adopter (real users only). */
async function loadApprovers(adopterId: string): Promise<{ owner: string | null; editors: string[]; all: string[] }> {
    const db = await getDb();
    if (!db) return { owner: null, editors: [], all: [] };
    const adopter = await db.select({ addedBy: adopters.addedBy })
        .from(adopters).where(eq(adopters.id, adopterId)).get();
    const owner = isRealActorEmail(adopter?.addedBy) ? adopter!.addedBy : null;
    const editorRows = await db.selectDistinct({ email: adopterHistory.changedBy })
        .from(adopterHistory).where(eq(adopterHistory.adopterId, adopterId));
    const editors = editorRows
        .map((r: { email: string | null }) => r.email)
        .filter(isRealActorEmail);
    const all = [...new Set([...(owner ? [owner] : []), ...editors])];
    return { owner, editors, all };
}

/** Public: who can approve PII requests for this adopter. */
export async function getAdopterApprovers(adopterId: string): Promise<{ owner: string | null; editors: string[] }> {
    const { owner, editors } = await loadApprovers(adopterId);
    return { owner, editors };
}

/**
 * File a request for an adopter's contact info. `activityId` links the
 * `adoptions` row when the request rides along with a logged activity.
 */
export async function requestPiiAccess(
    adopterId: string,
    opts: { activityId?: string | null; justification?: string | null } = {},
): Promise<RequestPiiAccessResult> {
    try {
        if (!(await isPiiGatingEnabled())) return { ok: false, status: 'error', error: 'PII gating not enabled' };

        const parsed = requestPiiAccessSchema.safeParse({ adopterId, ...opts });
        if (!parsed.success) return { ok: false, status: 'error', error: 'Invalid input' };

        let viewer = '';
        try { viewer = await getUser(); } catch { /* unauthenticated */ }
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
        await Promise.all(recipients.map(email => createNotification({
            userId: email,
            type: 'pii_access_request',
            title: 'Solicitud de acceso a contacto',
            body: `${requesterName} solicitó acceso a los datos de contacto de ${adopter.name}.`,
            url: `/adopter/${adopterId}`,
            icon: '🔒',
            metadata: { adopterId, requestId },
        })));

        logAudit({
            userEmail: viewer, action: 'pii_access_requested', target: adopterId,
            details: { requestId, activityLinked: !!opts.activityId, approverCount: recipients.length },
        });
        return { ok: true, status: 'created', requestId };
    } catch (e) {
        const errorId = logger.error('requestPiiAccess failed', e, { adopterId });
        return { ok: false, status: 'error', error: `Failed to request access (ID: ${errorId})` };
    }
}

/**
 * Approve or deny a pending request. The actor must be an approver (owner /
 * editor) or admin for the adopter, and not the requester. Approval writes an
 * `all_contact` grant; either way the requester is notified.
 */
export async function resolvePiiAccessRequest(
    requestId: string,
    decision: 'approved' | 'denied',
    note?: string | null,
): Promise<{ ok: boolean; error?: string }> {
    try {
        if (!(await isPiiGatingEnabled())) return { ok: false, error: 'PII gating not enabled' };

        const parsed = resolvePiiRequestSchema.safeParse({ requestId, decision, note });
        if (!parsed.success) return { ok: false, error: 'Invalid input' };

        let actor = '';
        try { actor = await getUser(); } catch { /* unauthenticated */ }
        if (!isRealActorEmail(actor)) return { ok: false, error: 'Not authenticated' };

        const db = await getDb();
        if (!db) return { ok: false, error: 'No database' };

        const req = await db.select().from(piiAccessRequests).where(eq(piiAccessRequests.id, requestId)).get();
        if (!req) return { ok: false, error: 'Request not found' };
        if (req.status !== 'pending') return { ok: false, error: 'Request already resolved' };
        if (req.requesterEmail === actor) return { ok: false, error: 'You cannot resolve your own request' };

        // Authorize: an approver for this adopter, or an admin.
        const [isAdmin, { all: approvers }] = await Promise.all([
            isAdminAsync(actor),
            loadApprovers(req.adopterId),
        ]);
        if (!isAdmin && !approvers.includes(actor)) {
            return { ok: false, error: 'Not authorized to resolve this request' };
        }

        await db.update(piiAccessRequests).set({
            status: decision,
            resolvedByEmail: actor,
            resolvedAt: new Date(),
            resolutionNote: note?.trim() || null,
        }).where(eq(piiAccessRequests.id, requestId));

        if (decision === 'approved') {
            await db.insert(piiAccessGrants).values({
                id: crypto.randomUUID(),
                adopterId: req.adopterId,
                granteeEmail: req.requesterEmail,
                scope: 'all_contact',
                entryRef: null,
                origin: 'request',
                requestId,
                grantedByEmail: actor,
                createdAt: new Date(),
            });
        }

        const adopter = await db.select({ name: adopters.name })
            .from(adopters).where(eq(adopters.id, req.adopterId)).get();
        const adopterName = adopter?.name ?? 'el adoptante';
        await createNotification({
            userId: req.requesterEmail,
            type: decision === 'approved' ? 'pii_access_approved' : 'pii_access_denied',
            title: decision === 'approved' ? 'Acceso a contacto aprobado' : 'Solicitud de acceso no aprobada',
            body: decision === 'approved'
                ? `Ya podés ver los datos de contacto de ${adopterName}.`
                : `Tu solicitud de acceso a ${adopterName} no fue aprobada.${note?.trim() ? ` Nota: ${note.trim()}` : ''}`,
            url: `/adopter/${req.adopterId}`,
            icon: decision === 'approved' ? '✅' : '🔒',
            metadata: { adopterId: req.adopterId, requestId },
        });

        logAudit({
            userEmail: actor, action: `pii_access_${decision}`, target: req.adopterId,
            details: { requestId, requester: req.requesterEmail },
        });
        return { ok: true };
    } catch (e) {
        const errorId = logger.error('resolvePiiAccessRequest failed', e, { requestId });
        return { ok: false, error: `Failed to resolve request (ID: ${errorId})` };
    }
}

/** Revoke a live grant. Owner / editor / admin only; the grantee is notified (Resolution #6). */
export async function revokePiiAccessGrant(grantId: string): Promise<{ ok: boolean; error?: string }> {
    try {
        if (!(await isPiiGatingEnabled())) return { ok: false, error: 'PII gating not enabled' };

        let actor = '';
        try { actor = await getUser(); } catch { /* unauthenticated */ }
        if (!isRealActorEmail(actor)) return { ok: false, error: 'Not authenticated' };

        const db = await getDb();
        if (!db) return { ok: false, error: 'No database' };

        const grant = await db.select().from(piiAccessGrants).where(eq(piiAccessGrants.id, grantId)).get();
        if (!grant) return { ok: false, error: 'Grant not found' };
        if (grant.revokedAt) return { ok: true }; // idempotent

        const [isAdmin, { all: approvers }] = await Promise.all([
            isAdminAsync(actor),
            loadApprovers(grant.adopterId),
        ]);
        if (!isAdmin && !approvers.includes(actor)) return { ok: false, error: 'Not authorized' };

        await db.update(piiAccessGrants)
            .set({ revokedAt: new Date(), revokedByEmail: actor })
            .where(eq(piiAccessGrants.id, grantId));

        const adopter = await db.select({ name: adopters.name })
            .from(adopters).where(eq(adopters.id, grant.adopterId)).get();
        await createNotification({
            userId: grant.granteeEmail,
            type: 'pii_access_revoked',
            title: 'Acceso a contacto removido',
            body: `Tu acceso a los datos de contacto de ${adopter?.name ?? 'un adoptante'} fue removido.`,
            url: `/adopter/${grant.adopterId}`,
            icon: '🔒',
            metadata: { adopterId: grant.adopterId },
        });

        logAudit({
            userEmail: actor, action: 'pii_access_grant_revoked', target: grant.adopterId,
            details: { grantId, grantee: grant.granteeEmail },
        });
        return { ok: true };
    } catch (e) {
        const errorId = logger.error('revokePiiAccessGrant failed', e, { grantId });
        return { ok: false, error: `Failed to revoke grant (ID: ${errorId})` };
    }
}

/**
 * Pending requests the caller can act on — admins see all; everyone else sees
 * only requests on adopters they own or have edited. Oldest first. Powers both
 * the on-profile approver panel and the admin dashboard.
 */
export async function getPiiAccessRequestsForApprover(): Promise<PiiAccessRequestView[]> {
    try {
        if (!(await isPiiGatingEnabled())) return [];

        let actor = '';
        try { actor = await getUser(); } catch { /* unauthenticated */ }
        if (!isRealActorEmail(actor)) return [];

        const db = await getDb();
        if (!db) return [];

        const isAdmin = await isAdminAsync(actor);
        const allPending: PiiRequest[] = await db.select().from(piiAccessRequests)
            .where(eq(piiAccessRequests.status, 'pending'))
            .orderBy(asc(piiAccessRequests.createdAt));

        let visible = allPending;
        if (!isAdmin) {
            const [ownedRows, editedRows] = await Promise.all([
                db.select({ id: adopters.id }).from(adopters).where(eq(adopters.addedBy, actor)),
                db.selectDistinct({ id: adopterHistory.adopterId }).from(adopterHistory)
                    .where(eq(adopterHistory.changedBy, actor)),
            ]);
            const approvableIds = new Set<string>([
                ...ownedRows.map((r: { id: string }) => r.id),
                ...editedRows.map((r: { id: string }) => r.id),
            ]);
            visible = allPending.filter(r => approvableIds.has(r.adopterId));
        }
        if (visible.length === 0) return [];

        // Enrich with adopter + requester display names.
        const adopterIds = [...new Set(visible.map(r => r.adopterId))];
        const nameRows = await Promise.all(adopterIds.map(id =>
            db.select({ id: adopters.id, name: adopters.name })
                .from(adopters).where(eq(adopters.id, id)).get()
                .catch(() => null),
        ));
        const adopterNames = new Map<string, string>();
        for (const row of nameRows) {
            if (row) adopterNames.set(row.id, row.name);
        }
        const requesterEmails = [...new Set(visible.map(r => r.requesterEmail))];
        const displayNames = new Map<string, string>();
        await Promise.all(requesterEmails.map(async email => {
            displayNames.set(email, await resolveDisplayName(email));
        }));

        return visible.map(r => ({
            id: r.id,
            adopterId: r.adopterId,
            adopterName: adopterNames.get(r.adopterId) ?? 'Adoptante',
            requesterEmail: r.requesterEmail,
            requesterName: displayNames.get(r.requesterEmail) ?? r.requesterEmail.split('@')[0],
            justification: r.justification,
            activityId: r.activityId,
            createdAt: r.createdAt ? new Date(r.createdAt).getTime() : null,
        }));
    } catch (e) {
        logger.error('getPiiAccessRequestsForApprover failed', e);
        return [];
    }
}

/** The current viewer's request situation for one adopter — drives the request CTA / banner. */
export async function getPiiAccessRequestState(adopterId: string): Promise<PiiAccessRequestState> {
    const empty: PiiAccessRequestState = { pending: false, cooldownUntil: null, lastResolutionNote: null };
    try {
        if (!(await isPiiGatingEnabled())) return empty;

        let viewer = '';
        try { viewer = await getUser(); } catch { /* unauthenticated */ }
        if (!isRealActorEmail(viewer)) return empty;

        const db = await getDb();
        if (!db) return empty;

        const rows: PiiRequest[] = await db.select().from(piiAccessRequests)
            .where(and(
                eq(piiAccessRequests.adopterId, adopterId),
                eq(piiAccessRequests.requesterEmail, viewer),
            ))
            .orderBy(desc(piiAccessRequests.createdAt));

        const pending = rows.some(r => r.status === 'pending');
        const lastDenied = rows.find(r => r.status === 'denied');
        let cooldownUntil: number | null = null;
        if (lastDenied?.resolvedAt) {
            const until = piiCooldownUntil(lastDenied.resolvedAt).getTime();
            if (until > Date.now()) cooldownUntil = until;
        }
        return { pending, cooldownUntil, lastResolutionNote: lastDenied?.resolutionNote ?? null };
    } catch (e) {
        logger.warn('getPiiAccessRequestState failed', {
            adopterId, error: e instanceof Error ? e.message : String(e),
        });
        return empty;
    }
}

/**
 * One call for everything the adopter-profile UI needs to render the PII gating
 * surfaces: whether contact is masked, the viewer's request state, and (for
 * approvers) the pending requests on this adopter.
 */
export async function getAdopterPiiContext(adopterId: string): Promise<AdopterPiiContext> {
    const empty: AdopterPiiContext = {
        gatingOn: false, privileged: false, masked: false, maskedFieldCount: 0,
        requestState: { pending: false, cooldownUntil: null, lastResolutionNote: null },
        pendingRequests: [],
        accessGrants: { allContact: [], searchMatchCount: 0 },
    };
    try {
        if (!(await isPiiGatingEnabled())) return empty;

        let viewer = '';
        try { viewer = await getUser(); } catch { /* unauthenticated */ }

        const db = await getDb();
        if (!db) return empty;

        const adopter = await db.select({
            id: adopters.id, addedBy: adopters.addedBy, name: adopters.name,
            contactInfo: adopters.contactInfo, contactEntries: adopters.contactEntries, addressInfo: adopters.addressInfo,
        }).from(adopters).where(eq(adopters.id, adopterId)).get();
        if (!adopter) return { ...empty, gatingOn: true };

        const visibility = await resolveAdopterVisibility(viewer, { id: adopter.id, addedBy: adopter.addedBy });
        const mask = maskAdopterContact(adopter, visibility);
        const privileged = visibility.privileged;
        const masked = !visibility.nothingMasked && mask.maskedFieldCount > 0;

        // The viewer's own request state for this adopter.
        let requestState: PiiAccessRequestState = { pending: false, cooldownUntil: null, lastResolutionNote: null };
        if (isRealActorEmail(viewer) && !visibility.nothingMasked) {
            const rows: PiiRequest[] = await db.select().from(piiAccessRequests)
                .where(and(eq(piiAccessRequests.adopterId, adopterId), eq(piiAccessRequests.requesterEmail, viewer)))
                .orderBy(desc(piiAccessRequests.createdAt));
            const pending = rows.some(r => r.status === 'pending');
            const lastDenied = rows.find(r => r.status === 'denied');
            let cooldownUntil: number | null = null;
            if (lastDenied?.resolvedAt) {
                const until = piiCooldownUntil(lastDenied.resolvedAt).getTime();
                if (until > Date.now()) cooldownUntil = until;
            }
            requestState = { pending, cooldownUntil, lastResolutionNote: lastDenied?.resolutionNote ?? null };
        }

        // Privileged viewers: the pending requests they can act on + the live
        // grants for the "who has access" disclosure.
        let pendingRequests: PiiAccessRequestView[] = [];
        let accessGrants: AdopterPiiContext['accessGrants'] = { allContact: [], searchMatchCount: 0 };
        if (privileged) {
            const [reqRows, grantRows]: [PiiRequest[], PiiGrant[]] = await Promise.all([
                db.select().from(piiAccessRequests)
                    .where(and(eq(piiAccessRequests.adopterId, adopterId), eq(piiAccessRequests.status, 'pending')))
                    .orderBy(asc(piiAccessRequests.createdAt)),
                db.select().from(piiAccessGrants)
                    .where(and(eq(piiAccessGrants.adopterId, adopterId), isNull(piiAccessGrants.revokedAt))),
            ]);

            // Resolve every grantee + requester display name in one batch.
            const emails = new Set<string>([
                ...reqRows.map(r => r.requesterEmail),
                ...grantRows.filter(g => g.scope === 'all_contact').map(g => g.granteeEmail),
            ]);
            const names = new Map<string, string>();
            await Promise.all([...emails].map(async e => { names.set(e, await resolveDisplayName(e)); }));
            const nameOf = (e: string) => names.get(e) ?? e.split('@')[0];

            pendingRequests = reqRows.map(r => ({
                id: r.id,
                adopterId,
                adopterName: adopter.name,
                requesterEmail: r.requesterEmail,
                requesterName: nameOf(r.requesterEmail),
                justification: r.justification,
                activityId: r.activityId,
                createdAt: r.createdAt ? new Date(r.createdAt).getTime() : null,
            }));

            const allContact: PiiAllContactGrant[] = grantRows
                .filter(g => g.scope === 'all_contact')
                .map(g => ({
                    grantId: g.id,
                    granteeEmail: g.granteeEmail,
                    granteeName: nameOf(g.granteeEmail),
                    grantedAt: g.createdAt ? new Date(g.createdAt).getTime() : null,
                }));
            accessGrants = {
                allContact,
                // Search-match count bundles both contact-entry grants and
                // name-token grants — both are "things this viewer demonstrated
                // knowing." The owner's "who has access" disclosure shows it as
                // a single aggregate count.
                searchMatchCount: grantRows.filter(g => g.scope === 'entry' || g.scope === 'name_token').length,
            };
        }

        return { gatingOn: true, privileged, masked, maskedFieldCount: mask.maskedFieldCount, requestState, pendingRequests, accessGrants };
    } catch (e) {
        logger.error('getAdopterPiiContext failed', e, { adopterId });
        return empty;
    }
}

/**
 * On-profile "I know this" self-serve verification. The viewer types something
 * they think is part of the adopter's contact info; if it matches any of that
 * adopter's still-masked entries it unlocks them — same `pii_access_grants`
 * row a search match would write (`origin='search_match'`).
 *
 * Scoped to a single adopter, so the matcher runs without the cross-adopter
 * anchor requirement: a bare address or id input here can unlock its matching
 * entry on its own. Returns just a count — no leak of *which* entries exist.
 */
export async function verifyKnownInfo(
    adopterId: string,
    info: string,
): Promise<{ ok: boolean; revealed: number; error?: string }> {
    try {
        if (!(await isPiiGatingEnabled())) return { ok: false, revealed: 0, error: 'PII gating not enabled' };

        const parsed = verifyKnownInfoSchema.safeParse({ adopterId, info });
        if (!parsed.success) return { ok: false, revealed: 0, error: 'Invalid input' };

        let viewer = '';
        try { viewer = await getUser(); } catch { /* unauthenticated */ }
        if (!isRealActorEmail(viewer)) return { ok: false, revealed: 0, error: 'Not authenticated' };

        const db = await getDb();
        if (!db) return { ok: false, revealed: 0, error: 'No database' };

        const adopter = await db.select({
            id: adopters.id, addedBy: adopters.addedBy, contactEntries: adopters.contactEntries,
        }).from(adopters).where(eq(adopters.id, adopterId)).get();
        if (!adopter) return { ok: false, revealed: 0, error: 'Adopter not found' };

        const visibility = await resolveAdopterVisibility(viewer, { id: adopter.id, addedBy: adopter.addedBy });
        if (visibility.nothingMasked) return { ok: true, revealed: 0 };

        const entries = deserializeContactEntries(adopter.contactEntries);
        const matches = matchSearchEntries(entries, info, { anchorRequiredForSecondary: false });
        if (matches.length === 0) return { ok: true, revealed: 0 };

        const newGrants = matches.filter(m => !visibility.unlockedEntryHashes.has(m.hash));
        if (newGrants.length === 0) return { ok: true, revealed: 0 };

        await Promise.all(newGrants.map(g => db.insert(piiAccessGrants).values({
            id: crypto.randomUUID(),
            adopterId,
            granteeEmail: viewer,
            scope: 'entry',
            entryRef: g.hash,
            origin: 'search_match',
            grantedByEmail: viewer,
            createdAt: new Date(),
        })));

        logAudit({
            userEmail: viewer,
            action: 'pii_known_info_unlocked',
            target: adopterId,
            details: { count: newGrants.length },
        });
        return { ok: true, revealed: newGrants.length };
    } catch (e) {
        const errorId = logger.error('verifyKnownInfo failed', e, { adopterId });
        return { ok: false, revealed: 0, error: `Failed to verify (ID: ${errorId})` };
    }
}
