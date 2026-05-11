export const runtime = 'edge';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { userProfiles, users, orgMembers, organizations } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { getContractBaseUrl } from '@/lib/contractUrl';
import { generateUniqueSlug } from '@/lib/slugify';

/**
 * Returns the signed-in user's showcase identifiers — handle + orgs — and
 * the runtime-resolved Vite-app base URL. Used by the /my-animals dropdown
 * to build shareable showcase URLs.
 *
 * Lazy handle backfill: `user_profiles.handle` was added in v2.14.10 and is
 * normally assigned on sign-in via `ensureUserProfile()`. But users with
 * active sessions from before that deploy still have NULL. We fill it on
 * first visit here so we don't force a re-auth across the user base.
 */
export async function GET() {
    const session = await auth();
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const email = session.user.email;
    const displayName = session.user.name || email.split('@')[0] || 'rescuer';
    try {
        const db = await getDb();
        const contractBase = await getContractBaseUrl();
        if (!db) return NextResponse.json({ handle: null, orgs: [], contractBase });

        const userRow = await db.select({ id: users.id })
            .from(users)
            .where(eq(users.email, email))
            .get();
        let handle: string | null = null;
        if (userRow?.id) {
            const profile = await db.select({ handle: userProfiles.handle })
                .from(userProfiles)
                .where(eq(userProfiles.userId, userRow.id))
                .get();
            handle = profile?.handle ?? null;

            if (!handle) {
                try {
                    const newHandle = await generateUniqueSlug(displayName, async (candidate) => {
                        const taken = await db.select({ userId: userProfiles.userId })
                            .from(userProfiles)
                            .where(eq(userProfiles.handle, candidate))
                            .get();
                        return taken != null;
                    });
                    await db.update(userProfiles)
                        .set({ handle: newHandle })
                        .where(eq(userProfiles.userId, userRow.id))
                        .run();
                    handle = newHandle;
                } catch (e) {
                    logger.warn('my-showcase-info: handle backfill failed', {
                        email,
                        error: e instanceof Error ? e.message : String(e),
                    });
                }
            }
        }

        const memberships = await db.select({ orgId: orgMembers.orgId })
            .from(orgMembers)
            .where(eq(orgMembers.userEmail, email))
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

        return NextResponse.json({ handle, orgs, contractBase });
    } catch (e) {
        logger.warn('GET /api/my-showcase-info failed', {
            error: e instanceof Error ? e.message : String(e),
            email,
        });
        const contractBase = await getContractBaseUrl().catch(() => 'https://adoptions.pages.dev');
        return NextResponse.json({ handle: null, orgs: [], contractBase });
    }
}
