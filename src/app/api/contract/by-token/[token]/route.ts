import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { withCors, corsPreflightResponse } from '@/lib/cors';

export const runtime = 'edge';

/**
 * GET /api/contract/by-token/<token>
 *
 * Token-aware contract data endpoint used by the contract-app /c/<token>
 * route (Phase 5 — locked contract flow). Resolves the token to the animal
 * + adopter pre-fill. Returns 410 if the token is expired, already used,
 * or animal is no longer available; 404 if the token is unknown.
 *
 * The legacy open path `/api/contract/[id]` continues to serve
 * `/contract/<animalId>` URLs unchanged.
 */
export async function OPTIONS(request: Request) {
    return corsPreflightResponse(request.headers.get('origin'));
}

interface AnimalPayload {
    id: string;
    animalName: string | null;
    species: string | null;
    details: string | null;
    comments: string | null;
    age: string | null;
    estimatedBirthDate: number | null;
    neutered: number | null;
    sex: string | null;
    color: string | null;
    microchip: string | null;
    rescuerName: string | null;
    images: Array<{ id: string; url: string; caption: string | null }>;
}

interface PrefillPayload {
    name: string;
    lastName: string;
    email: string;
    phone: string;
    address: string;
    dni: string;
}

function splitContactLine(contactInfo: string | null, prefix: string): string {
    if (!contactInfo) return '';
    const re = new RegExp(`^${prefix}:\\s*(.*)$`, 'mi');
    const m = contactInfo.match(re);
    return m ? m[1].trim() : '';
}

function splitName(full: string): { first: string; last: string } {
    const trimmed = full.trim();
    if (!trimmed) return { first: '', last: '' };
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) return { first: parts[0], last: '' };
    return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const origin = request.headers.get('origin');

    try {
        const { getDb } = await import('@/lib/db');
        const db = await getDb();
        if (!db) return withCors(NextResponse.json({ error: 'Database unavailable' }, { status: 500 }), origin);

        const { adoptions, adopterImages, adopters, users, contractInvitations } = await import('@/db/schema');
        const { eq } = await import('drizzle-orm');

        const invite = await db.select()
            .from(contractInvitations)
            .where(eq(contractInvitations.token, token))
            .get();
        if (!invite) {
            return withCors(NextResponse.json({ error: 'Invitation not found' }, { status: 404 }), origin);
        }

        const nowSec = Math.floor(Date.now() / 1000);
        if (invite.usedAt) {
            return withCors(NextResponse.json({ error: 'Invitation already used', code: 'used' }, { status: 410 }), origin);
        }
        if (invite.expiresAt && invite.expiresAt < nowSec) {
            return withCors(NextResponse.json({ error: 'Invitation expired', code: 'expired' }, { status: 410 }), origin);
        }

        const animal = await db.select().from(adoptions).where(eq(adoptions.id, invite.animalId)).get();
        if (!animal) return withCors(NextResponse.json({ error: 'Animal not found' }, { status: 404 }), origin);
        if (animal.adopterId) {
            return withCors(NextResponse.json({ error: 'Animal already adopted', code: 'already_adopted' }, { status: 410 }), origin);
        }

        const adopter = await db.select().from(adopters).where(eq(adopters.id, invite.adopterId)).get();
        if (!adopter || adopter.deletedAt) {
            return withCors(NextResponse.json({ error: 'Adopter record unavailable' }, { status: 410 }), origin);
        }

        const images = await db.select({
            id: adopterImages.id,
            url: adopterImages.url,
            caption: adopterImages.caption,
        }).from(adopterImages)
            .where(eq(adopterImages.adoptionId, invite.animalId))
            .limit(5)
            .all();

        let rescuerDisplay: string | null = null;
        if (animal.addedBy) {
            try {
                const userRow = await db.select({ name: users.name })
                    .from(users)
                    .where(eq(users.email, animal.addedBy))
                    .get();
                const n = userRow?.name?.trim();
                rescuerDisplay = n || animal.addedBy.split('@')[0];
            } catch {
                rescuerDisplay = animal.addedBy.split('@')[0];
            }
        }

        const { first, last } = splitName(adopter.name);
        const prefill: PrefillPayload = {
            name: first,
            lastName: last,
            email: splitContactLine(adopter.contactInfo, 'Email'),
            phone: splitContactLine(adopter.contactInfo, 'Tel') || splitContactLine(adopter.contactInfo, 'Teléfono') || splitContactLine(adopter.contactInfo, 'Telefono'),
            address: splitContactLine(adopter.contactInfo, 'Dirección') || splitContactLine(adopter.contactInfo, 'Direccion') || (adopter.addressInfo || ''),
            dni: splitContactLine(adopter.contactInfo, 'Documento') || splitContactLine(adopter.contactInfo, 'DNI'),
        };

        const animalPayload: AnimalPayload = {
            id: animal.id,
            animalName: animal.animalName,
            species: animal.species,
            details: animal.details,
            comments: animal.comments,
            age: animal.age,
            estimatedBirthDate: animal.estimatedBirthDate ? Math.floor(animal.estimatedBirthDate.getTime() / 1000) : null,
            neutered: animal.neutered,
            sex: animal.sex,
            color: animal.color,
            microchip: animal.microchip,
            rescuerName: rescuerDisplay,
            images,
        };

        return withCors(NextResponse.json({
            token,
            animal: animalPayload,
            adopterName: adopter.name,
            prefill,
            // Language the rescuer shared this in; the contract-app uses it as
            // the backstop when the URL carries no ?lang=. Null for legacy rows.
            locale: invite.locale ?? null,
        }), origin);
    } catch (e) {
        const errorId = logger.error('Contract by-token fetch failed', e, { token });
        return withCors(NextResponse.json({ error: 'Internal error', errorId }, { status: 500 }), origin);
    }
}
