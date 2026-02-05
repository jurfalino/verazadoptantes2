export const runtime = 'edge';

import { getDb } from "@/app/actions";
import { adopters, adopterFlags, adopterHistory, adopterImages, adopterStats, adoptions, adoptionImages } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";

import { isAdmin } from "@/config/admins";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json() as { adopterId?: string };
        const adopterId = body.adopterId;

        logger.info('Delete adopter API called', { adopterId });

        if (!adopterId) {
            return NextResponse.json({ error: 'Missing adopterId' }, { status: 400 });
        }

        const session = await auth();

        logger.info('Delete attempt debug', {
            adopterId,
            hasSession: !!session,
            userEmail: session?.user?.email || 'no-email',
            isAdminUser: isAdmin(session?.user?.email)
        });

        if (!session?.user?.email || !isAdmin(session.user.email)) {
            logger.warn('Unauthorized delete attempt', {
                adopterId,
                email: session?.user?.email || 'no-session'
            });
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        }

        const db = await getDb();
        if (!db) {
            logger.error('No database for delete', null, { adopterId });
            return NextResponse.json({ error: 'Database unavailable' }, { status: 500 });
        }

        // Get all adoption IDs for this adopter first (to delete their images)
        const adopterAdoptions = await db.select({ id: adoptions.id })
            .from(adoptions)
            .where(eq(adoptions.adopterId, adopterId));
        const adoptionIds = adopterAdoptions.map((a: { id: string }) => a.id);

        // Cascade Delete
        await db.delete(adopterStats).where(eq(adopterStats.adopterId, adopterId));
        await db.delete(adopterFlags).where(eq(adopterFlags.adopterId, adopterId));
        await db.delete(adopterHistory).where(eq(adopterHistory.adopterId, adopterId));
        await db.delete(adopterImages).where(eq(adopterImages.adopterId, adopterId));

        if (adoptionIds.length > 0) {
            await db.delete(adoptionImages).where(inArray(adoptionImages.adoptionId, adoptionIds));
        }

        await db.delete(adoptions).where(eq(adoptions.adopterId, adopterId));
        await db.delete(adopters).where(eq(adopters.id, adopterId));

        logger.info('Adopter deleted successfully', { adopterId, deletedBy: session.user.email });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Delete adopter error:", error);
        logger.error('Delete adopter failed', error, {});
        return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
    }
}
