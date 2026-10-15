// One-time move of signed contracts out of the PUBLIC images bucket into
// private storage (src/lib/contractStorage.ts). Admin only.
//   GET   → what would move (nothing written)
//   POST  → per file: copy, verify the private copy, link it, delete the
//           public file, and only THEN drop the old URL from the record — so a
//           failed delete is simply retried by running it again.
// Only ever touches the exact legacy file of the record's own animal
// (contracts/{animalId}/signed-contract.{pdf|png|jpg} on our public bucket
// URL): a rescuer can write `comments`, so nothing else in it is trusted.
// Production has no legacy contracts; this exists for staging's test ones.
import { NextResponse } from 'next/server';
import { and, eq, like } from 'drizzle-orm';
import { adopterImages, formSubmissions, notifications, placements, signedContracts } from '@/db/schema';
import { getDb } from '@/lib/db';
import { getRequestContext } from '@/lib/requestContext';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { adminEmailOr401 } from '@/lib/api/sessionGuards';
import { contractExists, readSelfie, storeContract, storeSelfie } from '@/lib/contractStorage';
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
    // Still carrying the old URL: not moved yet, or moved but its public copy not yet deleted.
    const rows = await db.select({ id: placements.id, animalId: placements.animalId, comments: placements.comments, contractKey: placements.contractKey })
        .from(placements).where(like(placements.comments, '%contractScreenshot%')).all() as Array<{ id: string; animalId: string; comments: string | null; contractKey: string | null }>;
    return rows.map(r => ({ ...r, publicKey: legacyKeyFor(r.comments, r.animalId, publicBase) })).filter(r => r.publicKey);
}

/** A legacy public selfie: forms/{form owner}/{uuid}.{jpg|png} on our public bucket — server-written, still checked. */
function legacySelfieKeyFor(url: string | null, owner: string, publicBase: string): string | null {
    if (!url || !owner) return null;
    const m = url.match(/^(.+)\/(forms\/(.+)\/[0-9a-f-]{36}\.(jpg|png))$/);
    if (!m || m[1] !== publicBase.replace(/\/$/, '') || m[3] !== owner) return null;
    return m[2];
}

async function legacySelfies(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, publicBase: string) {
    const rows = await db.select({ id: formSubmissions.id, userId: formSubmissions.userId, selfieUrl: formSubmissions.selfieUrl, selfieKey: formSubmissions.selfieKey, notificationId: formSubmissions.notificationId })
        .from(formSubmissions).where(like(formSubmissions.selfieUrl, '%/forms/%')).all() as Array<{ id: string; userId: string; selfieUrl: string | null; selfieKey: string | null; notificationId: string | null }>;
    return rows.map(r => ({ ...r, publicKey: legacySelfieKeyFor(r.selfieUrl, r.userId, publicBase) })).filter(r => r.publicKey);
}

function publicBase(): string {
    return R2_PUBLIC_URL; // the photos bucket's public address, where legacy files sit
}

/** Replace the old selfie URL inside a JSON blob (answers, notification payload) with a marker. */
function scrubUrl(json: string | null, url: string): string | null {
    return json && json.includes(url) ? json.split(url).join('[private]') : json;
}

export async function GET() {
    const admin = await adminEmailOr401();
    if (admin instanceof NextResponse) return admin;
    const db = await getDb();
    if (!db) return NextResponse.json({ error: 'database unavailable' }, { status: 500 });
    const rows = await legacyRows(db, publicBase());
    const selfies = await legacySelfies(db, publicBase());
    // Animals signed more than once shared ONE public file: earlier contracts were overwritten.
    const signings = await db.select({ animalId: signedContracts.animalId }).from(signedContracts).all() as Array<{ animalId: string }>;
    const counts = new Map<string, number>();
    for (const r of signings) counts.set(r.animalId, (counts.get(r.animalId) ?? 0) + 1);
    return NextResponse.json({
        toMove: rows.map(r => ({ placementId: r.id, animalId: r.animalId, publicKey: r.publicKey, alreadyCopied: !!r.contractKey })),
        selfiesToMove: selfies.map(r => ({ submissionId: r.id, publicKey: r.publicKey, alreadyCopied: !!r.selfieKey })),
        animalsSignedMoreThanOnce: [...counts].filter(([, n]) => n > 1).map(([animalId, n]) => ({ animalId, signings: n })),
    });
}

type Result = { id: string; status: 'moved' | 'missing' | 'failed'; publicDeleted?: boolean; errorId?: string };

