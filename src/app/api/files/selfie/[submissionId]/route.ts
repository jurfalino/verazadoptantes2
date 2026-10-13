// An applicant's selfie from the adoption form, from private storage
// (src/lib/contractStorage.ts). Only for whoever may see that form's results
// (canAccessFormSubmission: the form-link owner's team, the animal owner's
// team, admins). The key comes only from form_submissions.selfie_key and the
// file must be tagged with this submission. Everyone else gets the same 404.
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { formSubmissions } from '@/db/schema';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { readSelfie } from '@/lib/contractStorage';
import { canAccessFormSubmission } from '@/app/actions/_applicants';

export const runtime = 'edge';

const NO_STORE = { 'cache-control': 'private, no-store' };
const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });

export async function GET(_request: Request, { params }: { params: Promise<{ submissionId: string }> }) {
    const { submissionId } = await params;
    const email = (await auth())?.user?.email ?? null;
    if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
    try {
        const db = await getDb();
        if (!db) throw new Error('database unavailable');
        const row = await db.select({ selfieKey: formSubmissions.selfieKey }).from(formSubmissions).where(eq(formSubmissions.id, submissionId)).get();
        if (!row?.selfieKey) return notFound();
        if (!(await canAccessFormSubmission(db, submissionId, email))) {
            logger.info('selfie file: refused', { submissionId, viewer: email });
            return notFound();
        }
        const file = await readSelfie(row.selfieKey, submissionId);
        if (!file) {
            logger.warn('selfie file: key on record but no matching file in storage', { submissionId });
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
        const errorId = logger.error('selfie file: failed', e, { submissionId, viewer: email });
        return NextResponse.json({ error: `No se pudo abrir la foto (ID: ${errorId})` }, { status: 500, headers: NO_STORE });
    }
}
