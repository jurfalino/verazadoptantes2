// Third-party API v1: what an earlier call of this key saved, by its externalId (?externalId=…).
import { handleApiCall } from '@/lib/api/handler';
import { runPastCall } from '@/lib/api/pastCalls';
import { apiPreflight } from '@/lib/api/cors';

export const runtime = 'edge';

export const OPTIONS = apiPreflight;

export async function GET(request: Request) {
    return handleApiCall(request, 'requests', ctx => runPastCall(ctx, null));
}
