'use server';

import { organizations, orgMembers, orgInvites } from '@/db/schema';
import { eq, and, sql, ne } from 'drizzle-orm';
import { getDb, getUser } from './_db';
import { logger } from '@/lib/logger';
import { runAfterResponse } from '@/lib/background';
import { appBaseUrl } from '@/lib/emailConfig';
import { keepDocsSourceBeforeChange, keepDocsSourceAfterChange, type DocsBefore } from '@/lib/docsSourceKeep';
import { effectiveDocsSource, shouldAskDocsSource } from '@/domain/adoptionDocs';

/**
 * Case-insensitive name-collision check. Returns true when *another* org
 * already has the same name (after trim + lowercase). `excludeId` lets the
 * rename path ignore the row being updated so a no-op rename doesn't
 * report a conflict against itself.
 *
 * Why this exists: pre-v2.14.10 duplicate org names ("Michis" x2) silently
 * worked because there was no slug column. The 0041 migration's backfill
 * produced colliding slugs on prod and crashed the unique-index step,
 * blocking master deploys until manually unstuck. Beyond the migration
 * fragility, two visually-identical orgs in the UI is just confusing for
 * rescuers ("which Michis am I joining?"). Slug uniqueness is already
 * guaranteed at create time via `generateUniqueSlug`; this guards the
 * user-visible *name* layer.
 */
async function nameAlreadyExists(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any,
    trimmed: string,
    excludeId?: string,
): Promise<boolean> {
    const lower = trimmed.toLowerCase();
    const baseWhere = sql`LOWER(${organizations.name}) = ${lower}`;
    const where = excludeId
        ? and(baseWhere, ne(organizations.id, excludeId))
        : baseWhere;
    const row = await db.select({ id: organizations.id })
        .from(organizations)
        .where(where)
        .get();
    return row != null;
}

// ── Types ────────────────────────────────────────────────────────

export interface Organization {
    id: string;
    name: string;
    createdBy: string;
    createdAt: Date | null;
    members: OrgMember[];
    role: string; // current user's role in this org
}

export interface OrgMember {
    id: string;
    userEmail: string;
    role: string | null;
    joinedAt: Date | null;
    displayName?: string;
}

// ── «Al cambiar de grupos» (spec 2026-11-13-group-branding-design.md) ──

// The keep logic lives in src/lib/docsSourceKeep.ts (shared with the admin routes).

/** Whether to ask after the membership was written: the groups she ends in. */
function askAfterJoin(before: DocsBefore | null, kind: 'join' | 'create', orgId: string): boolean {
    if (!before) return false;
    const orgCountAfter = new Set([...before.memberOrgIds, orgId]).size;
    return shouldAskDocsSource({ kind, orgCountAfter }, before.flags);
}

// ── Create ───────────────────────────────────────────────────────

export async function createOrganization(name: string): Promise<{ success: boolean; id?: string; askDocsSource?: boolean; error?: string; errorId?: string }> {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 100) {
        return { success: false, error: 'Name must be 1–100 characters' };
    }

    let user: string | undefined;
    try {
        user = await getUser();
        const db = await getDb();
        if (!db) return { success: false, error: 'Database unavailable' };

        if (await nameAlreadyExists(db, trimmed)) {
            return { success: false, error: 'org_name_exists' };
        }

        const orgId = crypto.randomUUID();
        const memberId = crypto.randomUUID();

        // v2.14.10: assign a shareable slug for the public /org/[slug] showcase URL.
        // Integer-suffix collision strategy via generateUniqueSlug. Done before
        // INSERT so the slug is set at create time, not retroactively.
        const { generateUniqueSlug } = await import('@/lib/slugify');
        const slug = await generateUniqueSlug(trimmed, async (candidate) => {
            const existing = await db.select({ id: organizations.id })
                .from(organizations)
                .where(eq(organizations.slug, candidate))
                .get();
            return existing != null;
        });

        await db.insert(organizations).values({
            id: orgId,
            name: trimmed,
            createdBy: user,
            slug,
        });

        const docsBefore = await keepDocsSourceBeforeChange(db, { email: user, orgId, change: 'create', op: 'createOrganization', ctx: { user } });

        await db.insert(orgMembers).values({
            id: memberId,
            orgId,
            userEmail: user,
            role: 'owner',
        });

        return { success: true, id: orgId, askDocsSource: askAfterJoin(docsBefore, 'create', orgId) };
    } catch (error) {
        const errorId = logger.error('createOrganization failed', error, { user, name: trimmed });
        return { success: false, error: 'Failed to create organization', errorId };
    }
}

