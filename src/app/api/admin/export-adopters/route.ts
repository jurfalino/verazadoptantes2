export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { adopters } from '@/db/schema';
import { isNull, asc } from 'drizzle-orm';
import { auth } from '@/auth';
import { isAdminAsync } from '@/config/admins';
import { logger } from '@/lib/logger';
import { buildXlsx } from '@/lib/xlsx';
import { deserializeContactEntries, parseBlobToContactEntries } from '@/lib/contactEntries';

/**
 * GET /api/admin/export-adopters — the adopters list as a .xlsx, contact details
 * expanded into one column per type.
 *
 * ADMIN ONLY, and deliberately UNMASKED: this is a bulk extraction of
 * third-party PII that leaves the system entirely and cannot be recalled, so it
 * is gated on `isAdminAsync` exactly like /api/admin/export. Moderators cannot
 * reach it.
 *
 * Cost: ONE query, no per-adopter fan-out — contact entries live as JSON on the
 * adopter row. That matters because a Worker gets 50 subrequests and 10ms of CPU
 * on the Free plan. `buildXlsx` writes uncompressed ZIP entries for the same
 * reason (see lib/xlsx.ts); ~1,150 rows costs single-digit milliseconds.
 */

/** Contact types broken out into their own columns, in reading order. */
const COLUMNS: Array<{ type: string; header: string }> = [
    { type: 'phone', header: 'Teléfonos' },
    { type: 'email', header: 'Emails' },
    { type: 'social', header: 'Redes sociales' },
    { type: 'address', header: 'Direcciones' },
    { type: 'id', header: 'Documento' },
    { type: 'alias', header: 'Otros nombres' },
];

const HEADERS = [
    'ID', 'Nombre',
    ...COLUMNS.map(c => c.header),
    'País', 'Agregado por', 'Origen', 'Creado', 'Actualizado',
];

function isoDate(v: unknown): string {
    if (!v) return '';
    const d = v instanceof Date ? v : new Date(Number(v) * 1000);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

export async function GET() {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const db = await getDb();
        if (!db) return NextResponse.json({ error: 'Database unavailable' }, { status: 500 });

        const rows = await db.select({
            id: adopters.id,
            name: adopters.name,
            contactEntries: adopters.contactEntries,
            contactInfo: adopters.contactInfo,
            country: adopters.country,
            addedBy: adopters.addedBy,
            sourceUrl: adopters.sourceUrl,
            createdAt: adopters.createdAt,
            updatedAt: adopters.updatedAt,
        })
            .from(adopters)
            .where(isNull(adopters.deletedAt))
            .orderBy(asc(adopters.name));

        const sheet: string[][] = [HEADERS];

        for (const r of rows) {
            // Older records carry contact data only in the legacy blob; fall back
            // to parsing it so the export is not silently empty for them — the
            // same precedence AdopterForm uses when rendering.
            const stored = deserializeContactEntries(r.contactEntries);
            const entries = stored.length > 0 ? stored : parseBlobToContactEntries(r.contactInfo);

            const byType = new Map<string, string[]>();
            for (const e of entries) {
                if (!e.value) continue;
                // Keep the network on socials — "juanp" alone is ambiguous across
                // platforms, and platform+handle is what dedup matches on.
                const value = e.type === 'social' && e.platform ? `${e.platform}: ${e.value}` : e.value;
                const list = byType.get(e.type);
                if (list) list.push(value); else byType.set(e.type, [value]);
            }

            sheet.push([
                r.id,
                r.name || '',
                ...COLUMNS.map(c => (byType.get(c.type) ?? []).join(' | ')),
                r.country || '',
                r.addedBy || '',
                r.sourceUrl || '',
                isoDate(r.createdAt),
                isoDate(r.updatedAt),
            ]);
        }

        const file = buildXlsx('Adoptantes', sheet);
        const stamp = new Date().toISOString().slice(0, 10);

        logger.info('Adopters exported', {
            rows: rows.length, bytes: file.length, user: session.user.email,
        });

        return new NextResponse(file as unknown as BodyInit, {
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="adoptantes-${stamp}.xlsx"`,
                'Cache-Control': 'no-store',
            },
        });
    } catch (error) {
        const errorId = logger.error('Adopters export failed', error instanceof Error ? error : new Error(String(error)), {
            user: session.user.email,
        });
        return NextResponse.json({
            error: 'Export failed',
            errorId,
            message: error instanceof Error ? error.message : String(error),
        }, { status: 500 });
    }
}