export async function POST() {
    const admin = await adminEmailOr401();
    if (admin instanceof NextResponse) return admin;
    const db = await getDb();
    if (!db) return NextResponse.json({ error: 'database unavailable' }, { status: 500 });
    const images = (getRequestContext().env as unknown as Record<string, unknown>).IMAGES_BUCKET as Bucket | undefined;
    if (!images) return NextResponse.json({ error: 'IMAGES_BUCKET not configured' }, { status: 500 });

    const contracts: Result[] = [];
    for (const r of await legacyRows(db, publicBase())) {
        try {
            let key = r.contractKey;
            if (!key) {
                const obj = await images.get(r.publicKey!);
                if (!obj) { contracts.push({ id: r.animalId, status: 'missing' }); continue; }
                const stored = await storeContract(await obj.arrayBuffer(), obj.httpMetadata?.contentType ?? 'application/pdf', { animalId: r.animalId, migration: true });
                if (!(await contractExists(stored.key, r.animalId))) throw new Error('private copy not found after write');
                await db.update(placements).set({ contractKey: stored.key, contractSha256: stored.sha256 }).where(eq(placements.id, r.id));
                await db.update(signedContracts).set({ fileKey: stored.key })
                    .where(and(eq(signedContracts.animalId, r.animalId), eq(signedContracts.fileKey, r.publicKey!)));
                key = stored.key;
            }
            // Approved (Jon, 2026-10-13): delete the public copy once the private one is verified and linked.
            await images.delete(r.publicKey!);
            let rest: Record<string, unknown> = {};
            try { rest = JSON.parse(r.comments ?? '{}'); } catch { rest = {}; } // legacyKeyFor already parsed it
            delete rest.contractScreenshot;
            await db.update(placements).set({ comments: Object.keys(rest).length ? JSON.stringify(rest) : null }).where(eq(placements.id, r.id));
            contracts.push({ id: r.animalId, status: 'moved', publicDeleted: true });
        } catch (e) {
            contracts.push({ id: r.animalId, status: 'failed', errorId: logger.error('contracts migrate: move failed', e, { placementId: r.id, animalId: r.animalId }) });
        }
    }

    // Form selfies: same steps. A public copy already used as a profile photo
    // (adopter_images points at it) stays: that photo was put there on purpose.
    const selfies: Result[] = [];
    for (const r of await legacySelfies(db, publicBase())) {
        try {
            if (!r.selfieKey) {
                const obj = await images.get(r.publicKey!);
                if (!obj) { selfies.push({ id: r.id, status: 'missing' }); continue; }
                const stored = await storeSelfie(await obj.arrayBuffer(), obj.httpMetadata?.contentType ?? 'image/jpeg', r.id);
                if (!(await readSelfie(stored.key, r.id))) throw new Error('private copy not readable after write');
                await db.update(formSubmissions).set({ selfieKey: stored.key }).where(eq(formSubmissions.id, r.id));
            }
            const usedAsPhoto = await db.select({ id: adopterImages.id }).from(adopterImages).where(eq(adopterImages.url, r.selfieUrl!)).get();
            if (!usedAsPhoto) await images.delete(r.publicKey!);
            // Only now: no copy of the old URL is left in the answers or the notification.
            const sub = await db.select({ answersJson: formSubmissions.answersJson }).from(formSubmissions).where(eq(formSubmissions.id, r.id)).get();
            await db.update(formSubmissions).set({ selfieUrl: null, answersJson: scrubUrl(sub?.answersJson ?? null, r.selfieUrl!) }).where(eq(formSubmissions.id, r.id));
            if (r.notificationId) {
                const n = await db.select({ metadata: notifications.metadata }).from(notifications).where(eq(notifications.id, r.notificationId)).get();
                if (n?.metadata?.includes(r.selfieUrl!)) await db.update(notifications).set({ metadata: scrubUrl(n.metadata, r.selfieUrl!) }).where(eq(notifications.id, r.notificationId));
            }
            selfies.push({ id: r.id, status: 'moved', publicDeleted: !usedAsPhoto });
        } catch (e) {
            selfies.push({ id: r.id, status: 'failed', errorId: logger.error('contracts migrate: selfie move failed', e, { submissionId: r.id }) });
        }
    }

    const count = (xs: Result[], s: Result['status']) => xs.filter(x => x.status === s).length;
    const tally = {
        contractsMoved: count(contracts, 'moved'), contractsMissing: count(contracts, 'missing'), contractsFailed: count(contracts, 'failed'),
        selfiesMoved: count(selfies, 'moved'), selfiesMissing: count(selfies, 'missing'), selfiesFailed: count(selfies, 'failed'),
    };
    logAudit({ userEmail: admin, action: 'contracts_moved_to_private', details: tally });
    logger.info('contracts migrate: done', { admin, ...tally });
    return NextResponse.json({ contracts, selfies, tally });
}
