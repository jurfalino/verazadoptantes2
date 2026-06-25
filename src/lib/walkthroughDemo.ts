/**
 * Guided-walkthrough demo data (v2.22.0). Pure — no DB, no server imports.
 *
 * Three fixed "Juan" records the walkthrough renders as mock search results.
 * The real rows in the DB are SOFT-DELETED + `isDemo=1`, so they never appear
 * in any real search/duplicate/analytics query (every `deleted_at IS NULL`
 * filter excludes them). The walkthrough and the /admin/walkthrough panel fetch
 * them by the `isDemo` marker. When the rows aren't seeded yet, these fixtures
 * are the fallback so the demo always renders.
 *
 * A card's rating/flags/stats are DERIVED (from adoptions/adopterFlags) in real
 * search — we do NOT seed those child rows (that would reopen leak paths the
 * parent soft-delete doesn't cover). Instead each fixture carries a display
 * `overlay` with those values, attached at build time. The real rows supply
 * only the maskable PII so the "datos protegidos" masking is genuine.
 */

import type { adopters } from '@/db/schema';
import type { DiscoveryMatch } from '@/app/actions/types';
import type { AdopterFlags } from '@/types/adopter';
import {
    type ContactEntry,
    type ContactEntryType,
    contactEntriesToBlob,
    deserializeContactEntries,
    joinedAddressValue,
} from './contactEntries';
import { maskAdopterContact, hashEntryValue, NO_ACCESS_VISIBILITY, type Visibility } from './piiAccess';

type AdopterRow = typeof adopters.$inferSelect;

/** Display values that aren't columns on `adopters` (rating/flags/stats). */
export interface DemoOverlay {
    avgRating: number | null;
    flags: AdopterFlags;
    stats: { searchHits: number; profileViews: number; requests: number; adoptions: number };
    thumbnail: string | null;
}

export interface DemoFixture {
    id: string;
    name: string;
    contactEntries: ContactEntry[];
    addressInfo: string | null;
    isPublic: boolean;
    source: string;
    sourceUrl: string | null;
    country: string;
    /** Whether this record's PII is gated (masked in the demo) vs public (shown). */
    gated: boolean;
    overlay: DemoOverlay;
}

const NO_FLAGS: AdopterFlags = {
    inaccurate: false,
    duplicate: false,
    systemDuplicate: false,
    verified_identity: false,
    verified_address: false,
    tooManyAdoptions: null,
    tooManyRequests: null,
};

export const DEMO_ADOPTER_IDS = ['demo-juan-bueno', 'demo-juan-malo', 'demo-juan-dudoso'] as const;

/** The three records, in display order. */
export const WALKTHROUGH_DEMO_FIXTURES: DemoFixture[] = [
    {
        id: 'demo-juan-bueno',
        name: 'Juan BuenAdoptante',
        contactEntries: [
            { type: 'phone', value: '+54 11 4567-8901' },
            { type: 'email', value: 'juan.bueno@gmail.com' },
            {
                type: 'address',
                value: joinedAddressValue('Av. Cabildo 2200', 'Belgrano, CABA'),
                streetAndNumber: 'Av. Cabildo 2200',
                locality: 'Belgrano, CABA',
            },
        ],
        addressInfo: null,
        isPublic: false,
        source: 'manual',
        sourceUrl: null,
        country: 'AR',
        gated: true,
        overlay: {
            avgRating: 4,
            flags: { ...NO_FLAGS, verified_address: true },
            stats: { searchHits: 41, profileViews: 34, requests: 5, adoptions: 6 },
            thumbnail: null,
        },
    },
    {
        id: 'demo-juan-malo',
        name: 'Juan MalAdoptante',
        contactEntries: [
            { type: 'phone', value: '+54 11 2233-4455' },
            { type: 'social', value: 'https://facebook.com/juan.maladoptante' },
        ],
        addressInfo: null,
        isPublic: true,
        source: 'imported',
        sourceUrl: 'https://facebook.com/groups/rescate/posts/123456',
        country: 'AR',
        gated: false,
        overlay: {
            avgRating: 1,
            flags: NO_FLAGS,
            stats: { searchHits: 88, profileViews: 67, requests: 14, adoptions: 9 },
            thumbnail: null,
        },
    },
    {
        id: 'demo-juan-dudoso',
        name: 'Juan Dudoso',
        contactEntries: [
            { type: 'phone', value: '+54 11 6677-8899' },
            {
                type: 'address',
                value: joinedAddressValue('Calle Falsa 123', 'Quilmes, Buenos Aires'),
                streetAndNumber: 'Calle Falsa 123',
                locality: 'Quilmes, Buenos Aires',
            },
        ],
        addressInfo: null,
        isPublic: false,
        source: 'manual',
        sourceUrl: null,
        country: 'AR',
        gated: true,
        overlay: {
            avgRating: 2,
            flags: {
                ...NO_FLAGS,
                tooManyAdoptions: { count: 4, threshold: 3, periodDays: 20, actualSpanDays: 20 },
            },
            stats: { searchHits: 30, profileViews: 22, requests: 8, adoptions: 4 },
            thumbnail: null,
        },
    },
];

