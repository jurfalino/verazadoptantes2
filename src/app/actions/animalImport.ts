'use server';

/**
 * «Cargar un animal desde un post» (Jon 2026-11-14) — "is it already here?",
 * asked right after the post is read, before the rescuer spends time on the
 * form. Three answers:
 *
 *  · the same post, loaded by the viewer's team  → «Ya cargaste este post»
 *  · the same post, loaded by another rescuer     → who has it, and its public
 *    page if listed. Loading it again is allowed («Lo tengo yo», decision 3).
 *  · an animal of the team, still looking for a home, with the same name and
 *    species → «¿Es el mismo Rocco?»; «Sí» adds the post to it (decision 4).
 *
 * Read-only. The post link is matched on `animals.source_url` directly — the
 * person import's lookup reaches animals only through a placement, so an
 * animal never placed was invisible to it.
 */

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { animals, adoptions } from '@/db/schema';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { postKey, samePost } from '@/domain/postKey';
import { isSameNamedAnimal } from '@/domain/animalImport';
import { RECORD_TYPES } from '@/domain/constants';

export interface AnimalMatch {
    id: string;
    name: string | null;
    species: string | null;
    sex: string | null;
    photoUrl: string | null;
    /** Epoch ms. */
    createdAt: number | null;
    /** The rest of the animal's own fields — «Sí, es el mismo» fills only the empty ones (decision 4). */
    fields: { neutered: number | null; color: string | null; microchip: string | null; details: string | null; estimatedBirthDate: number | null; sourceUrl: string | null };
}
export interface AnimalElsewhere {
    id: string;
    name: string | null;
    species: string | null;
    owner: { displayName: string; orgName?: string } | null;
    publicUrl: string | null;
}
export type AnimalImportMatches =
    | { ok: true; samePostMine: AnimalMatch[]; samePostOthers: AnimalElsewhere[]; sameName: Array<AnimalMatch | null> }
    | { ok: false; errorId: string };

const inputSchema = z.object({
    sourceUrls: z.array(z.string().max(2000)).max(3),
    animals: z.array(z.object({ name: z.string().max(80), species: z.string().max(40) })).max(12),
});

/** Record types that mean "an animal offered for adoption" — not an animal named in a report about a person. */
const OFFERED: string[] = [RECORD_TYPES.AVAILABLE, RECORD_TYPES.FOSTER, RECORD_TYPES.ADOPTION];

