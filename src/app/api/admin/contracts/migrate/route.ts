// One-time move of signed contracts out of the PUBLIC images bucket into
// private storage (src/lib/contractStorage.ts). Admin only.
//   GET   → what would move (nothing written)
//   POST  → per contract: copy, verify the private copy, link it in
//           placements.contract_key, THEN delete the public file.
// Only ever touches the exact legacy file of the record's own animal
// (contracts/{animalId}/signed-contract.{pdf|png|jpg} on our public bucket
// URL): a rescuer can write `comments`, so nothing else in it is trusted.
// Production has no legacy contracts; this exists for staging's test ones.
import { NextResponse } from 'next/server';
import { and, eq, isNull, like } from 'drizzle-orm';
import { placements, signedContracts } from '@/db/schema';
import { getDb } from '@/lib/db';
import { getRequestContext } from '@/lib/requestContext';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { adminEmailOr401 } from '@/lib/api/sessionGuards';
import { contractExists, storeContract } from '@/lib/contractStorage';
import { R2_PUBLIC_URL } from '@/lib/r2';

export const runtime = 'edge';

type Bucket = {
    get: (k: string) => Promise<{ arrayBuffer: () => Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } } | null>;
    delete: (k: string) => Promise<void>;
};

/** The legacy public key for this animal, only if the comment points exactly at it on OUR public bucket. */
function legacyKeyFor(comments: string | null, animalId: string, publicBase: string): string | null {
    if (!comments || !publicBase) return null;
    let url: unknown;
    try { url = (JSON.parse(comments) as { contractScreenshot?: unknown }).contractScreenshot; } catch { return null; } // a plain note
    if (typeof url !== 'string') return null;
    for (const ext of ['pdf', 'png', 'jpg']) {
        const key = `contracts/${animalId}/signed-contract.${ext}`;
        if (url === `${publicBase.replace(/\/$/, '')}/${key}`) return key;
    }
    return null;
}

async function legacyRows(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, publicBase: string) {
    const rows = await db.select({ id: placements.id, animalId: placements.animalId, comments: placements.comments })
        .from(placements).where(and(like(placements.comments, '%contractScreenshot%'), isNull(placements.contractKey))).all() as Array<{ id: string; animalId: string; comments: string | null }>;
    return rows.map(r => ({ ...r, publicKey: legacyKeyFor(r.comments, r.animalId, publicBase) })).filter(r => r.publicKey);
}

function publicBase(): string {
    return R2_PUBLIC_URL; // the photos bucket's public address, where legacy contracts sit
}

export async function GET() {
    const admin = await adminEmailOr401();
    if (admin instanceof NextResponse) return admin;
    const db = await getDb();
    if (!db) return NextResponse.json({ error: 'database unavailable' }, { status: 500 });
    const rows = await legacyRows(db, publicBase());
    // Animals signed more than once shared ONE public file: earlier contracts were overwritten.
    const signings = await db.select({ animalId: signedContracts.animalId }).from(signedContracts).all() as Array<{ animalId: string }>;
    const counts = new Map<string, number>();
    for (const r of signings) counts.set(r.animalId, (counts.get(r.animalId) ?? 0) + 1);
    return NextResponse.json({
        toMove: rows.map(r => ({ placementId: r.id, animalId: r.animalId, publicKey: r.publicKey })),
        animalsSignedMoreThanOnce: [...counts].filter(([, n]) => n > 1).map(([animalId, n]) => ({ animalId, signings: n })),
    });
}

export async function POST() {
    const admin = await adminEmailOr401();
    if (admin instanceof NextResponse) return admin;
    const db = await getDb();
    if (!db) return NextResponse.json({ error: 'database unavailable' }, { status: 500 });
    const images = (getRequestContext().env as unknown as Record<string, unknown>).IMAGES_BUCKET as Bucket | undefined;
    if (!images) return NextResponse.json({ error: 'IMAGES_BUCKET not configured' }, { status: 500 });

    const results: Array<{ placementId: string; animalId: string; status: 'moved' | 'missing' | 'failed'; publicDeleted?: boolean; errorId?: string }> = [];
    for (const r of await legacyRows(db, publicBase())) {
        try {
            const obj = await images.get(r.publicKey!);
            if (!obj) { results.push({ placementId: r.id, animalId: r.animalId, status: 'missing' }); continue; }
            const contentType = obj.httpMetadata?.contentType ?? 'application/pdf';
            const stored = await storeContract(await obj.arrayBuffer(), contentType, { animalId: r.animalId, migration: true });
            if (!(await contractExists(stored.key, r.animalId))) throw new Error('private copy not found after write');
            // Link it (server-only column) and drop the public URL from the comment.
            let rest: Record<string, unknown> = {};
            try { rest = JSON.parse(r.comments ?? '{}'); } catch { rest = {}; } // legacyKeyFor already parsed it
            delete rest.contractScreenshot;
            await db.update(placements).set({
                contractKey: stored.key, contractSha256: stored.sha256,
                comments: Object.keys(rest).length ? JSON.stringify(rest) : null,
            }).where(eq(placements.id, r.id));
            await db.update(signedContracts).set({ fileKey: stored.key })
                .where(and(eq(signedContracts.animalId, r.animalId), eq(signedContracts.fileKey, r.publicKey!)));
            // Approved (Jon, 2026-10-13): delete the public copy once the private one is verified and linked.
            await images.delete(r.publicKey!);
            results.push({ placementId: r.id, animalId: r.animalId, status: 'moved', publicDeleted: true });
        } catch (e) {
            const errorId = logger.error('contracts migrate: move failed', e, { placementId: r.id, animalId: r.animalId });
            results.push({ placementId: r.id, animalId: r.animalId, status: 'failed', errorId });
        }
    }
    const tally = { moved: results.filter(x => x.status === 'moved').length, missing: results.filter(x => x.status === 'missing').length, failed: results.filter(x => x.status === 'failed').length };
    logAudit({ userEmail: admin, action: 'contracts_moved_to_private', details: tally });
    logger.info('contracts migrate: done', { admin, ...tally });
    return NextResponse.json({ results });
}
