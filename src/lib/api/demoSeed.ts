/**
 * The API docs' demo people, on STAGING only (Jon, 2026-10-17): every profile
 * the exact-search scenarios need (src/lib/api/docScenarios.ts), registered the
 * way real ones are — adopter row + contact entries, records through
 * insertRecord (ratings, dates, the rescue that added each), marks in
 * adopter_flags, a pending duplicate candidate, and the search tokens
 * (tokenizeAdopter) — so each documented request returns the documented answer.
 *
 * Re-running resets them: the demo profiles (ids `demo-api-*`) and everything
 * on them are deleted and written again with dates relative to today (the
 * "4 rescues in the last 30 days" alert must stay true), and profiles the API
 * created for the scenarios' people (source 'api', a scenario name) go too.
 * Never callable in production — the route refuses there.
 */
import { and, eq, like, or } from 'drizzle-orm';
import { adopterEvents, adopterFlags, adopterHistory, adopters, animals, duplicateCandidates, duplicateTokens, placements } from '@/db/schema';
import { buildContactEntries, contactEntriesToBlob } from '@/lib/contactEntries';
import { insertRecord } from '@/app/actions/_recordWrite';
import { tokenizeAdopter } from '@/lib/adopterTokenize';
import { logger } from '@/lib/logger';
import { DEFAULT_RESCUE, demoCreatedNames, demoProfiles, type Registered } from './docScenarios';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const DAY_MS = 86_400_000;
const TWIN_SUFFIX = '-twin';

/** Everything on one profile, then the profile. D1: one id at a time (no IN with arrays). */
async function removeProfile(db: Db, id: string): Promise<void> {
    const plcs = await db.select({ animalId: placements.animalId }).from(placements).where(eq(placements.adopterId, id)).all() as Array<{ animalId: string }>;
    await db.delete(placements).where(eq(placements.adopterId, id));
    for (const p of plcs) await db.delete(animals).where(eq(animals.id, p.animalId));
    await db.delete(adopterEvents).where(eq(adopterEvents.adopterId, id));
    await db.delete(adopterFlags).where(eq(adopterFlags.adopterId, id));
    await db.delete(duplicateCandidates).where(or(eq(duplicateCandidates.adopter1Id, id), eq(duplicateCandidates.adopter2Id, id)));
    await db.delete(duplicateTokens).where(eq(duplicateTokens.adopterId, id));
    await db.delete(adopterHistory).where(eq(adopterHistory.adopterId, id));
    await db.delete(adopters).where(eq(adopters.id, id));
}

async function createProfile(db: Db, p: Pick<Registered, 'id' | 'name' | 'email' | 'phone' | 'documentId'>): Promise<void> {
    const entries = buildContactEntries({
        ids: p.documentId ? [{ value: p.documentId, label: 'Documento' }] : [],
        emails: p.email ? [p.email] : [],
        phones: p.phone ? [p.phone] : [],
    }).map(e => ({ ...e, addedBy: DEFAULT_RESCUE }));
    await db.insert(adopters).values({
        id: p.id,
        name: p.name,
        contactInfo: contactEntriesToBlob(entries) || null,
        contactEntries: JSON.stringify(entries),
        familyMembers: null,
        status: '5',
        addedBy: DEFAULT_RESCUE,
        sourceUrl: null,
        country: 'AR',
        isPublic: 0,
        source: 'api',
    });
}

export interface DemoSeedResult { profiles: number; records: number; removed: number }

export async function seedApiDemo(db: Db, now: Date = new Date()): Promise<DemoSeedResult> {
    const profiles = demoProfiles();
    let removed = 0;

    // 1. Reset: the demo profiles (and the duplicate twin), then what the API made for the scenarios' people.
    const existing = await db.select({ id: adopters.id }).from(adopters).where(like(adopters.id, 'demo-api-%')).all() as Array<{ id: string }>;
    for (const { id } of existing) { await removeProfile(db, id); removed++; }
    for (const name of demoCreatedNames()) {
        const made = await db.select({ id: adopters.id }).from(adopters).where(and(eq(adopters.name, name), eq(adopters.source, 'api'))).all() as Array<{ id: string }>;
        for (const { id } of made) { await removeProfile(db, id); removed++; }
    }

    // 2. Register them again, dated relative to today.
    let records = 0;
    const noon = (daysAgo: number) => {
        const d = new Date(now.getTime() - daysAgo * DAY_MS);
        d.setUTCHours(12, 0, 0, 0);
        return d;
    };
    for (const p of profiles) {
        await createProfile(db, p);
        for (const [k, h] of p.history.entries()) {
            const placed = h.type === 'adoption';
            await insertRecord(db, {
                id: `${p.id}-r${k}`,
                adopterId: p.id,
                recordType: h.type,
                date: noon(h.daysAgo),
                rating: h.rating ?? null,
                ...(placed ? { animalName: `Demo ${k + 1}`, species: 'dog' } : {}),
            }, h.by ?? DEFAULT_RESCUE);
            records++;
        }
        for (const reason of p.marks ?? []) {
            await db.insert(adopterFlags).values({ id: `${p.id}-flag-${reason}`, adopterId: p.id, flaggedBy: DEFAULT_RESCUE, reason });
        }
        if (p.possibleDuplicate) {
            // Another profile that may be the same person: a pending candidate, as the duplicate scan files them.
            const twin = `${p.id}${TWIN_SUFFIX}`;
            await createProfile(db, { id: twin, name: `${p.name.split(' ')[0]} B. ${p.name.split(' ').slice(1).join(' ')}`, email: `${p.id}${TWIN_SUFFIX}@example.com` });
            await db.insert(duplicateCandidates).values({
                id: `${p.id}-dup`, adopter1Id: p.id, adopter2Id: twin,
                matchTypes: JSON.stringify(['name_word']), matchValues: null, score: 60, confidence: 'medium', status: 'pending',
            });
            await tokenizeAdopter(twin);
        }
        await tokenizeAdopter(p.id);
    }
    logger.info('api demo seed: done', { profiles: profiles.length, records, removed });
    return { profiles: profiles.length, records, removed };
}
