/**
 * Which rescue each rescuer belongs to, for "pide adoptar demasiado seguido"
 * (src/domain/requestDensity.ts) and for "this rescue" checks. Server-only.
 *
 * Reads ALL of org_members once (a small table) instead of one lookup per
 * rescuer: one query on the hot paths (search enrichment, the dashboard), and
 * the grouping no longer depends on which rescuers a page happened to load —
 * the search card and the profile agree.
 */
import { orgMembers } from '@/db/schema';
import { logger } from '@/lib/logger';
import { groupRescues, knownRescuer } from '@/domain/requestDensity';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

/** email → its organization ids. Empty on a failed read (each rescuer then counts on its own), logged. */
export async function loadOrgMembership(db: Db, op: string): Promise<Map<string, string[]>> {
    const rows = await (db.select({ orgId: orgMembers.orgId, userEmail: orgMembers.userEmail }).from(orgMembers).all() as Promise<Array<{ orgId: string; userEmail: string }>>)
        .catch((e: unknown) => {
            logger.warn(`${op}: org membership read failed, rescuers count on their own`, { error: e instanceof Error ? e.message : String(e) });
            return [] as Array<{ orgId: string; userEmail: string }>;
        });
    const out = new Map<string, string[]>();
    for (const r of rows) {
        const e = knownRescuer(r.userEmail);
        if (!e) continue;
        out.set(e, [...(out.get(e) ?? []), r.orgId]);
    }
    return out;
}

/** Rescue key per known rescuer (organizations merged, also through chains). */
export async function loadRescueKeys(db: Db, op: string): Promise<Map<string, string>> {
    return groupRescues(await loadOrgMembership(db, op));
}

export function rescueKeyOf(addedBy: string | null | undefined, keys: Map<string, string>): string | null {
    const e = knownRescuer(addedBy);
    return e ? keys.get(e) ?? `user:${e}` : null;
}

/** Records with their `rescueKey` set (unknown rescuers get none). */
export function withRescueKeys<T extends { addedBy?: string | null }>(records: T[], keys: Map<string, string>): Array<T & { rescueKey: string | null }> {
    return records.map(r => ({ ...r, rescueKey: rescueKeyOf(r.addedBy, keys) }));
}

/**
 * For the browser: the same grouping with opaque per-response labels, so a
 * page never learns which organization other rescuers belong to.
 */
export function withOpaqueRescueKeys<T extends { addedBy?: string | null }>(records: T[], keys: Map<string, string>): Array<T & { rescueKey: string | null }> {
    const label = new Map<string, string>();
    return records.map(r => {
        const k = rescueKeyOf(r.addedBy, keys);
        if (!k) return { ...r, rescueKey: null };
        if (!label.has(k)) label.set(k, `r${label.size + 1}`);
        return { ...r, rescueKey: label.get(k)! };
    });
}

/**
 * Same rescue for access decisions (form answers, look-ups): the same person,
 * or a DIRECTLY shared organization. Stricter than the count's chain grouping
 * on purpose: someone in two organizations must not open one team's applicant
 * answers to the other.
 */
export function sameRescueDirect(a: string | null | undefined, b: string | null | undefined, membership: Map<string, string[]>): boolean {
    const ea = knownRescuer(a), eb = knownRescuer(b);
    if (!ea || !eb) return false;
    if (ea === eb) return true;
    const orgsA = new Set(membership.get(ea) ?? []);
    return (membership.get(eb) ?? []).some(o => orgsA.has(o));
}