// ── Read ─────────────────────────────────────────────────────────

export async function getMyOrganizations(): Promise<Organization[]> {
    const user = await getUser();
    const db = await getDb();
    if (!db) return [];

    try {
        // Get all orgs this user belongs to
        const memberships = await db
            .select({ orgId: orgMembers.orgId, role: orgMembers.role })
            .from(orgMembers)
            .where(eq(orgMembers.userEmail, user));

        if (memberships.length === 0) return [];

        const orgIds = [...new Set<string>(memberships.map((m: { orgId: string; role: string | null }) => m.orgId))];
        const roleMap = new Map<string, string>();
        for (const m of memberships) {
            roleMap.set(m.orgId, m.role || 'member');
        }

        // D1 does not expand an array bound parameter: `inArray` becomes `IN (?)`
        // with a single value, so a user in two organizations silently saw only
        // one. Fan out per id instead (same idiom as hydrateDuplicateMatches).
        const orgs = (await Promise.all(orgIds.map((id: string) =>
            db.select().from(organizations).where(eq(organizations.id, id))
                .catch((e: unknown) => {
                    logger.warn('getMyOrganizations: org row lookup fallback', {
                        orgId: id, error: e instanceof Error ? e.message : String(e),
                    });
                    return [];
                }),
        ))).flat();

        // Fetch all members for these orgs
        const allMembers = (await Promise.all(orgIds.map((id: string) =>
            db.select().from(orgMembers).where(eq(orgMembers.orgId, id))
                .catch((e: unknown) => {
                    logger.warn('getMyOrganizations: member lookup fallback', {
                        orgId: id, error: e instanceof Error ? e.message : String(e),
                    });
                    return [];
                }),
        ))).flat();

        // Members show by name, falling back to the email handle. One batched,
        // D1-safe lookup (explicit binds, chunked) for every member of every org.
        let names = new Map<string, string>();
        try {
            const { resolveDisplayNames } = await import('./notifications');
            names = await resolveDisplayNames(
                (allMembers as Array<{ userEmail: string }>).map(m => m.userEmail),
            );
        } catch (e) {
            // Members degrade to their email handle at render; never lose the list.
            logger.warn('getMyOrganizations: member name lookup fallback', {
                user, error: e instanceof Error ? e.message : String(e),
            });
        }

        type OrgRow = { id: string; name: string; createdBy: string; createdAt: Date | null };
        type MemberRow = { id: string; orgId: string; userEmail: string; role: string | null; joinedAt: Date | null };
        return (orgs as OrgRow[]).map((org: OrgRow) => ({
            ...org,
            role: roleMap.get(org.id) || 'member',
            members: (allMembers as MemberRow[])
                .filter((m: MemberRow) => m.orgId === org.id)
                .map((m: MemberRow) => ({
                    id: m.id,
                    userEmail: m.userEmail,
                    role: m.role,
                    joinedAt: m.joinedAt,
                    displayName: names.get(m.userEmail.toLowerCase()) ?? undefined,
                })),
        }));
    } catch (error) {
        logger.error('getMyOrganizations failed', error, { user });
        return [];
    }
}

// ── Update ───────────────────────────────────────────────────────

export async function updateOrganizationName(orgId: string, name: string): Promise<{ success: boolean; error?: string; errorId?: string }> {
    const user = await getUser();
    const db = await getDb();
    if (!db) return { success: false, error: 'Database unavailable' };

    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 100) {
        return { success: false, error: 'Name must be 1–100 characters' };
    }

    try {
        // Verify user is a member
        const membership = await db.select()
            .from(orgMembers)
            .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userEmail, user)))
            .get();

        if (!membership) return { success: false, error: 'Not a member of this organization' };

        if (await nameAlreadyExists(db, trimmed, orgId)) {
            return { success: false, error: 'org_name_exists' };
        }

        await db.update(organizations).set({ name: trimmed }).where(eq(organizations.id, orgId));
        return { success: true };
    } catch (error) {
        const errorId = logger.error('updateOrganizationName failed', error, { user, orgId });
        return { success: false, error: 'Failed to update name', errorId };
    }
}

