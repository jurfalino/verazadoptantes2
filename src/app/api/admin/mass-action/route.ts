export const runtime = 'edge';

import { getDb } from "@/app/actions";
import { adopters } from "@/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { logger } from "@/lib/logger";
import { logAudit } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";
import { isAdminAsync } from "@/config/admins";
import { deleteAdopter } from "@/app/actions/admin";

const MAX_BATCH_SIZE = 100;

interface MassActionRequest {
    action: 'delete' | 'set_country';
    adopterIds: string[];
    country?: string;
}

export async function POST(request: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        }

        const body = await request.json() as MassActionRequest;
        const { action, adopterIds, country } = body;

        // Validate
        if (!action || !adopterIds?.length) {
            return NextResponse.json({ error: 'Missing action or adopterIds' }, { status: 400 });
        }
        if (adopterIds.length > MAX_BATCH_SIZE) {
            return NextResponse.json({ error: `Maximum ${MAX_BATCH_SIZE} records per batch` }, { status: 400 });
        }
        if (action === 'set_country' && !country) {
            return NextResponse.json({ error: 'Country is required for set_country action' }, { status: 400 });
        }

        const db = await getDb();
        if (!db) {
            return NextResponse.json({ error: 'Database unavailable' }, { status: 500 });
        }

        let processedCount = 0;
        const errors: string[] = [];

        if (action === 'delete') {
            for (const id of adopterIds) {
                try {
                    const result = await deleteAdopter(id);
                    if (result.success) {
                        processedCount++;
                    } else {
                        errors.push(`${id}: ${result.error}`);
                    }
                } catch (e) {
                    errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
                }
            }

            logAudit({
                userEmail: session.user.email,
                action: 'mass_delete',
                details: { count: processedCount, totalRequested: adopterIds.length, errors: errors.length },
            });
        } else if (action === 'set_country') {
            // D1 does NOT expand array params in IN() — `inArray` silently bound
            // only the first id, so this updated ONE row while reporting all N as
            // success (processedCount was hardcoded to the array length). Fan out
            // per-id and count actual successes (CLAUDE.md D1 rule).
            await Promise.all(adopterIds.map(async (id) => {
                try {
                    await db.update(adopters)
                        .set({ country: country!, updatedAt: new Date() })
                        .where(eq(adopters.id, id));
                    processedCount++;
                } catch (e) {
                    errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
                }
            }));

            logAudit({
                userEmail: session.user.email,
                action: 'mass_set_country',
                details: { country, count: processedCount, totalRequested: adopterIds.length, errors: errors.length },
            });
        } else {
            return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
        }

        logger.info('Mass action completed', {
            action,
            processedCount,
            totalRequested: adopterIds.length,
            errors: errors.length,
            user: session.user.email,
        });

        return NextResponse.json({
            success: errors.length === 0,
            processedCount,
            ...(errors.length > 0 && { errors }),
        });
    } catch (error) {
        logger.error('Mass action failed', error);
        return NextResponse.json({ error: 'Mass action failed' }, { status: 500 });
    }
}