/** Stable, fixed creation/update timestamps so the demo cards read consistently. */
const DEMO_CREATED_AT = new Date('2024-03-12T12:00:00Z');
const DEMO_UPDATED_AT = new Date('2024-05-28T12:00:00Z');
/** Sentinel soft-delete timestamp — marks the row deleted (excluded from search). */
export const DEMO_DELETED_AT = new Date('2000-01-01T00:00:00Z');

/** Build the full adopter row for a fixture (used for seeding and the fallback). */
export function demoAdopterRow(f: DemoFixture): AdopterRow {
    const contactEntriesJson = JSON.stringify(f.contactEntries);
    return {
        id: f.id,
        name: f.name,
        contactInfo: contactEntriesToBlob(f.contactEntries) || null,
        contactEntries: contactEntriesJson,
        addressInfo: f.addressInfo,
        familyMembers: null,
        notes: null,
        createdAt: DEMO_CREATED_AT,
        updatedAt: DEMO_UPDATED_AT,
        status: '5',
        addedBy: 'system-demo',
        sourceUrl: f.sourceUrl,
        country: f.country,
        tokenHash: 'demo', // non-null so the tokenizer never picks it up
        deletedAt: DEMO_DELETED_AT,
        source: f.source,
        isPublic: f.isPublic ? 1 : 0,
        isDemo: 1,
    };
}

/**
 * Build a `DiscoveryMatch` for the demo card from an adopter row + overlay.
 *
 * Gated rows are masked with `NO_ACCESS_VISIBILITY` so the demo ALWAYS shows
 * the outsider view (the masking lesson holds even for an admin viewer). The
 * didactic name ("…BuenAdoptante") is kept fully visible on purpose — the
 * surname carries the teaching, and a real "Juan" search would reveal that
 * token anyway. Public rows pass through unmasked.
 */
export function buildDemoMatch(row: AdopterRow, overlay: DemoOverlay, gated: boolean): DiscoveryMatch {
    let adopter = row;
    if (gated && row.isPublic !== 1) {
        const masked = maskAdopterContact(row, NO_ACCESS_VISIBILITY);
        adopter = {
            ...row,
            contactInfo: masked.contactInfo,
            contactEntries: masked.contactEntries,
            addressInfo: masked.addressInfo,
            familyMembers: null,
        };
    }
    return {
        adopterId: row.id,
        adopterName: row.name,
        relevancePercent: 100,
        matchTypes: ['name_exact'],
        matchValues: [{ type: 'name', value: 'Juan' }],
        source: 'token',
        adopter,
        matchSnippet: null,
        avgRating: overlay.avgRating,
        thumbnail: overlay.thumbnail,
        stats: overlay.stats,
        flags: overlay.flags,
    };
}

/**
 * Build a demo match with ONLY the phone entry revealed — the accurate result of
 * a "name + phone" search-match (you see the value you matched; everything else
 * stays masked). Uses the real `maskAdopterContact` with just the phone entry
 * unlocked, so the email/address still partial-reveal exactly as in production.
 */
export function buildDemoMatchPhoneRevealed(row: AdopterRow, overlay: DemoOverlay): DiscoveryMatch {
    const phone = deserializeContactEntries(row.contactEntries).find(e => e.type === 'phone');
    const unlocked = new Set<string>();
    if (phone) unlocked.add(hashEntryValue('phone', phone.value));
    const vis: Visibility = { ...NO_ACCESS_VISIBILITY, tier: 'partial', unlockedEntryHashes: unlocked };
    const masked = maskAdopterContact(row, vis);
    const adopter: AdopterRow = {
        ...row,
        contactInfo: masked.contactInfo,
        contactEntries: masked.contactEntries,
        addressInfo: masked.addressInfo,
        familyMembers: null,
    };
    return {
        adopterId: row.id,
        adopterName: row.name,
        relevancePercent: 100,
        matchTypes: ['phone'],
        matchValues: [{ type: 'phone', value: 'Juan' }],
        source: 'token',
        adopter,
        matchSnippet: null,
        avgRating: overlay.avgRating,
        thumbnail: overlay.thumbnail,
        stats: overlay.stats,
        flags: overlay.flags,
    };
}

/** Overlay lookup by id (for merging an appConfig override later). */
export function demoOverlayFor(id: string): DemoOverlay | undefined {
    return WALKTHROUGH_DEMO_FIXTURES.find(f => f.id === id)?.overlay;
}

export function demoFixtureFor(id: string): DemoFixture | undefined {
    return WALKTHROUGH_DEMO_FIXTURES.find(f => f.id === id);
}

// ── Admin edit shape ──────────────────────────────────────────────────────────
// A flat, form-friendly view of one demo record: the maskable PII (lives on the
// real adopter row) plus the display overlay (rating/flags/stats — lives in the
// WALKTHROUGH_DEMO_OVERLAY appConfig JSON). The admin panel edits this; the save
// action splits it back into a row update + an overlay write.

