// Third-party API v1: a rescue voids a record ITS OWN key saved (decision 11).
// Any other id answers 404, so ids of other rescuers' records reveal nothing.
import { handleApiCall, requireScope, ApiError } from '@/lib/api/handler';
import { voidApiRecord } from '@/lib/api/records';
import type { VoidResponse } from '@/lib/api/schemas';

export const runtime = 'edge';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return handleApiCall(request, 'void', async (ctx) => {
        requireScope(ctx, 'record:write');
        ctx.log.recordId = id;
        const done = await voidApiRecord(ctx.db, id, { keyId: ctx.key.id, actor: `api:${ctx.key.name}`, requestId: ctx.requestId });
        if (!done) throw new ApiError(404, 'not_found', 'no record saved by this key with that id');
        if (done.changedSince) throw new ApiError(409, 'record_changed', 'this animal was placed again after your record; ask an admin to correct it');
        ctx.log.outcome = 'voided';
        ctx.log.profileIds = done.profileId ? [done.profileId] : [];
        const body: Omit<VoidResponse, 'requestId'> = { recordId: id, voided: true, profileVoided: done.profileVoided, ...(done.alreadyVoided ? { alreadyVoided: true } : {}) };
        return { status: 200, body };
    });
}