// ── Leave / Delete ───────────────────────────────────────────────

export async function leaveOrganization(orgId: string): Promise<{ success: boolean; deleted?: boolean; askDocsSource?: boolean; error?: string; errorId?: string }> {
    const user = await getUser();
    const db = await getDb();
    if (!db) return { success: false, error: 'Database unavailable' };

    try {
        // Count members
        const members = await db.select({ id: orgMembers.id })
            .from(orgMembers)
            .where(eq(orgMembers.orgId, orgId));


        const membership = await db.select()
            .from(orgMembers)
            .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userEmail, user)))
            .get();

        if (!membership) return { success: false, error: 'Not a member of this organization' };

        // «Al cambiar de grupos»: no silent switch (leaving the unused group of two
        // keeps «Los míos»; after the delete, a stored group she left becomes
        // «Los míos»), and leaving the group her links used (with a group left)
        // asks which now — decided on her state before the change. Never fails the leave.
        const keep = { email: user, orgId, change: 'leave' as const, op: 'leaveOrganization', ctx: { user } };
        const before = await keepDocsSourceBeforeChange(db, keep);
        const askDocsSource = !!before && shouldAskDocsSource({
            kind: 'leave',
            orgCountAfter: before.memberOrgIds.filter(id => id !== orgId).length,
            leftOrgId: orgId,
            effectiveBefore: effectiveDocsSource(before.raw, before.memberOrgIds, before.flags.brandingOn),
        }, before.flags);

        if (members.length <= 1) {
            // Last member → delete org, invites, and membership
            await db.delete(orgInvites).where(eq(orgInvites.orgId, orgId));
            await db.delete(orgMembers).where(eq(orgMembers.orgId, orgId));
            await db.delete(organizations).where(eq(organizations.id, orgId));
            await keepDocsSourceAfterChange(db, before, keep);
            return { success: true, deleted: true, askDocsSource };
        }

        // Remove only this member
        await db.delete(orgMembers).where(
            and(eq(orgMembers.orgId, orgId), eq(orgMembers.userEmail, user))
        );
        await keepDocsSourceAfterChange(db, before, keep);

        return { success: true, deleted: false, askDocsSource };
    } catch (error) {
        const errorId = logger.error('leaveOrganization failed', error, { user, orgId });
        return { success: false, error: 'Failed to leave organization', errorId };
    }
}

/** Why «Quitar del grupo» was refused; the page shows each in words (organizations.error_*). */
export type RemoveMemberError = 'not_authenticated' | 'not_member' | 'member_not_found' | 'cannot_remove_self' | 'failed';

/**
 * «Quitar del grupo» (G1, Jon 2026-11-08): ANY member removes another member —
 * the group's creator included; the admin page keeps its own removal.
 *
 * Auth: a signed-in member of `orgId`; the target row must belong to that same
 * group (`id` AND `org_id`), so a member of one group can never remove someone
 * from another. Yourself → «Salir» (leaveOrganization), which also deletes a
 * group left empty.
 *
 * What happens to the removed person's records: nothing moves. Records belong
 * to whoever added them (`addedBy`), and the team is computed live from
 * org_members — exactly as when someone leaves with «Salir». So from now on
 * they no longer see the group's records as their team's, and the group no
 * longer sees theirs as the team's (protected contact data is masked again
 * both ways). Audited (`org_member_removed`).
 */
