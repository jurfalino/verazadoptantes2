/**
 * Route bodies shared by Admin → API and Settings → API. The only difference
 * is `owner`: null for the admin (everything), the rescuer's own email for
 * Settings (their keys and transactions only, enforced in review.ts).
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { getTransaction, listKeys, listTransactions } from './review';
import { voidApiRecord } from './records';
import { purgeOldRequestBodies } from './handler';

const dateParam = (v: string | null) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
};

export async function listResponse(request: Request, actor: string, owner: string | null) {
    const q = new URL(request.url).searchParams;
    try {
        const db = await getDb();
        if (!db) throw new Error('database unavailable');
        // Reviewing is a good moment to drop expired person data too.
        await purgeOldRequestBodies(db);
        const [page, keys] = await Promise.all([
            listTransactions(db, {
                ownerEmail: owner ?? (q.get('owner') || null),
                keyId: q.get('keyId'),
                outcome: q.get('outcome'),
                from: dateParam(q.get('from')),
                to: dateParam(q.get('to')),
                before: dateParam(q.get('before')),
            }),
            owner ? listKeys(db, owner) : Promise.resolve(undefined),
        ]);
        return NextResponse.json({ ...page, ...(keys ? { keys } : {}) });
    } catch (e) {
        const errorId = logger.error('api review: list failed', e, { actor, owner });
        return NextResponse.json({ error: 'Failed to load transactions', errorId }, { status: 500 });
    }
}

export async function detailResponse(id: string, actor: string, owner: string | null) {
    try {
        const db = await getDb();
        if (!db) throw new Error('database unavailable');
        const tx = await getTransaction(db, id, owner);
        if (!tx) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        return NextResponse.json({ transaction: tx });
    } catch (e) {
        const errorId = logger.error('api review: detail failed', e, { actor, owner, transactionId: id });
        return NextResponse.json({ error: 'Failed to load transaction', errorId }, { status: 500 });
    }
}

/** Void the record a transaction saved. A rescuer may only void their own keys' records. */
export async function voidResponse(id: string, actor: string, owner: string | null) {
    const requestId = crypto.randomUUID();
    try {
        const db = await getDb();
        if (!db) throw new Error('database unavailable');
        const tx = await getTransaction(db, id, owner);
        if (!tx?.recordId || tx.endpoint !== 'search') return NextResponse.json({ error: 'This transaction saved no record' }, { status: 404 });
        const done = await voidApiRecord(db, tx.recordId, { keyId: owner ? tx.keyId : null, actor, requestId });
        if (!done) return NextResponse.json({ error: 'No API record to void' }, { status: 404 });
        if (done.changedSince) return NextResponse.json({ error: 'This animal was placed again after the API record; correct it from the animal page' }, { status: 409 });
        logAudit({ userEmail: actor, action: 'api_record_voided', details: { transactionId: id, recordId: tx.recordId, profileVoided: done.profileVoided, asAdmin: !owner } });
        return NextResponse.json({ ok: true, ...done });
    } catch (e) {
        const errorId = logger.error('api review: void failed', e, { actor, owner, transactionId: id, requestId });
        return NextResponse.json({ error: 'Failed to void the record', errorId }, { status: 500 });
    }
}
