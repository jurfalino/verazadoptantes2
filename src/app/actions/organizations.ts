'use server';

import { organizations, orgMembers, orgInvites } from '@/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { getDb, getUser } from './_db';
import { logger } from '@/lib/logger';

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

export async function createOrganization(name: string): Promise<{ success: boolean; id?: string; error?: string }> {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 100) {
        return { success: false, error: 'Name must be 1–100 characters' };
    }

    try {
        const user = await getUser();
        const db = await getDb();
        if (!db) return { success: false, error: 'Database unavailable' };
        const orgId = crypto.randomUUID();
        const memberId = crypto.randomUUID();

        await db.insert(organizations).values({
            id: orgId,
            name: trimmed,
            createdBy: user,
        });

        await db.insert(orgMembers).values({
            id: memberId,
            orgId,
            userEmail: user,
            role: 'owner',
        });

        return { success: true, id: orgId };
    } catch (error) {
        logger.error('createOrganization failed', { error: error instanceof Error ? error.message : String(error) });
        return { success: false, error: 'Failed to create organization' };
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
        logger.error('getMyOrganizations failed', { error: error instanceof Error ? error.message : String(error) });
        return [];
    }
}

// ── Update ───────────────────────────────────────────────────────

export async function updateOrganizationName(orgId: string, name: string): Promise<{ success: boolean; error?: string }> {
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

        await db.update(organizations).set({ name: trimmed }).where(eq(organizations.id, orgId));
        return { success: true };
    } catch (error) {
        logger.error('updateOrganizationName failed', { error: error instanceof Error ? error.message : String(error) });
        return { success: false, error: 'Failed to update name' };
    }
}

// ── Leave / Delete ───────────────────────────────────────────────

export async function leaveOrganization(orgId: string): Promise<{ success: boolean; deleted?: boolean; error?: string }> {
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
        logger.error('leaveOrganization failed', { error: error instanceof Error ? error.message : String(error) });
        return { success: false, error: 'Failed to leave organization' };
    }
}

// ── Invite ───────────────────────────────────────────────────────

export async function getInviteLink(orgId: string): Promise<{ success: boolean; url?: string; error?: string }> {
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
        logger.error('getInviteLink failed', { error: error instanceof Error ? error.message : String(error) });
        return { success: false, error: 'Failed to generate invite link' };
    }
}

// ── Join via Invite ──────────────────────────────────────────────

export async function joinOrganization(inviteToken: string): Promise<{ success: boolean; orgName?: string; error?: string }> {
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
            }).catch(() => {});
        });

        return { success: true, orgName: org?.name || 'Organization' };
    } catch (error) {
        logger.error('joinOrganization failed', { error: error instanceof Error ? error.message : String(error) });
        return { success: false, error: 'Failed to join organization' };
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
    } catch {
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
        logger.error('getOrgMemberEmails failed', { error: error instanceof Error ? error.message : String(error) });
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
        logger.error('getOrgMemberEmailsFor failed', { error: error instanceof Error ? error.message : String(error) });
        return [email];
    }
}