export async function removeOrganizationMember(orgId: string, memberId: string): Promise<{ success: boolean; error?: RemoveMemberError; errorId?: string }> {
    let user = '';
    try {
        user = await getUser();
    } catch (e) {
        logger.warn('organizations: refused, no session', { orgId, error: e instanceof Error ? e.message : String(e) });
        return { success: false, error: 'not_authenticated' };
    }
    try {
        const db = await getDb();
        if (!db) {
            const errorId = logger.error('removeOrganizationMember: database unavailable', new Error('no db'), { user, orgId, memberId });
            return { success: false, error: 'failed', errorId };
        }

        if (!(await isMemberOf(db, orgId, user))) {
            logger.warn('removeOrganizationMember: refused, not a member', { user, orgId, memberId });
            return { success: false, error: 'not_member' };
        }

        const target = await db.select({ id: orgMembers.id, userEmail: orgMembers.userEmail })
            .from(orgMembers)
            .where(and(eq(orgMembers.id, memberId), eq(orgMembers.orgId, orgId)))
            .get() as { id: string; userEmail: string } | undefined;
        if (!target) return { success: false, error: 'member_not_found' };
        if (target.userEmail.trim().toLowerCase() === user.trim().toLowerCase()) return { success: false, error: 'cannot_remove_self' };

        // «Al cambiar de grupos»: she isn't on screen to be asked, so her links
        // keep what they used (e.g. «Los míos» when she drops from two groups to
        // one). Done for the REMOVED person; never fails the removal.
        const keep = { email: target.userEmail, orgId, change: 'removal' as const, op: 'removeOrganizationMember', ctx: { user, memberId }, actorEmail: user };
        const removedBefore = await keepDocsSourceBeforeChange(db, keep);

        await db.delete(orgMembers).where(and(eq(orgMembers.id, memberId), eq(orgMembers.orgId, orgId)));
        await keepDocsSourceAfterChange(db, removedBefore, keep);
        // The removed person saw the invite link on /organizations: replace it, or
        // they could rejoin at once (and, as a member, remove whoever removed them).
        await rotateInviteLink(db, orgId, user);

        logger.info('removeOrganizationMember: removed', { user, orgId, memberId });
        const { logAudit } = await import('@/lib/audit');
        await logAudit({
            userEmail: user,
            action: 'org_member_removed',
            target: orgId,
            details: { orgId, memberId, removedEmail: target.userEmail },
        });

        // F6: tell the removed person, in the app only (member_removed has no email
        // twin). The removal already happened: a failed notice is logged, never undone.
        await runAfterResponse('removeOrganizationMember.notifyRemoved', async () => {
            try {
                const [{ createNotification, resolveDisplayName }, { notificationContent }] = await Promise.all([
                    import('@/app/actions/notifications'), import('@/domain/notificationTemplates'),
                ]);
                const org = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).get() as { name: string } | undefined;
                const actorName = await resolveDisplayName(user);
                const id = await createNotification({
                    userId: target.userEmail,
                    type: 'member_removed',
                    ...notificationContent({ key: 'member_removed', params: { actorName, ...(org?.name ? { orgName: org.name } : {}) } }),
                    url: '/organizations',
                    metadata: { orgId, orgName: org?.name },
                });
                if (!id) logger.warn('removeOrganizationMember: notice to the removed person not created', { user, orgId, memberId });
            } catch (e) {
                logger.warn('removeOrganizationMember: notice to the removed person failed', {
                    user, orgId, memberId, error: e instanceof Error ? e.message : String(e),
                });
            }
        }, { user, orgId, memberId });
        return { success: true };
    } catch (error) {
        const errorId = logger.error('removeOrganizationMember failed', error, { user, orgId, memberId });
        return { success: false, error: 'failed', errorId };
    }
}

// ── Invite ───────────────────────────────────────────────────────

export async function getInviteLink(orgId: string): Promise<{ success: boolean; url?: string; error?: string; errorId?: string }> {
    const user = await getUser();
    const db = await getDb();
    if (!db) return { success: false, error: 'Database unavailable' };

    try {
        // Verify user is a member
        const membership = await db.select()
            .from(orgMembers)
            .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userEmail, user)))
            .get();

        if (!membership) return { success: false, error: 'Not a member' };

        // Reuse the group's link: there is one, and it never expires on its own
        // (G1) — «Generar un enlace nuevo» (regenerateInviteLink) replaces it.
        const existing = await db.select()
            .from(orgInvites)
            .where(eq(orgInvites.orgId, orgId))
            .get();

        if (existing) {
            return { success: true, url: inviteUrl(existing.id) };
        }

        // Create new invite
        const inviteId = crypto.randomUUID();
        await db.insert(orgInvites).values({
            id: inviteId,
            orgId,
            createdBy: user,
        });

        return { success: true, url: inviteUrl(inviteId) };
    } catch (error) {
        const errorId = logger.error('getInviteLink failed', error, { user, orgId });
        return { success: false, error: 'Failed to generate invite link', errorId };
    }
}

