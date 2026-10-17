// Third-party API v1: "test connection". Which rescuer the key belongs to, its
// scopes, and how much of today's caps is used.
import { eq } from 'drizzle-orm';
import { users } from '@/db/schema';
import { callCeilingOf, callsToday, handleApiCall, searchesToday } from '@/lib/api/handler';
import { scopesOf } from '@/lib/api/keys';
import type { MeResponse } from '@/lib/api/schemas';

export const runtime = 'edge';

export async function GET(request: Request) {
    return handleApiCall(request, 'me', async (ctx) => {
        const { key, db } = ctx;
        const [owner, exact, fuzzy, calls] = await Promise.all([
            db.select({ name: users.name }).from(users).where(eq(users.email, key.ownerEmail)).get(),
            searchesToday(db, key.id, 'exact'),
            searchesToday(db, key.id, 'fuzzy'),
            callsToday(db, key.id),
        ]);
        ctx.log.outcome = 'ok';
        const body: Omit<MeResponse, 'requestId'> = {
            key: { name: key.name, prefix: key.keyPrefix, environment: key.environment === 'live' ? 'live' : 'test', scopes: scopesOf(key) },
            rescuer: { email: key.ownerEmail, name: owner?.name ?? null },
            caps: { exact: key.dailyCapExact, fuzzy: key.dailyCapFuzzy },
            usedToday: { exact, fuzzy },
            callCeiling: { limit: callCeilingOf(key), usedToday: calls },
        };
        return { status: 200, body };
    });
}
