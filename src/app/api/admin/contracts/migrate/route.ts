// One-time move of signed contracts out of the PUBLIC images bucket
// (contracts/{animalId}/signed-contract.*) into private storage
// (src/lib/contractStorage.ts). Admin only. Three steps, each its own call:
//   GET                    → what would move (nothing written)
//   POST                   → copy each file, verify the copy, repoint the records
//   POST ?deletePublic=1   → delete the public copies of contracts ALREADY moved
// Deleting can't be undone, so it only touches files whose private copy is on a record.
import { NextResponse } from 'next/server';
import { and, eq, like } from 'drizzle-orm';
import { placements, signedContracts } from '@/db/schema';
import { getDb } from '@/lib/db';
import { getRequestContext } from '@/lib/requestContext';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { adminEmailOr401 } from '@/lib/api/sessionGuards';
import { contractKeyOf, readContract, storeContract } from '@/lib/contractStorage';

export const runtime = 'edge';

type Bucket = {
    get: (k: string) => Promise<{ arrayBuffer: () => Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } } | null>;
    head: (k: string) => Promise<unknown | null>;
    delete: (k: string) => Promise<void>;
};

function publicKeyOf(comments: string | null): string | null {
    if (!comments) return null;
    try {
        const url = (JSON.parse(comments) as { contractScreenshot?: unknown }).contractScreenshot;
        if (typeof url !== 'string') return null;
        const m = url.match(/^https:\/\/[^/]+\.r2\.dev\/(contracts\/.+)$/);
        return m ? m[1] : null;
    } catch { return null; } // a plain note: no contract on it
}

async function legacyRows(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
    const rows = await db.select({ id: placements.id, animalId: placements.animalId, comments: placements.comments })
        .from(placements).where(like(placements.comments, '%contractScreenshot%')).all() as Array<{ id: string; animalId: string; comments: string | null }>;
    return rows.map(r => ({ ...r, publicKey: publicKeyOf(r.comments) })).filter(r => r.publicKey);
}

export async function GET() {
    const admin = await adminEmailOr401();
    if (admin instanceof NextResponse) return admin;
    const db = await getDb();
    if (!db) return NextResponse.json({ error: 'database unavailable' }, { status: 500 });
    const rows = await legacyRows(db);
    // Animals signed more than once shared ONE public file: earlier contracts were overwritten.
    const overwritten = await db.select({ animalId: signedContracts.animalId }).from(signedContracts).all() as Array<{ animalId: string }>;
    const counts = new Map<string, number>();
    for (const r of overwritten) counts.set(r.animalId, (counts.get(r.animalId) ?? 0) + 1);
    return NextResponse.json({
        toMove: rows.map(r => ({ placementId: r.id, animalId: r.animalId, publicKey: r.publicKey })),
        animalsSignedMoreThanOnce: [...counts].filter(([, n]) => n > 1).map(([animalId, n]) => ({ animalId, signings: n })),
    });
}

export async function POST(request: Request) {
    const admin = await adminEmailOr401();
    if (admin instanceof NextResponse) return admin;
    const deletePublic = new URL(request.url).searchParams.get('deletePublic') === '1';
    const db = await getDb();
    if (!db) return NextResponse.json({ error: 'database unavailable' }, { status: 500 });
    const images = (getRequestContext().env as unknown as Record<string, unknown>).IMAGES_BUCKET as Bucket | undefined;
    if (!images) return NextResponse.json({ error: 'IMAGES_BUCKET not configured' }, { status: 500 });

    if (deletePublic) {
        // Only public files whose contract now sits in private storage on a record.
        const moved = await db.select({ comments: placements.comments }).from(placements).where(like(placements.comments, '%movedFrom%')).all() as Array<{ comments: string | null }>;
        const deleted: string[] = [];
        for (const m of moved) {
            let from: string | null = null;
            try { from = (JSON.parse(m.comments ?? '{}') as { movedFrom?: string }).movedFrom ?? null; } catch (e) {
                logger.warn('contracts migrate: unreadable moved record', { error: e instanceof Error ? e.message : String(e) });
            }
            const key = contractKeyOf(m.comments);
            if (!from || !key || !(await readContract(key))) continue; // never delete without a verified private copy
            if (await images.head(from)) { await images.delete(from); deleted.push(from); }
        }
        logAudit({ userEmail: admin, action: 'contracts_public_copies_deleted', details: { count: deleted.length } });
        logger.info('contracts migrate: public copies deleted', { admin, count: deleted.length });
        return NextResponse.json({ deleted });
    }

    const results: Array<{ placementId: string; animalId: string; status: 'moved' | 'missing' | 'failed'; errorId?: string }> = [];
    for (const r of await legacyRows(db)) {
        try {
            const obj = await images.get(r.publicKey!);
            if (!obj) { results.push({ placementId: r.id, animalId: r.animalId, status: 'missing' }); continue; }
            const contentType = obj.httpMetadata?.contentType ?? 'application/pdf';
            const { key } = await storeContract(await obj.arrayBuffer(), contentType, { animalId: r.animalId, migration: true });
            if (!(await readContract(key))) throw new Error('private copy not readable after write');
            await db.update(placements).set({ comments: JSON.stringify({ contractKey: key, movedFrom: r.publicKey }) }).where(eq(placements.id, r.id));
            await db.update(signedContracts).set({ fileKey: key }).where(and(eq(signedContracts.animalId, r.animalId), eq(signedContracts.fileKey, r.publicKey!)));
            results.push({ placementId: r.id, animalId: r.animalId, status: 'moved' });
        } catch (e) {
            const errorId = logger.error('contracts migrate: move failed', e, { placementId: r.id, animalId: r.animalId });
            results.push({ placementId: r.id, animalId: r.animalId, status: 'failed', errorId });
        }
    }
    logAudit({ userEmail: admin, action: 'contracts_moved_to_private', details: { moved: results.filter(x => x.status === 'moved').length, missing: results.filter(x => x.status === 'missing').length, failed: results.filter(x => x.status === 'failed').length } });
    return NextResponse.json({ results });
}