export async function findAnimalImportMatches(input: {
    sourceUrls: string[];
    animals: Array<{ name: string; species: string }>;
}): Promise<AnimalImportMatches> {
    const { getUser } = await import('@/app/actions/_db');
    const userEmail = await getUser();
    const parsed = inputSchema.safeParse(input);
    const links = parsed.success ? [...new Set(parsed.data.sourceUrls.map(u => u.trim()).filter(Boolean))] : [];
    try {
        if (!parsed.success) throw new Error('findAnimalImportMatches: invalid input');
        const db = await getDb();
        if (!db) throw new Error('Database not available');

        const { myAnimalsScope } = await import('@/lib/myAnimalsScope');
        const { fetchAnimalImages } = await import('@/lib/showcase');
        const { ownedElsewhereDetails } = await import('@/lib/animalAccess');
        const { normEmail } = await import('@/lib/orgMembership');
        const scope = await myAnimalsScope(userEmail);
        const team = new Set(scope.scopeEmails.map(e => normEmail(e)));

        const firstPhoto = async (id: string): Promise<string | null> =>
            ((await fetchAnimalImages(db, [id])).get(id) ?? [])[0]?.url ?? null;
        type Row = { id: string; name: string | null; species: string | null; sex: string | null; createdAt: Date | null; neutered: number | null; color: string | null; microchip: string | null; details: string | null; estimatedBirthDate: Date | null; sourceUrl: string | null };
        const toMatch = async (row: Row): Promise<AnimalMatch> => ({
            id: row.id, name: row.name, species: row.species, sex: row.sex,
            photoUrl: await firstPhoto(row.id).catch((e: unknown) => {
                logger.warn('findAnimalImportMatches: photo lookup fallback', { animalId: row.id, userEmail, error: e instanceof Error ? e.message : String(e) });
                return null;
            }),
            createdAt: row.createdAt ? row.createdAt.getTime() : null,
            fields: {
                neutered: row.neutered, color: row.color, microchip: row.microchip, details: row.details,
                estimatedBirthDate: row.estimatedBirthDate ? row.estimatedBirthDate.getTime() : null, sourceUrl: row.sourceUrl,
            },
        });

        // ── the same post ──
        const keys = links.map(postKey).filter((k): k is NonNullable<typeof k> => !!k);
        const needles = [...new Set(keys.map(k => k.needle))];
        const cols = {
            id: animals.id, name: animals.name, species: animals.species, sex: animals.sex, createdAt: animals.createdAt, addedBy: animals.addedBy, sourceUrl: animals.sourceUrl,
            neutered: animals.neutered, color: animals.color, microchip: animals.microchip, details: animals.details, estimatedBirthDate: animals.estimatedBirthDate,
        };
        const byNeedle = await Promise.all(needles.map(needle =>
            // instr, not LIKE: D1 rejects LIKE patterns over ~50 bytes (long pfbid links).
            db.select(cols).from(animals)
                .where(and(isNull(animals.deletedAt), sql`instr(lower(${animals.sourceUrl}), lower(${needle})) > 0`))
                .orderBy(desc(animals.createdAt))
                .limit(50)));
        const samePostRows = new Map<string, (typeof byNeedle)[number][number]>();
        for (const rows of byNeedle) for (const r of rows) {
            if (r.sourceUrl && links.some(l => samePost(r.sourceUrl, l))) samePostRows.set(r.id, r);
        }
        const offered = await Promise.all([...samePostRows.values()].map(async r => {
            const rec = await db.select({ recordType: adoptions.recordType }).from(adoptions).where(eq(adoptions.id, r.id)).get();
            return rec && OFFERED.includes(rec.recordType ?? '') ? r : null;
        }));
        const samePostMine: AnimalMatch[] = [];
        const samePostOthers: AnimalElsewhere[] = [];
        for (const r of offered) {
            if (!r) continue;
            if (team.has(normEmail(r.addedBy))) samePostMine.push(await toMatch(r));
            else samePostOthers.push({ id: r.id, name: r.name, species: r.species, ...(await ownedElsewhereDetails(db, r, userEmail)) });
        }

        // ── the same name and species, among the team's animals still looking for a home ──
        const wanted = parsed.data.animals;
        let sameName: Array<AnimalMatch | null> = wanted.map(() => null);
        if (wanted.some(a => a.name.trim())) {
            const candidates = await db.select({ id: adoptions.id, name: adoptions.animalName, species: adoptions.species })
                .from(adoptions).where(scope.availableWhere).limit(1000);
            const alreadyShown = new Set(samePostMine.map(m => m.id));
            sameName = await Promise.all(wanted.map(async (a) => {
                const hit = (candidates as Array<{ id: string; name: string | null; species: string | null }>).find(c => !alreadyShown.has(c.id) && isSameNamedAnimal(a, c));
                if (!hit) return null;
                const row = await db.select(cols).from(animals).where(and(eq(animals.id, hit.id), isNull(animals.deletedAt))).get();
                return row ? toMatch(row) : null;
            }));
        }

        logger.info('findAnimalImportMatches', {
            userEmail, links: links.length, samePostMine: samePostMine.length, samePostOthers: samePostOthers.length,
            sameName: sameName.filter(Boolean).length, animals: wanted.length,
        });
        return { ok: true, samePostMine, samePostOthers, sameName };
    } catch (error) {
        const errorId = logger.error('findAnimalImportMatches failed', error, { userEmail, links: links.length });
        return { ok: false, errorId };
    }
}