export interface DemoRecordEdit {
    id: string;
    name: string;
    isPublic: boolean;
    phone: string;
    email: string;
    social: string;
    address: string;
    rating: number | null;
    verifiedAddress: boolean;
    verifiedIdentity: boolean;
    inaccurate: boolean;
    duplicate: boolean;
    /** 0 = no "too many adoptions" flag. */
    tooManyAdoptionsCount: number;
    tooManyAdoptionsDays: number;
    profileViews: number;
    requests: number;
    adoptions: number;
}

function firstEntryValue(entries: ContactEntry[], type: ContactEntryType): string {
    return entries.find(e => e.type === type)?.value ?? '';
}

/** Flatten a fixture (the defaults) into the editable shape. */
export function fixtureToEdit(f: DemoFixture): DemoRecordEdit {
    const e = f.contactEntries;
    const o = f.overlay;
    return {
        id: f.id,
        name: f.name,
        isPublic: f.isPublic,
        phone: firstEntryValue(e, 'phone'),
        email: firstEntryValue(e, 'email'),
        social: firstEntryValue(e, 'social'),
        address: firstEntryValue(e, 'address'),
        rating: o.avgRating,
        verifiedAddress: o.flags.verified_address,
        verifiedIdentity: o.flags.verified_identity,
        inaccurate: o.flags.inaccurate,
        duplicate: o.flags.duplicate,
        tooManyAdoptionsCount: o.flags.tooManyAdoptions?.count ?? 0,
        tooManyAdoptionsDays: o.flags.tooManyAdoptions?.periodDays ?? 20,
        profileViews: o.stats.profileViews,
        requests: o.stats.requests,
        adoptions: o.stats.adoptions,
    };
}

/** Overlay a saved DB row's PII onto an edit (admin load path). */
export function applyRowToEdit(edit: DemoRecordEdit, row: AdopterRow): DemoRecordEdit {
    const entries = deserializeContactEntries(row.contactEntries);
    return {
        ...edit,
        name: row.name,
        isPublic: row.isPublic === 1,
        phone: firstEntryValue(entries, 'phone'),
        email: firstEntryValue(entries, 'email'),
        social: firstEntryValue(entries, 'social'),
        address: firstEntryValue(entries, 'address') || (row.addressInfo ?? ''),
    };
}

/** Overlay a saved override onto an edit (admin load path). */
export function applyOverlayToEdit(edit: DemoRecordEdit, o: DemoOverlay): DemoRecordEdit {
    return {
        ...edit,
        rating: o.avgRating,
        verifiedAddress: o.flags.verified_address,
        verifiedIdentity: o.flags.verified_identity,
        inaccurate: o.flags.inaccurate,
        duplicate: o.flags.duplicate,
        tooManyAdoptionsCount: o.flags.tooManyAdoptions?.count ?? 0,
        tooManyAdoptionsDays: o.flags.tooManyAdoptions?.periodDays ?? 20,
        profileViews: o.stats.profileViews,
        requests: o.stats.requests,
        adoptions: o.stats.adoptions,
    };
}

/** Build contact entries from an edit (only the filled fields). */
export function editToContactEntries(e: DemoRecordEdit): ContactEntry[] {
    const out: ContactEntry[] = [];
    if (e.phone.trim()) out.push({ type: 'phone', value: e.phone.trim() });
    if (e.email.trim()) out.push({ type: 'email', value: e.email.trim() });
    if (e.social.trim()) out.push({ type: 'social', value: e.social.trim() });
    if (e.address.trim()) out.push({ type: 'address', value: e.address.trim() });
    return out;
}

/** Build the display overlay from an edit. */
export function editToOverlay(e: DemoRecordEdit): DemoOverlay {
    const count = Math.max(0, Math.round(e.tooManyAdoptionsCount));
    const days = Math.max(1, Math.round(e.tooManyAdoptionsDays));
    return {
        avgRating: e.rating,
        flags: {
            ...NO_FLAGS,
            verified_address: e.verifiedAddress,
            verified_identity: e.verifiedIdentity,
            inaccurate: e.inaccurate,
            duplicate: e.duplicate,
            tooManyAdoptions: count > 0 ? { count, threshold: 3, periodDays: days, actualSpanDays: days } : null,
        },
        stats: {
            searchHits: Math.max(0, Math.round(e.profileViews)),
            profileViews: Math.max(0, Math.round(e.profileViews)),
            requests: Math.max(0, Math.round(e.requests)),
            adoptions: Math.max(0, Math.round(e.adoptions)),
        },
        thumbnail: null,
    };
}

/** Build the adopter row to persist from an edit (keeps the fixture's provenance). */
export function editToAdopterRow(e: DemoRecordEdit): AdopterRow {
    const fixture = demoFixtureFor(e.id);
    const base = demoAdopterRow(fixture ?? WALKTHROUGH_DEMO_FIXTURES[0]);
    const entries = editToContactEntries(e);
    return {
        ...base,
        id: e.id,
        name: e.name.trim() || base.name,
        contactEntries: JSON.stringify(entries),
        contactInfo: contactEntriesToBlob(entries) || null,
        addressInfo: null,
        isPublic: e.isPublic ? 1 : 0,
    };
}
