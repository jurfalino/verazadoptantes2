// Third-party API v1: what an earlier call of this key did, by its requestId.
import { handleApiCall } from '@/lib/api/handler';
import { runPastCall } from '@/lib/api/pastCalls';
import { apiPreflight } from '@/lib/api/cors';

export const runtime = 'edge';

export const OPTIONS = apiPreflight;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return handleApiCall(request, 'requests', ctx => runPastCall(ctx, id));
}