/**
 * «Generar un enlace nuevo» (G1): the group's invite link is replaced and the
 * old one stops working at once — joinOrganization and getInvitePreview treat
 * an unknown token as invalid. No automatic expiry (Jon 2026-11-08).
 *
 * Auth: a signed-in member of `orgId`. The new link is written before the old
 * ones are deleted, so the group is never left without a link; every older
 * row of the group goes (not just one).
 */
export async function regenerateInviteLink(orgId: string): Promise<{ success: boolean; url?: string; error?: 'not_authenticated' | 'not_member' | 'failed'; errorId?: string }> {
    let user = '';
    try {
        user = await getUser();
    } catch (e) {
        logger.warn('organizations: refused, no session', { orgId, error: e instanceof Error ? e.message : String(e) });
        return { success: false, error: 'not_authenticated' };
    }
    try {
        const db = await getDb();
        if (!db) {
            const errorId = logger.error('regenerateInviteLink: database unavailable', new Error('no db'), { user, orgId });
            return { success: false, error: 'failed', errorId };
        }

        if (!(await isMemberOf(db, orgId, user))) {
            logger.warn('regenerateInviteLink: refused, not a member', { user, orgId });
            return { success: false, error: 'not_member' };
        }

        const inviteId = await rotateInviteLink(db, orgId, user);

        logger.info('regenerateInviteLink: old invite links revoked', { user, orgId });
        return { success: true, url: inviteUrl(inviteId) };
    } catch (error) {
        const errorId = logger.error('regenerateInviteLink failed', error, { user, orgId });
        return { success: false, error: 'failed', errorId };
    }
}

/**
 * Replace the group's invite link: the new row is written before the old ones
 * are deleted, so the group is never left without one. Caller checks membership.
 */
async function rotateInviteLink(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, orgId: string, user: string): Promise<string> {
    const inviteId = crypto.randomUUID();
    await db.insert(orgInvites).values({ id: inviteId, orgId, createdBy: user });
    await db.delete(orgInvites).where(and(eq(orgInvites.orgId, orgId), ne(orgInvites.id, inviteId)));
    return inviteId;
}

/**
 * The public invite URL: this deploy's own origin when configured, else the
 * real domain for the environment (src/lib/emailConfig.ts). The old fallback
 * was buenadoptante.com, which is not the app's domain.
 */
function inviteUrl(inviteId: string): string {
    const baseUrl = process.env.AUTH_URL || process.env.NEXTAUTH_URL || appBaseUrl();
    return `${baseUrl}/invite/${inviteId}`;
}

