'use server';

import { organizations, orgMembers, orgInvites } from '@/db/schema';
import { eq, and, inArray, sql, ne } from 'drizzle-orm';
import { getDb, getUser } from './_db';
import { logger } from '@/lib/logger';

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

// ── Create ───────────────────────────────────────────────────────

export async function createOrganization(name: string): Promise<{ success: boolean; id?: string; error?: string; errorId?: string }> {
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

        await db.insert(orgMembers).values({
            id: memberId,
            orgId,
            userEmail: user,
            role: 'owner',
        });

        return { success: true, id: orgId };
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

        const orgIds = memberships.map((m: { orgId: string; role: string | null }) => m.orgId);
        const roleMap = new Map<string, string>();
        for (const m of memberships) {
            roleMap.set(m.orgId, m.role || 'member');
        }

        const orgs = await db
            .select()
            .from(organizations)
            .where(inArray(organizations.id, orgIds));

        // Fetch all members for these orgs
        const allMembers = await db
            .select()
            .from(orgMembers)
            .where(inArray(orgMembers.orgId, orgIds));

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

export async function leaveOrganization(orgId: string): Promise<{ success: boolean; deleted?: boolean; error?: string; errorId?: string }> {
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

        if (members.length <= 1) {
            // Last member → delete org, invites, and membership
            await db.delete(orgInvites).where(eq(orgInvites.orgId, orgId));
            await db.delete(orgMembers).where(eq(orgMembers.orgId, orgId));
            await db.delete(organizations).where(eq(organizations.id, orgId));
            return { success: true, deleted: true };
        }

        // Remove only this member
        await db.delete(orgMembers).where(
            and(eq(orgMembers.orgId, orgId), eq(orgMembers.userEmail, user))
        );

        return { success: true, deleted: false };
    } catch (error) {
        const errorId = logger.error('leaveOrganization failed', error, { user, orgId });
        return { success: false, error: 'Failed to leave organization', errorId };
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

        // Reuse existing non-expired invite if available
        const existing = await db.select()
            .from(orgInvites)
            .where(eq(orgInvites.orgId, orgId))
            .get();

        if (existing) {
            const baseUrl = process.env.AUTH_URL || process.env.NEXTAUTH_URL || 'https://buenadoptante.com';
            return { success: true, url: `${baseUrl}/invite/${existing.id}` };
        }

        // Create new invite
        const inviteId = crypto.randomUUID();
        await db.insert(orgInvites).values({
            id: inviteId,
            orgId,
            createdBy: user,
        });

        const baseUrl = process.env.AUTH_URL || process.env.NEXTAUTH_URL || 'https://buenadoptante.com';
        return { success: true, url: `${baseUrl}/invite/${inviteId}` };
    } catch (error) {
        const errorId = logger.error('getInviteLink failed', error, { user, orgId });
        return { success: false, error: 'Failed to generate invite link', errorId };
    }
}

// ── Join via Invite ──────────────────────────────────────────────

export async function joinOrganization(inviteToken: string): Promise<{ success: boolean; orgName?: string; error?: string; errorId?: string }> {
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

        // Join
        await db.insert(orgMembers).values({
            id: crypto.randomUUID(),
            orgId: invite.orgId,
            userEmail: user,
            role: 'member',
        });

        const org = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, invite.orgId)).get();

        // Notify existing org members about the new member (fire-and-forget)
        import('@/app/actions/notifications').then(async ({ notifyOrgMembers, resolveDisplayName }) => {
            const displayName = await resolveDisplayName(user);
            notifyOrgMembers({
                actorEmail: user,
                type: 'member_joined',
                title: '👋 Nuevo miembro',
                body: `${displayName} se unió a ${org?.name || 'la organización'}.`,
                url: '/organizations',
                icon: '👋',
                metadata: { orgId: invite.orgId, orgName: org?.name },
            }).catch((e) => {
                logger.warn('joinOrganization: notifyOrgMembers failed', {
                    actorEmail: user,
                    orgId: invite.orgId,
                    error: e instanceof Error ? e.message : String(e),
                });
            });
        });

        return { success: true, orgName: org?.name || 'Organization' };
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

        const orgIds = myOrgs.map((o: { orgId: string }) => o.orgId);

        // Get all member emails across those orgs
        const allMembers = await db.select({ userEmail: orgMembers.userEmail })
            .from(orgMembers)
            .where(inArray(orgMembers.orgId, orgIds));

        const emails = new Set<string>(allMembers.map((m: { userEmail: string }) => m.userEmail));
        emails.add(user); // always include self
        return Array.from(emails);
    } catch (error) {
        logger.error('getOrgMemberEmails failed', error, { user });
        return [user]; // fallback to just the current user
    }
}

/**
 * Session-free variant: returns all member emails across all organizations
 * that the given email belongs to. Safe to call from unauthenticated contexts
 * (e.g. public API routes) where getUser() would fail.
 */
export async function getOrgMemberEmailsFor(email: string): Promise<string[]> {
    const db = await getDb();
    if (!db) return [email];

    try {
        const myOrgs = await db.select({ orgId: orgMembers.orgId })
            .from(orgMembers)
            .where(eq(orgMembers.userEmail, email));

        if (myOrgs.length === 0) return [email];

        const orgIds = myOrgs.map((o: { orgId: string }) => o.orgId);

        const allMembers = await db.select({ userEmail: orgMembers.userEmail })
            .from(orgMembers)
            .where(inArray(orgMembers.orgId, orgIds));

        const emails = new Set<string>(allMembers.map((m: { userEmail: string }) => m.userEmail));
        emails.add(email);
        return Array.from(emails);
    } catch (error) {
        logger.error('getOrgMemberEmailsFor failed', error, { email });
        return [email];
    }
}

