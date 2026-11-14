'use client';

/**
 * «Cargar un animal desde un post» — the writes, all through the actions the
 * «Agregar animal» page and the animal page already use: `saveAdoption` to
 * create (or, for «Sí, es el mismo», patch only empty fields), `saveImage` with
 * scope 'animal' for each kept photo, shrunk to 1200px first like the form's
 * own uploads (a server action body is size-capped).
 */

import { saveAdoption, saveImage } from '@/app/actions';
import { compressImage } from '@/lib/imageCompress';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { computeBirthDate } from '@/lib/ageUtils';
import { ageReferenceDate, mergeIntoExisting } from '@/domain/animalImport';
import type { AnimalFieldsValue } from '@/components/animals/AnimalFields';
import type { AnimalMatch } from '@/app/actions/animalImport';

/** One of the post's photos, as the extraction route returned it. */
export interface PostPhoto { data: string; mimeType: string; preview: string }

export const photoFromBase64 = (data: string, mimeType: string): PostPhoto => ({ data, mimeType, preview: `data:${mimeType};base64,${data}` });

function blobOf(p: PostPhoto): Blob {
    const bin = atob(p.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: p.mimeType });
}

/** Saves each photo; returns how many could not be saved (never throws for a photo). */
export async function storePostPhotos(animalId: string, animalName: string, photos: PostPhoto[]): Promise<{ failed: number; errorIds: string[] }> {
    let failed = 0;
    const errorIds: string[] = [];
    for (const p of photos) {
        try {
            const dataUrl = await compressImage(blobOf(p));
            await saveImage('__available__', dataUrl, `Photo for ${animalName}`, animalId, 'image', false, 'animal');
        } catch (e) {
            failed++;
            errorIds.push(resolveErrorId(e, 'importSave.photo'));
        }
    }
    return { failed, errorIds };
}

export function birthDateFor(f: Pick<AnimalFieldsValue, 'ageValue' | 'ageUnit'>, postDate: string | null): Date | null {
    const n = Number(f.ageValue);
    return f.ageValue && n > 0 ? computeBirthDate(n, f.ageUnit, ageReferenceDate(postDate)) : null;
}

/** A new animal for adoption, as the form saves one — plus the post it came from. Returns its id. */
export async function createAnimal(f: AnimalFieldsValue, opts: { sourceUrl: string; postDate: string | null }): Promise<string> {
    const result = await saveAdoption({
        animalName: f.animalName,
        species: f.species,
        details: f.details,
        comments: '',
        age: null,
        estimatedBirthDate: birthDateFor(f, opts.postDate),
        sex: f.sex || null,
        neutered: f.neutered === '1' ? 1 : f.neutered === '0' ? 0 : null,
        color: f.color || null,
        microchip: f.microchip || null,
        recordType: 'available',
        status: 'active',
        rating: null,
        date: new Date(),
        adopterId: null,
        onBehalfOf: null,
        deliveredToHome: 0,
        verifiedAddress: null,
        identityVerified: 0,
        ...(opts.sourceUrl ? { sourceUrl: opts.sourceUrl } : {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    if (!result?.id) throw new Error('saveAdoption returned no id');
    return result.id;
}

/** «Sí: sumarle las fotos y los datos» — fills the existing animal's empty fields, then adds the photos. */
export async function mergeIntoAnimal(
    match: AnimalMatch, f: AnimalFieldsValue, photos: PostPhoto[], opts: { sourceUrl: string; postDate: string | null },
): Promise<{ photosFailed: number; conflicts: number; errorIds: string[] }> {
    const { patch, loaded } = mergeIntoExisting(
        { sex: match.sex, ...match.fields },
        { sex: f.sex, neutered: f.neutered, color: f.color, microchip: f.microchip, details: f.details, estimatedBirthDate: birthDateFor(f, opts.postDate), sourceUrl: opts.sourceUrl },
    );
    let conflicts = 0;
    if (Object.keys(patch).length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await saveAdoption({ id: match.id, ...patch } as any, { loaded: loaded as any });
        if (!res || !('success' in res)) throw new Error('saveAdoption returned no result');
        conflicts = res.conflicts?.length ?? 0;
    }
    const stored = await storePostPhotos(match.id, match.name || f.animalName, photos);
    return { photosFailed: stored.failed, conflicts, errorIds: stored.errorIds };
}
