/**
 * What someone added to a profile in one go — records (with their rating),
 * photos, videos, a delivery address — told to the owner's team as ONE notice
 * (`profile_content_added`, Jon 2026-11-08). A record saved with its photos
 * reaches the server as several calls (the record, then each photo), so each
 * call merges its part into the same notice (src/lib/profileAdditionNotices.ts).
 *
 * Travels in the notice's template params as plain strings and codes (D38):
 * `records` = `type[:rating]` joined by commas, `photos` / `videos` = digits,
 * `address` = '1'. Never the address itself, never contact values.
 *
 * Pure: no DB, no server imports.
 */
import { recordHandoverFields } from './recordEditAccess';

export interface AddedRecord { type: string; rating?: number }

export interface ProfileAddition {
    records?: AddedRecord[];
    photos?: number;
    videos?: number;
    address?: boolean;
}

export type ProfileAdditionParams = {
    records?: string;
    photos?: string;
    videos?: string;
    address?: string;
};

/** The notice lists at most this many records (later ones still count in the merge, not in the list). */
export const MAX_LISTED_RECORDS = 10;

/**
 * Two additions by the same person to the same profile within the window
 * collapse into one notice: the same person's next adds update it in place.
 */
export const PROFILE_ADDITION_NOTICE_WINDOW_MS = 10 * 60 * 1000;

const RECORD_CODE = /^[a-z_]{1,40}$/;
const validRating = (r: unknown): r is number => typeof r === 'number' && Number.isInteger(r) && r >= 1 && r <= 5;
const positive = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

function cleanRecord(r: AddedRecord): AddedRecord | null {
    if (!r || typeof r.type !== 'string' || !RECORD_CODE.test(r.type)) return null;
    return validRating(r.rating) ? { type: r.type, rating: r.rating } : { type: r.type };
}

function normalize(add: ProfileAddition): ProfileAddition {
    const out: ProfileAddition = {};
    const records = (add.records ?? []).map(cleanRecord).filter((r): r is AddedRecord => r !== null).slice(0, MAX_LISTED_RECORDS);
    if (records.length) out.records = records;
    const photos = positive(add.photos);
    if (photos) out.photos = photos;
    const videos = positive(add.videos);
    if (videos) out.videos = videos;
    if (add.address) out.address = true;
    return out;
}

export function isEmptyAddition(add: ProfileAddition): boolean {
    const n = normalize(add);
    return !n.records && !n.photos && !n.videos && !n.address;
}

/** `prev` then `next`: records appended in order, counts summed, the address once. */
export function mergeAdditions(prev: ProfileAddition, next: ProfileAddition): ProfileAddition {
    return normalize({
        records: [...(prev.records ?? []), ...(next.records ?? [])],
        photos: positive(prev.photos) + positive(next.photos),
        videos: positive(prev.videos) + positive(next.videos),
        address: !!prev.address || !!next.address,
    });
}

export function additionParams(add: ProfileAddition): ProfileAdditionParams {
    const n = normalize(add);
    const out: ProfileAdditionParams = {};
    if (n.records) out.records = n.records.map(r => (r.rating ? `${r.type}:${r.rating}` : r.type)).join(',');
    if (n.photos) out.photos = String(n.photos);
    if (n.videos) out.videos = String(n.videos);
    if (n.address) out.address = '1';
    return out;
}

const digits = (s: unknown): number => (typeof s === 'string' && /^\d{1,4}$/.test(s) ? Number(s) : 0);

/** The addition stored in a notice's params; anything unreadable is dropped, never guessed. */
export function additionFromParams(p: Partial<Record<keyof ProfileAdditionParams, unknown>>): ProfileAddition {
    const records: AddedRecord[] = typeof p.records === 'string'
        ? p.records.split(',').map(part => {
            const m = part.trim().match(/^([a-z_]{1,40})(?::(\d))?$/);
            if (!m) return null;
            const rating = m[2] ? Number(m[2]) : undefined;
            return validRating(rating) ? { type: m[1], rating } : { type: m[1] };
        }).filter((r): r is AddedRecord => r !== null)
        : [];
    return normalize({ records, photos: digits(p.photos), videos: digits(p.videos), address: p.address === '1' });
}

/** Does this record carry a delivery address (a type that stores one, marked delivered, a non-blank address)? */
export function deliveryAddressGiven(recordType: string | null | undefined, deliveredToHome: unknown, verifiedAddress: unknown): boolean {
    const delivered = deliveredToHome === 1 || deliveredToHome === true;
    return delivered && typeof verifiedAddress === 'string' && verifiedAddress.trim() !== '' && recordHandoverFields(recordType).deliveredToHome;
}
