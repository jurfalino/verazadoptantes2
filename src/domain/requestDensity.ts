/**
 * "Pide adoptar demasiado seguido" counts RESCUES, not requests (Jon,
 * 2026-10-13): someone who fills one form per animal at the same shelter is
 * normal; asking at many different rescues in a short time is the signal.
 *
 * A rescue is an organization (all its members count as one), or a rescuer
 * with no organization. Records whose rescuer is unknown (some early imports)
 * each count as a rescue of their own, so a real pattern is never hidden.
 * Pure: the caller supplies who belongs to which organization.
 */
import { RECORD_TYPES } from './constants';

export interface DensityResult { count: number; timeSpanDays: number; startDate: Date | null; endDate: Date | null }

/** The rescuer behind a record, or null when unknown. */
export function knownRescuer(addedBy: string | null | undefined): string | null {
    const e = (addedBy ?? '').trim().toLowerCase();
    if (!e || e === 'anonymous' || !e.includes('@')) return null;
    return e;
}

/**
 * Rescue key per rescuer email. Rescuers who share any organization are one
 * rescue — also through a chain (A and B share org 1, B and C share org 2), so
 * someone in two organizations never splits a team in two.
 */
export function groupRescues(orgsByEmail: Map<string, string[]>): Map<string, string> {
    const parent = new Map<string, string>();
    const find = (x: string): string => {
        let r = x;
        while (parent.get(r) !== r) r = parent.get(r)!;
        let c = x;
        while (c !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; }
        return r;
    };
    const union = (a: string, b: string) => {
        const ra = find(a), rb = find(b);
        if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
    };
    for (const [rawEmail, orgs] of orgsByEmail) {
        const email = `user:${rawEmail.trim().toLowerCase()}`;
        if (!parent.has(email)) parent.set(email, email);
        for (const org of orgs) {
            const node = `org:${org}`;
            if (!parent.has(node)) parent.set(node, node);
            union(email, node);
        }
    }
    const out = new Map<string, string>();
    for (const rawEmail of orgsByEmail.keys()) out.set(rawEmail.trim().toLowerCase(), find(`user:${rawEmail.trim().toLowerCase()}`));
    return out;
}

type RecordLike = { recordType?: string | null; date?: Date | number | string | null; addedBy?: string | null; rescueKey?: string | null };

function toMs(date: RecordLike['date']): number | null {
    if (date == null || date === '') return null;
    const d = typeof date === 'number' ? new Date(date * 1000) : new Date(date);
    const t = d.getTime();
    return Number.isNaN(t) ? null : t;
}

/**
 * The most DIFFERENT rescues the person asked to adopt at within any window of
 * `periodDays` (Infinity = all time). Each record's rescue is its `rescueKey`
 * (set by the server from organization membership), else its rescuer's email,
 * else a key of its own when the rescuer is unknown.
 */
export function computeRequestRescueDensity(records: RecordLike[], periodDays: number): DensityResult {
    const points: Array<{ t: number; key: string }> = [];
    records.forEach((r, i) => {
        if (r.recordType !== RECORD_TYPES.REQUEST) return;
        const t = toMs(r.date);
        if (t == null) return;
        const rescuer = knownRescuer(r.addedBy);
        const key = r.rescueKey || (rescuer ? `user:${rescuer}` : `unknown:${i}`);
        points.push({ t, key });
    });
    if (points.length === 0) return { count: 0, timeSpanDays: 0, startDate: null, endDate: null };
    points.sort((a, b) => a.t - b.t);

    const windowMs = periodDays === Infinity ? Infinity : periodDays * 86_400_000;
    const inWindow = new Map<string, number>();
    let best = 0, bestL = 0, bestR = 0, left = 0;
    for (let right = 0; right < points.length; right++) {
        inWindow.set(points[right].key, (inWindow.get(points[right].key) ?? 0) + 1);
        while (points[right].t - points[left].t > windowMs) {
            const k = points[left].key;
            const n = inWindow.get(k)! - 1;
            if (n === 0) inWindow.delete(k); else inWindow.set(k, n);
            left++;
        }
        if (inWindow.size >= best) { best = inWindow.size; bestL = left; bestR = right; }
    }
    const startMs = points[bestL].t, endMs = points[bestR].t;
    return { count: best, timeSpanDays: (endMs - startMs) / 86_400_000, startDate: new Date(startMs), endDate: new Date(endMs) };
}
