// Third-party API v1: attach the signed contract (PDF / PNG / JPEG, ≤5 MB) to
// an adoption or foster activity this key saved. The body IS the file.
import { handleApiCall, requireScope } from '@/lib/api/handler';
import { attachApiContract } from '@/lib/api/records';
import { recordUrl } from '@/lib/api/profiles';
import { CONTRACT_MAX_BYTES } from '@/lib/contractStorage';
import type { ContractResponse } from '@/lib/api/schemas';
import { apiPreflight } from '@/lib/api/cors';

export const runtime = 'edge';

export const OPTIONS = apiPreflight;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const contentType = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    return handleApiCall(request, 'contract', async (ctx) => {
        requireScope(ctx, 'record:write');
        const done = await attachApiContract(ctx, id, contentType);
        const body: Omit<ContractResponse, 'requestId'> = {
            activityId: id,
            activityUrl: done.profileId ? recordUrl(ctx.origin, done.profileId, id) : null,
            contract: { contentType: done.contentType, size: done.size, sha256: done.sha256 },
        };
        return { status: 201, body };
    }, { binaryBodyMax: CONTRACT_MAX_BYTES });
}
