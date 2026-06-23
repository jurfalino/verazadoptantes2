export const runtime = 'edge';

import { getDb } from "@/app/actions";
import { adopters, adopterFlags, adopterHistory, adopterImages, adopterStats, adoptions, duplicateTokens, duplicateCandidates, formSubmissions } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";

import { isAdminAsync } from "@/config/admins";

export async function POST(request: NextRequest) {
    let adopterId: string | undefined;
    let actorEmail: string | undefined;
    try {
        const body = await request.json() as { adopterId?: string };
        adopterId = body.adopterId;

        logger.info('Delete adopter API called', { adopterId, user: 'pre-auth' });

        if (!adopterId) {
            return NextResponse.json({ error: 'Missing adopterId' }, { status: 400 });
        }

        const session = await auth();

        logger.info('Delete attempt debug', {
            adopterId,
            hasSession: !!session,
            userEmail: session?.user?.email || 'no-email',
            isAdminUser: await isAdminAsync(session?.user?.email)
        });

        actorEmail = session?.user?.email || undefined;

        if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
            logger.warn('Unauthorized delete attempt', {
                adopterId,
                email: session?.user?.email || 'no-session'
            });
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        }

        const db = await getDb();
        if (!db) {
            logger.error('No database for delete', null, { adopterId, user: session.user.email });
            return NextResponse.json({ error: 'Database unavailable' }, { status: 500 });
        }

        // Cascade delete all related data. Must mirror deleteOwnAdopter's
        // cascade (adopters.ts) exactly. v2.19.69: added the three child tables
        // this route previously skipped — duplicate_tokens, duplicate_candidates,
        // and the form_submissions FK. Leaving them orphaned the fuzzy-match
        // index, so a deleted adopter still surfaced as a false duplicate on
        // re-import.
        await db.delete(adopterStats).where(eq(adopterStats.adopterId, adopterId));
        await db.delete(adopterFlags).where(eq(adopterFlags.adopterId, adopterId));
        await db.delete(adopterHistory).where(eq(adopterHistory.adopterId, adopterId));
        await db.delete(adopterImages).where(eq(adopterImages.adopterId, adopterId));
        await db.delete(adoptions).where(eq(adoptions.adopterId, adopterId));
        await db.delete(duplicateTokens).where(eq(duplicateTokens.adopterId, adopterId));
        await db.delete(duplicateCandidates).where(sql`${duplicateCandidates.adopter1Id} = ${adopterId} OR ${duplicateCandidates.adopter2Id} = ${adopterId}`);
        await db.update(formSubmissions).set({ linkedAdopterId: null }).where(eq(formSubmissions.linkedAdopterId, adopterId));
        await db.delete(adopters).where(eq(adopters.id, adopterId));

        logger.info('Adopter deleted successfully', { adopterId, deletedBy: session.user.email });

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Delete adopter failed', error, { adopterId, actorEmail });
        return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
    }
}
