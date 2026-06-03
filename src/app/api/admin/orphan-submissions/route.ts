export const runtime = 'edge';

/**
 * GET /api/admin/orphan-submissions
 *
 * Admin-only triage feed: every form_submissions row that never got linked to
 * an adopter. These exist when the Phase 1 auto-create either predated the
 * submission or threw at submit time (the route catches the throw and lets
 * the form_submission persist without a linked adopter — silent half-failure).
 *
 * The /admin/users page renders this list with a "Vincular ahora" action that
 * fires the recovery endpoint below.
 */

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { formSubmissions, adoptions } from '@/db/schema';
import { eq, isNull, desc } from 'drizzle-orm';
import { auth } from '@/auth';
import { isAdminAsync } from '@/config/admins';
import { logger } from '@/lib/logger';

export async function GET() {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const db = await getDb();
        if (!db) throw new Error('Database not available');

        type Row = {
            id: string;
            rescuerEmail: string;
            name: string;
            email: string | null;
            phone: string | null;
            address: string | null;
            status: string | null;
            createdAt: Date | null;
            selectedAnimalId: string | null;
        };

        const rows = await db
            .select({
                id: formSubmissions.id,
                rescuerEmail: formSubmissions.userId,
                name: formSubmissions.name,
                email: formSubmissions.email,
                phone: formSubmissions.phone,
                address: formSubmissions.address,
                status: formSubmissions.status,
                createdAt: formSubmissions.createdAt,
                selectedAnimalId: formSubmissions.selectedAnimalId,
            })
            .from(formSubmissions)
            .where(isNull(formSubmissions.linkedAdopterId))
            .orderBy(desc(formSubmissions.createdAt))
            .limit(100) as unknown as Row[];

        // Look up animal names — D1-safe per-id Promise.all (no inArray).
        const animalNames = new Map<string, string>();
        const uniqueAnimalIds: string[] = Array.from(
            new Set(rows.map(r => r.selectedAnimalId).filter((x: string | null): x is string => !!x))
        );
        await Promise.all(uniqueAnimalIds.map(async (id: string) => {
            const row = await db.select({ name: adoptions.animalName }).from(adoptions).where(eq(adoptions.id, id)).get()
                .catch(() => null) as { name: string | null } | null;
            if (row?.name) animalNames.set(id, row.name);
        }));

        const enriched = rows.map(r => ({
            ...r,
            createdAt: r.createdAt ? Math.floor(r.createdAt.getTime() / 1000) : null,
            selectedAnimalName: r.selectedAnimalId ? animalNames.get(r.selectedAnimalId) ?? null : null,
        }));

        return NextResponse.json({ submissions: enriched });
    } catch (error) {
        const errorId = logger.error('admin/orphan-submissions GET failed', error);
        return NextResponse.json({ error: `Failed (Error ID: ${errorId})` }, { status: 500 });
    }
}
