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
import { logger, withTrace } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { isAdminAsync } from '@/config/admins';
import { isPiiGatingEnabled, resolveAdopterVisibility } from '@/lib/piiAccessServer';
import {
    isRealActorEmail,
    piiCooldownUntil,
    maskAdopterContact,
    matchSearchEntries,
    matchSearchNameTokens,
    hashNameToken,
    hashEntryValue,
    type RequestPiiAccessResult,
    type PiiAccessRequestView,
    type PiiAccessRequestState,
    type AdopterPiiContext,
    type PiiAllContactGrant,
    type PiiOrgMateAccess,
} from '@/lib/piiAccess';
import { deserializeContactEntries, type ContactEntryType } from '@/lib/contactEntries';
import { createNotification, resolveDisplayName, resolveDisplayNames } from './notifications';
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
    // Only kind='edit' rows count toward editor status. Contributors
    // (kind='contribution') are not approvers — they merely added one
    // contact detail and have no authority over the rest of the record.
    const editorRows = await db.selectDistinct({ email: adopterHistory.changedBy })
        .from(adopterHistory).where(and(
            eq(adopterHistory.adopterId, adopterId),
            eq(adopterHistory.kind, 'edit'),
        ));
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
        // v2.19.51: differentiate the auto-fired contribution requests from
        // cold "please let me see X" requests. The body tells the approver
        // this came from a contribution they probably already received a
        // notification for, so the mental sequence is "contributor added
        // something → contributor is asking for access to validate / see
        // more." Reduces "who is this person and why are they asking?"
        // friction at approval time.
        const isAutoContribution = opts.justification?.trim() === 'auto:contribution';
        const body = isAutoContribution
            ? `${requesterName} agregó un dato a ${adopter.name} y solicita acceso a los datos de contacto.`
            : `${requesterName} solicitó acceso a los datos de contacto de ${adopter.name}.`;
        await Promise.all(recipients.map(email => createNotification({
            userId: email,
            type: 'pii_access_request',
            title: 'Solicitud de acceso a contacto',
            body,
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
    // v2.19.45: wrapped in `withTrace` so every call records {durationMs} in
    // Axiom under `Trace: getAdopterPiiContext`. The action is on the profile-
    // page critical path — if Cloudflare exception counts climb, we want to
    // know whether it's CPU/duration-bound here before guessing.
    return withTrace('getAdopterPiiContext', () => getAdopterPiiContextImpl(adopterId), { adopterId });
}

async function getAdopterPiiContextImpl(adopterId: string): Promise<AdopterPiiContext> {
    const empty: AdopterPiiContext = {
        gatingOn: false, privileged: false, masked: false, maskedFieldCount: 0,
        requestState: { pending: false, cooldownUntil: null, lastResolutionNote: null },
        pendingRequests: [],
        accessGrants: { allContact: [], orgMates: [], searchMatch: [] },
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
        let accessGrants: AdopterPiiContext['accessGrants'] = { allContact: [], orgMates: [], searchMatch: [] };
        if (privileged) {
            const [reqRows, grantRows]: [PiiRequest[], PiiGrant[]] = await Promise.all([
                db.select().from(piiAccessRequests)
                    .where(and(eq(piiAccessRequests.adopterId, adopterId), eq(piiAccessRequests.status, 'pending')))
                    .orderBy(asc(piiAccessRequests.createdAt)),
                db.select().from(piiAccessGrants)
                    .where(and(eq(piiAccessGrants.adopterId, adopterId), isNull(piiAccessGrants.revokedAt))),
            ]);

            // Resolve every grantee + requester display name in one batch.
            // v2.19.26: include search-match grantees in the name-resolution
            // pre-warm so we can show WHO holds each search-match grant in
            // the "who has access" disclosure (not just an aggregate count).
            const emails = new Set<string>([
                ...reqRows.map(r => r.requesterEmail),
                ...grantRows.filter(g =>
                    g.scope === 'all_contact' || g.scope === 'entry' || g.scope === 'name_token',
                ).map(g => g.granteeEmail),
            ]);
            // v2.19.45: was N sequential D1 subrequests via
            // `Promise.all(emails.map(resolveDisplayName))`. For a privileged
            // viewer on an adopter with many grantees + org-mates that was a
            // 30-50 subrequest fanout and a likely contributor to the
            // ~1/day "scriptThrewException" we saw in Cloudflare Analytics
            // over 2026-06-12 to 06-18. Batched into one `IN (?, ?, ?...)`
            // query — same return shape; `nameOf` is unchanged.
            const names = await resolveDisplayNames([...emails]);
            const nameOf = (e: string) => names.get(e.toLowerCase()) ?? e.split('@')[0];

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

            // v2.19.25: implicit org-mate access. The owner / admins always knew
            // that someone in their rescue org could see their adopters' contact
            // info (that's the whole point of the org-collab feature), but the
            // "who has access" disclosure only listed explicit `all_contact`
            // grants — which made the implicit half invisible. List org-mates
            // alongside, visually distinct (no revoke button: revoking is an
            // org-membership change, not a per-adopter action).
            let orgMates: PiiOrgMateAccess[] = [];
            if (isRealActorEmail(adopter.addedBy)) {
                const mates = await (await import('@/lib/orgMembership')).getOrgMatesOf(adopter.addedBy);
                if (mates.length > 0) {
                    // v2.19.45: was N sequential resolveDisplayName subrequests.
                    // Batch into one `resolveDisplayNames` call covering only
                    // the org-mate emails that aren't already in `names`
                    // (the grant + request resolve above already covered some).
                    const matesNeedingNames = mates
                        .map(m => m.email)
                        .filter(e => !names.has(e.toLowerCase()));
                    if (matesNeedingNames.length > 0) {
                        const mateNames = await resolveDisplayNames(matesNeedingNames);
                        for (const [k, v] of mateNames) names.set(k, v);
                    }
                    orgMates = mates.map(m => ({
                        granteeEmail: m.email,
                        granteeName: nameOf(m.email),
                        orgs: m.orgs.map(o => ({ id: o.id, name: o.name })),
                    }));
                }
            }

            // v2.19.26: search-match grants grouped by grantee. Bundle entry +
            // name_token grants — both are "things this viewer demonstrated
            // knowing" and a single grantee may hold a mix. Empty list when
            // no search-match grants exist.
            //
            // v2.19.27: also resolve each grant's `entryRef` hash back to a
            // human-readable label so the disclosure can show WHICH fields
            // were revealed. Build the entry-hash and name-token-hash lookup
            // maps ONCE per adopter (not per grantee) and reuse across all
            // search-match grants — a grantee with 3 grants doesn't trigger
            // 3× the hashing work. A hash that no longer matches the
            // adopter's current entries / name (entry deleted, name changed)
            // gets a generic placeholder; the count still includes it.
            const adopterEntries = deserializeContactEntries(adopter.contactEntries);
            const entryByHash = new Map<string, { type: ContactEntryType; value: string }>();
            for (const e of adopterEntries) {
                entryByHash.set(hashEntryValue(e.type, e.value), { type: e.type, value: e.value });
            }
            const nameTokenByHash = new Map<string, string>();
            for (const token of (adopter.name ?? '').trim().split(/\s+/)) {
                if (token.length >= 2) nameTokenByHash.set(hashNameToken(token), token);
            }

            const searchMatchByEmail = new Map<string, {
                count: number;
                details: AdopterPiiContext['accessGrants']['searchMatch'][number]['details'];
            }>();
            for (const g of grantRows) {
                if (g.scope !== 'entry' && g.scope !== 'name_token') continue;
                if (!searchMatchByEmail.has(g.granteeEmail)) {
                    searchMatchByEmail.set(g.granteeEmail, { count: 0, details: [] });
                }
                const bucket = searchMatchByEmail.get(g.granteeEmail)!;
                bucket.count++;
                if (g.scope === 'entry') {
                    const resolved = g.entryRef ? entryByHash.get(g.entryRef) : null;
                    bucket.details.push(resolved
                        ? { scope: 'entry', type: resolved.type, label: resolved.value }
                        : { scope: 'entry', label: '—' });
                } else {
                    const token = g.entryRef ? nameTokenByHash.get(g.entryRef) : null;
                    bucket.details.push({ scope: 'name_token', label: token ?? '—' });
                }
            }
            const searchMatch = [...searchMatchByEmail.entries()].map(([email, b]) => ({
                granteeEmail: email,
                granteeName: nameOf(email),
                count: b.count,
                details: b.details,
            }));

            accessGrants = {
                allContact,
                orgMates,
                searchMatch,
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
            id: adopters.id, addedBy: adopters.addedBy, name: adopters.name, contactEntries: adopters.contactEntries,
        }).from(adopters).where(eq(adopters.id, adopterId)).get();
        if (!adopter) return { ok: false, revealed: 0, error: 'Adopter not found' };

        const visibility = await resolveAdopterVisibility(viewer, { id: adopter.id, addedBy: adopter.addedBy });
        if (visibility.nothingMasked) return { ok: true, revealed: 0 };

        // Try BOTH contact-entry matching and name-token matching against the
        // user's typed input. Lets a single popover/verify input handle "I know
        // this phone" AND "I know this person's full name" — same proof-by-
        // knowledge model, different grant scope. Without name matching here
        // the user can only verify contact identifiers; their hypothesis about
        // the name (the common "is this who I think it is?" case after a phone
        // match) stays unconfirmable.
        const entries = deserializeContactEntries(adopter.contactEntries);
        const entryMatches = matchSearchEntries(entries, info, { anchorRequiredForSecondary: false });
        const nameTokenMatches = matchSearchNameTokens(adopter.name, info);

        const newEntryGrants = entryMatches.filter(m => !visibility.unlockedEntryHashes.has(m.hash));
        const newNameGrants: { hash: string }[] = [];
        for (const token of nameTokenMatches) {
            const h = hashNameToken(token);
            if (!visibility.unlockedNameTokenHashes.has(h) && !newNameGrants.some(g => g.hash === h)) {
                newNameGrants.push({ hash: h });
            }
        }
        const totalNew = newEntryGrants.length + newNameGrants.length;
        if (totalNew === 0) return { ok: true, revealed: 0 };

        await Promise.all([
            ...newEntryGrants.map(g => db.insert(piiAccessGrants).values({
                id: crypto.randomUUID(),
                adopterId,
                granteeEmail: viewer,
                scope: 'entry',
                entryRef: g.hash,
                origin: 'search_match',
                grantedByEmail: viewer,
                createdAt: new Date(),
            })),
            ...newNameGrants.map(g => db.insert(piiAccessGrants).values({
                id: crypto.randomUUID(),
                adopterId,
                granteeEmail: viewer,
                scope: 'name_token',
                entryRef: g.hash,
                origin: 'search_match',
                grantedByEmail: viewer,
                createdAt: new Date(),
            })),
        ]);

        logAudit({
            userEmail: viewer,
            action: 'pii_known_info_unlocked',
            target: adopterId,
            details: { entryCount: newEntryGrants.length, nameTokenCount: newNameGrants.length },
        });
        return { ok: true, revealed: totalNew };
    } catch (e) {
        const errorId = logger.error('verifyKnownInfo failed', e, { adopterId });
        return { ok: false, revealed: 0, error: `Failed to verify (ID: ${errorId})` };
    }
}
