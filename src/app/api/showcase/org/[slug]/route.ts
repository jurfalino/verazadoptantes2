export const runtime = 'edge';
import { NextResponse } from 'next/server';
import { withCors, corsPreflightResponse } from '@/lib/cors';
import { logger } from '@/lib/logger';
import { adoptions, organizations, orgMembers } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { availableAnimalsBase, availableAnimalsOrder, buildPublicRescuer, fetchAnimalImages, pickPublicAnimal } from '@/lib/showcase';

/** GET /api/showcase/org/[slug] — public list of an org's available animals.
 *  Scoping: org slug → org id → members emails → adoptions.addedBy match.
 *  Org name + slug returned alongside so the Vite page can render the header.
 */
export async function OPTIONS(req: Request) {
    return corsPreflightResponse(req.headers.get('origin'));
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
    const origin = request.headers.get('origin');
    const { slug } = await params;
    try {
        const db = await getDb();
        if (!db) return withCors(NextResponse.json({ error: 'Database unavailable' }, { status: 500 }), origin);

        const org = await db.select({ id: organizations.id, name: organizations.name, slug: organizations.slug })
            .from(organizations)
            .where(eq(organizations.slug, slug))
            .get();
        if (!org) {
            return withCors(NextResponse.json({ error: 'Org not found' }, { status: 404 }), origin);
        }

        // Member emails for this org
        const members = await db.select({ userEmail: orgMembers.userEmail })
            .from(orgMembers)
            .where(eq(orgMembers.orgId, org.id))
            .all() as { userEmail: string }[];
        const memberSet = new Set(members.map((m) => m.userEmail));

        if (memberSet.size === 0) {
            return withCors(NextResponse.json({
                org: { name: org.name, slug: org.slug },
                animals: [],
            }, { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=600' } }), origin);
        }

        // Per CLAUDE.md: no inArray in D1. Fetch per-member then merge,
        // dedup-sorted by date desc client-side here.
        const perMember = await Promise.all([...memberSet].map(async (email) => {
            return db.select()
                .from(adoptions)
                .where(and(availableAnimalsBase(), eq(adoptions.addedBy, email)))
                .orderBy(availableAnimalsOrder())
                .limit(60)
                .all() as Promise<typeof adoptions.$inferSelect[]>;
        }));
        const rows = perMember.flat()
            .sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));

        const ids = rows.map((r) => r.id);
        const imagesByAnimal = await fetchAnimalImages(db, ids);

        // v2.14.10-12: skip photoless animals (rule mirrored across all
        // showcase list routes; rescuers see the hidden-when-photoless
        // notice in the /my-animals share modal).
        const rescuerCache = new Map<string, ReturnType<typeof buildPublicRescuer>>();
        const animals = [];
        for (const row of rows) {
            const animalImages = imagesByAnimal.get(row.id) || [];
            if (animalImages.length === 0) continue;
            const key = row.addedBy || '';
            if (!rescuerCache.has(key)) rescuerCache.set(key, buildPublicRescuer(db, row.addedBy));
            const rescuer = await rescuerCache.get(key)!;
            animals.push(pickPublicAnimal(row, animalImages, rescuer));
        }

        return withCors(NextResponse.json({
            org: { name: org.name, slug: org.slug },
            animals,
        }, { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=600' } }), origin);
    } catch (e) {
        const errorId = logger.error('GET /api/showcase/org/[slug] failed', e, { slug });
        return withCors(NextResponse.json({ error: 'Failed to load org animals', errorId }, { status: 500 }), origin);
    }
}
