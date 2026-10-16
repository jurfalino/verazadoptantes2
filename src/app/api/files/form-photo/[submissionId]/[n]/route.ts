// A photo sent with an adoption form (protection, where it sleeps), from
// private storage (src/lib/contractStorage.ts). Same rules as the selfie route:
// only for whoever may see that form's results (canAccessFormSubmission); the
// key comes only from form_submissions.photo_keys, by position, and the file
// must be tagged with this submission. Everyone else gets the same 404.
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { formSubmissions } from '@/db/schema';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { readFormPhoto } from '@/lib/contractStorage';
import { canAccessFormSubmission } from '@/app/actions/_applicants';
import type { StoredPhoto } from '@/domain/formPhotos';

export const runtime = 'edge';

const NO_STORE = { 'cache-control': 'private, no-store' };
const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });

export async function GET(_request: Request, { params }: { params: Promise<{ submissionId: string; n: string }> }) {
    const { submissionId, n } = await params;
    const email = (await auth())?.user?.email ?? null;
    if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
    const index = /^\d{1,2}$/.test(n) ? Number(n) : -1;
    try {
        const db = await getDb();
        if (!db) throw new Error('database unavailable');
        const row = await db.select({ photoKeys: formSubmissions.photoKeys }).from(formSubmissions).where(eq(formSubmissions.id, submissionId)).get();
        let keys: StoredPhoto[] = [];
        try { keys = row?.photoKeys ? JSON.parse(row.photoKeys) : []; } catch (e) {
            logger.warn('form photo file: malformed photo_keys', { submissionId, error: e instanceof Error ? e.message : String(e) });
        }
        const key = index >= 0 && Array.isArray(keys) ? keys[index]?.key : undefined;
        if (!key) return notFound();
        if (!(await canAccessFormSubmission(db, submissionId, email))) {
            logger.info('form photo file: refused', { submissionId, viewer: email });
            return notFound();
        }
        const file = await readFormPhoto(key, submissionId);
        if (!file) {
            logger.warn('form photo file: key on record but no matching file in storage', { submissionId, index });
            return notFound();
        }
        return new Response(file.body, {
            headers: {
                ...NO_STORE,
                'content-type': file.httpMetadata?.contentType ?? 'image/jpeg',
                'content-disposition': 'inline',
                'x-content-type-options': 'nosniff',
                'content-security-policy': "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
            },
        });
    } catch (e) {
        const errorId = logger.error('form photo file: failed', e, { submissionId, viewer: email });
        return NextResponse.json({ error: `No se pudo abrir la foto (ID: ${errorId})` }, { status: 500, headers: NO_STORE });
    }
}
