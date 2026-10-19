// Third-party API v1: what an earlier call of this key saved, by its externalId (?externalId=…).
import { handleApiCall } from '@/lib/api/handler';
import { runPastCall } from '@/lib/api/pastCalls';

export const runtime = 'edge';

export async function GET(request: Request) {
    return handleApiCall(request, 'requests', ctx => runPastCall(ctx, null));
}
