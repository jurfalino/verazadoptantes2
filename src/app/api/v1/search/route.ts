// Third-party API v1: exact / fuzzy person search, optionally saving a record.
// Contract: src/lib/api/schemas.ts. Plan: .agents/plans/2026-10-09-third-party-api.md
import { handleApiCall } from '@/lib/api/handler';
import { runSearch } from '@/lib/api/search';
import { apiPreflight } from '@/lib/api/cors';

export const runtime = 'edge';

export const OPTIONS = apiPreflight;

export async function POST(request: Request) {
    return handleApiCall(request, 'search', runSearch);
}
