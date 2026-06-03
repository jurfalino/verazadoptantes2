export const runtime = 'edge';

/**
 * POST /api/admin/orphan-submissions/[id]/retry
 *
 * Admin recovery action for an orphan form_submission (linked_adopter_id IS NULL).
 * Runs the same factory the form-submit route uses, then writes the link back.
 * Idempotent: a row that's already linked returns 200 with the existing id.
 */

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { formSubmissions } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { isAdminAsync } from '@/config/admins';
import { logger } from '@/lib/logger';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id: submissionId } = await params;
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const db = await getDb();
        if (!db) throw new Error('Database not available');

        const sub = await db.select().from(formSubmissions).where(eq(formSubmissions.id, submissionId)).get();
        if (!sub) return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
        if (sub.linkedAdopterId) {
            return NextResponse.json({ success: true, adopterId: sub.linkedAdopterId, alreadyLinked: true });
        }

        const { createAdopterFromSubmission } = await import('@/app/actions/_adopterFactory');
        const result = await createAdopterFromSubmission({
            source: 'form',
            name: sub.name,
            addedBy: sub.userId,
            email: sub.email,
            phone: sub.phone,
            address: sub.address,
            submissionId: sub.id,
            animalId: sub.selectedAnimalId ?? null,
            animalName: sub.selectedAnimalName ?? null,
        });

        await db.update(formSubmissions)
            .set({ linkedAdopterId: result.adopterId, status: 'linked' })
            .where(eq(formSubmissions.id, submissionId));

        logger.info('Admin orphan-submission recovered', {
            submissionId, adopterId: result.adopterId, actor: session.user.email,
        });

        return NextResponse.json({
            success: true,
            adopterId: result.adopterId,
            dupCandidates: result.dupCandidates.length,
        });
    } catch (error) {
        const errorId = logger.error('admin/orphan-submissions retry failed', error, { submissionId });
        return NextResponse.json({ error: `Failed (Error ID: ${errorId})` }, { status: 500 });
    }
}
