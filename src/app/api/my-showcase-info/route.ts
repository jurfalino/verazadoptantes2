export const runtime = 'edge';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { userProfiles, users, orgMembers, organizations } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/logger';

/**
 * Returns the signed-in user's showcase identifiers — their handle and the
 * orgs they belong to. Used by the /my-animals copy-chip section to build
 * the URLs the rescuer can share. Authenticated; 401 if not signed in.
 */
export async function GET() {
    const session = await auth();
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    try {
        const db = await getDb();
        if (!db) return NextResponse.json({ handle: null, orgs: [] });

        const userRow = await db.select({ id: users.id })
            .from(users)
            .where(eq(users.email, session.user.email))
            .get();
        let handle: string | null = null;
        if (userRow?.id) {
            const profile = await db.select({ handle: userProfiles.handle })
                .from(userProfiles)
                .where(eq(userProfiles.userId, userRow.id))
                .get();
            handle = profile?.handle ?? null;
        }

        const memberships = await db.select({ orgId: orgMembers.orgId })
            .from(orgMembers)
            .where(eq(orgMembers.userEmail, session.user.email))
            .all() as { orgId: string }[];
        const orgs: Array<{ name: string; slug: string }> = [];
        // Per CLAUDE.md, no inArray on D1. Fan out with eq().
        await Promise.all(memberships.map(async (m) => {
            const org = await db.select({ name: organizations.name, slug: organizations.slug })
                .from(organizations)
                .where(eq(organizations.id, m.orgId))
                .get();
            if (org?.slug) orgs.push({ name: org.name, slug: org.slug });
        }));

        return NextResponse.json({ handle, orgs });
    } catch (e) {
        logger.warn('GET /api/my-showcase-info failed', {
            error: e instanceof Error ? e.message : String(e),
            email: session.user.email,
        });
        return NextResponse.json({ handle: null, orgs: [] });
    }
}