/** Is `user` a member of `orgId`? (Same lookup as the other actions here.) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the D1/better-sqlite db union getDb() returns
async function isMemberOf(db: any, orgId: string, user: string): Promise<boolean> {
    const membership = await db.select({ id: orgMembers.id })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userEmail, user)))
        .get();
    return !!membership;
}

// ── Join via Invite ──────────────────────────────────────────────

export async function joinOrganization(inviteToken: string): Promise<{ success: boolean; orgName?: string; askDocsSource?: boolean; error?: string; errorId?: string }> {
    const user = await getUser();
    const db = await getDb();
    if (!db) return { success: false, error: 'Database unavailable' };

    try {
        const invite = await db.select()
            .from(orgInvites)
            .where(eq(orgInvites.id, inviteToken))
            .get();

        if (!invite) return { success: false, error: 'Invalid invite link' };

        // Check expiry
        if (invite.expiresAt && invite.expiresAt < new Date()) {
            return { success: false, error: 'Invite link has expired' };
        }

        // Check if already a member
        const existing = await db.select()
            .from(orgMembers)
            .where(and(eq(orgMembers.orgId, invite.orgId), eq(orgMembers.userEmail, user)))
            .get();

        if (existing) {
            const org = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, invite.orgId)).get();
            return { success: true, orgName: org?.name || 'Organization' };
        }

        const docsBefore = await keepDocsSourceBeforeChange(db, { email: user, orgId: invite.orgId, change: 'join', op: 'joinOrganization', ctx: { user } });

        // Join
        await db.insert(orgMembers).values({
            id: crypto.randomUUID(),
            orgId: invite.orgId,
            userEmail: user,
            role: 'member',
        });

        const org = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, invite.orgId)).get();

        // Notify the members of THIS group about the new member — not the joiner's other groups
        // (after the response, kept alive — see src/lib/background.ts)
        await runAfterResponse('joinOrganization.notifyOrgMembers', async () => {
            const [{ notifyOrgMembers, resolveDisplayName }, { notificationContent }] = await Promise.all([
                import('@/app/actions/notifications'), import('@/domain/notificationTemplates'),
            ]);
            const displayName = await resolveDisplayName(user);
            await notifyOrgMembers({
                actorEmail: user,
                orgId: invite.orgId,
                type: 'member_joined',
                ...notificationContent({ key: 'member_joined', params: { memberName: displayName, ...(org?.name ? { orgName: org.name } : {}) } }),
                url: '/organizations',
                icon: '👋',
                metadata: { orgId: invite.orgId, orgName: org?.name },
            });
        }, { actorEmail: user, orgId: invite.orgId });

        return { success: true, orgName: org?.name || 'Organization', askDocsSource: askAfterJoin(docsBefore, 'join', invite.orgId) };
    } catch (error) {
        const errorId = logger.error('joinOrganization failed', error, { user, inviteToken });
        return { success: false, error: 'Failed to join organization', errorId };
    }
}

// ── Invite preview (no auth required) ────────────────────────────

export async function getInvitePreview(inviteToken: string): Promise<{ orgName: string; memberCount: number } | null> {
    const db = await getDb();
    if (!db) return null;

    try {
        const invite = await db.select()
            .from(orgInvites)
            .where(eq(orgInvites.id, inviteToken))
            .get();

        if (!invite) return null;
        if (invite.expiresAt && invite.expiresAt < new Date()) return null;

        const org = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, invite.orgId)).get();
        if (!org) return null;

        const members = await db.select({ id: orgMembers.id })
            .from(orgMembers)
            .where(eq(orgMembers.orgId, invite.orgId));

        return { orgName: org.name, memberCount: members.length };
    } catch (e) {
        logger.warn('getInvitePreview failed', {
            inviteToken,
            error: e instanceof Error ? e.message : String(e),
        });
        return null;
    }
}

// ── Dashboard helpers ────────────────────────────────────────────

/**
 * Returns all member emails across all the current user's organizations.
 * Used by dashboard queries to scope records: WHERE addedBy IN (these emails).
 */
export async function getOrgMemberEmails(): Promise<string[]> {
    const user = await getUser();
    const db = await getDb();
    if (!db) return [user];

    try {
        // Get all orgs for this user
        const myOrgs = await db.select({ orgId: orgMembers.orgId })
            .from(orgMembers)
            .where(eq(orgMembers.userEmail, user));

        if (myOrgs.length === 0) return [user];

        const orgIds = [...new Set<string>(myOrgs.map((o: { orgId: string }) => o.orgId))];

        // Get all member emails across those orgs. Per-id fan-out, never
        // `inArray`: D1 binds an array as one parameter and drops the rest,
        // which quietly returned a single org's members for multi-org users.
        //
        // Deliberately NO per-id fallback. This list decides who is allowed to
        // see things and who gets told about them, and a half-built list is
        // worse than none: it silently answers with the wrong people. Let a
        // failure reject into the catch below, which returns just the caller.
        const allMembers = (await Promise.all(orgIds.map((id: string) =>
            db.select({ userEmail: orgMembers.userEmail }).from(orgMembers)
                .where(eq(orgMembers.orgId, id)),
        ))).flat();

        const emails = new Set<string>(allMembers.map((m: { userEmail: string }) => m.userEmail));
        emails.add(user); // always include self
        return Array.from(emails);
    } catch (error) {
        logger.error('getOrgMemberEmails failed', error, { user });
        return [user]; // fallback to just the current user
    }
}

// getOrgMemberEmailsFor(email) lives in src/lib/orgMembership.ts: it takes an
// identity as an argument and checks no session, so it must never be an export
// of this 'use server' module (every export here is a browser-callable POST).

