/**
 * Follow-up projection — pure domain logic (v2.55.16, animal-timeline PR3).
 *
 * The future timeline is COMPUTED from rules, never materialized: given a
 * placement, the animal, the user's schedule and what was already recorded,
 * `computeFollowups` returns the projected slots with their status. Shared by
 * the animal page, the /my-animals badges and the reminder cron Worker — the
 * Worker imports this file by relative path, so it must stay free of DB,
 * server and 'use server' imports.
 *
 * Design notes (validated in the session prototype, see the feature plan):
 * - `windowDays` is load-bearing: past the window a slot becomes 'missed',
 *   which both declutters the page and prevents a cold-start notification
 *   storm on the first cron run over old adoptions.
 * - Matching runs in two passes: exact `followupKey`, then a greedy
 *   nearest-date heuristic. A record whose key matches NO slot in the current
 *   schedule (orphaned by a settings edit) re-enters the heuristic — completed
 *   work must never "un-complete" because the user re-timed their schedule.
 * - Subtypes are the SAME for adoption and foster placements (product
 *   decision): adaptation | vaccination | neuter | vet_visit.
 */

export const FOLLOWUP_STATUS = {
    UPCOMING: 'upcoming',
    DUE: 'due',
    MISSED: 'missed',
    DONE: 'done',
} as const;
export type FollowupStatus = typeof FOLLOWUP_STATUS[keyof typeof FOLLOWUP_STATUS];

export type FollowupKind = 'checkin' | 'health';

/** Follow-up subtypes (adopter_events.followup_subtype). Same set in adoption
 *  and transit; legacy rows stay NULL. */
export const FOLLOWUP_SUBTYPES = ['adaptation', 'vaccination', 'neuter', 'vet_visit'] as const;
export type FollowupSubtype = typeof FOLLOWUP_SUBTYPES[number];

export interface ScheduleEntry {
    key: string;             // 'checkin_7d' | 'checkin_30d' | 'checkin_180d' | 'health_vaccines' | 'health_neuter'
    kind: FollowupKind;
    copyKey: string;         // i18n suffix (followups.<copyKey>)
    subtype: FollowupSubtype;
    offsetDays?: number;     // checkin: due = placement.startedAt + offsetDays
    windowDays: number;      // actionable window; past it → 'missed'
}

export const DEFAULT_SCHEDULE: ScheduleEntry[] = [
    { key: 'checkin_7d', kind: 'checkin', copyKey: 'checkin_7d', subtype: 'adaptation', offsetDays: 7, windowDays: 7 },
    { key: 'checkin_30d', kind: 'checkin', copyKey: 'checkin_30d', subtype: 'adaptation', offsetDays: 30, windowDays: 21 },
    { key: 'checkin_180d', kind: 'checkin', copyKey: 'checkin_180d', subtype: 'adaptation', offsetDays: 180, windowDays: 45 },
    { key: 'health_vaccines', kind: 'health', copyKey: 'health_vaccines', subtype: 'vaccination', windowDays: 60 },
    { key: 'health_neuter', kind: 'health', copyKey: 'health_neuter', subtype: 'neuter', windowDays: 120 },
];

/** Transit check-in: a light recurring control while a foster span is active. */
export const DEFAULT_FOSTER_RULE = { intervalDays: 30, windowDays: 14 } as const;
export interface FosterRule { intervalDays: number; windowDays: number; disabled?: boolean }

/** Vaccines milestone applies iff adopted younger than this. */
export const VACCINES_AGE_LIMIT_DAYS = 240; // ~8 months
/** Vaccines due shortly after the adoption. */
export const VACCINES_DUE_OFFSET_DAYS = 3;
/** Neuter suggested at this age. */
export const NEUTER_AGE_DAYS = 150; // ~5 months
/** A vaccination up to this long BEFORE the due date still satisfies the
 *  milestone (a dose given in rescue/transit — no double reminder). */
export const VACCINES_LOOKBACK_DAYS = 33;
/** Other slots accept records slightly before the due date. */
export const MATCH_PRE_DAYS = 3;

/** One WhatsApp/Telegram message template per subtype; `{animal}`, `{familia}`
 *  and `{dias}` interpolate at send time (src/lib/interpolate.ts). */
export const DEFAULT_MESSAGES: Record<FollowupSubtype, string> = {
    adaptation: '¡Hola {familia}! ¿Cómo va {animal}? Ya pasaron {dias} días 🐾 ¿Me contás cómo se está adaptando?',
    vaccination: '¡Hola {familia}! Te escribo por las vacunas de {animal}: ¿pudieron avanzar con el plan? Si necesitan, les paso veterinarias.',
    neuter: '¡Hola {familia}! {animal} ya está en edad de castración. ¿Quieren que les pase turnos o campañas gratuitas de la zona?',
    vet_visit: '¡Hola {familia}! ¿Cómo salió la visita al veterinario de {animal}? Quedo a disposición.',
};

/** Per-user overrides (user_profiles.followup_settings JSON). `checkins`
 *  present = FULL replacement of the check-in entries. */
export interface FollowupSettings {
    version: 1;
    disabledKeys?: string[];
    checkins?: { offsetDays: number; windowDays?: number }[];
    fosterIntervalDays?: number;
    messages?: Partial<Record<FollowupSubtype, string>>;
    /** v2.55.19: ALSO deliver this user's follow-up reminders by email
     *  (opt-in; the bell always fires). Per-recipient — with team reminders,
     *  each member chooses their own channel. */
    emailReminders?: boolean;
}

/** Tolerant parse: garbage/legacy JSON → null (defaults). Never throws. */
export function parseFollowupSettings(json: string | null | undefined): FollowupSettings | null {
    if (!json) return null;
    try {
        const parsed = JSON.parse(json);
        if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) return null;
        const out: FollowupSettings = { version: 1 };
        if (Array.isArray(parsed.disabledKeys)) out.disabledKeys = parsed.disabledKeys.filter((k: unknown) => typeof k === 'string');
        if (Array.isArray(parsed.checkins)) {
            const checkins = parsed.checkins
                .filter((c: unknown) => !!c && typeof c === 'object' && Number.isFinite((c as { offsetDays?: unknown }).offsetDays))
                .map((c: { offsetDays: number; windowDays?: number }) => ({
                    offsetDays: Math.max(1, Math.round(c.offsetDays)),
                    ...(Number.isFinite(c.windowDays) ? { windowDays: Math.max(1, Math.round(c.windowDays as number)) } : {}),
                }));
            if (checkins.length) out.checkins = checkins;
        }
        if (Number.isFinite(parsed.fosterIntervalDays)) out.fosterIntervalDays = Math.max(7, Math.round(parsed.fosterIntervalDays));
        if (parsed.emailReminders === true) out.emailReminders = true;
        if (parsed.messages && typeof parsed.messages === 'object') {
            const messages: Partial<Record<FollowupSubtype, string>> = {};
            for (const st of FOLLOWUP_SUBTYPES) {
                const v = (parsed.messages as Record<string, unknown>)[st];
                if (typeof v === 'string' && v.trim()) messages[st] = v;
            }
            if (Object.keys(messages).length) out.messages = messages;
        }
        return out;
    } catch {
        // Deliberate swallow: settings are a convenience — broken JSON must mean
        // "defaults", never a broken page/cron. Callers log the raw value's
        // provenance if they care.
        return null;
    }
}

/** Merge the user's overrides into the default schedule. Custom check-in keys
 *  are deterministic (`checkin_${offsetDays}d`) so dedup keys stay stable; a
 *  custom offset that matches a default entry inherits ITS window (7/21/45). */
export function mergeSchedule(defaults: ScheduleEntry[], override: FollowupSettings | null): ScheduleEntry[] {
    if (!override) return defaults;
    let schedule = defaults;
    if (override.checkins?.length) {
        const customs: ScheduleEntry[] = [...override.checkins]
            .sort((a, b) => a.offsetDays - b.offsetDays)
            .map(c => ({
                key: `checkin_${c.offsetDays}d`,
                kind: 'checkin' as const,
                copyKey: 'checkin_custom',
                subtype: 'adaptation' as const,
                offsetDays: c.offsetDays,
                windowDays: c.windowDays
                    ?? defaults.find(d => d.key === `checkin_${c.offsetDays}d`)?.windowDays
                    ?? 14,
            }));
        schedule = [...customs, ...defaults.filter(e => e.kind === 'health')];
    }
    if (override.disabledKeys?.length) {
        schedule = schedule.filter(e => !override.disabledKeys!.includes(e.key));
    }
    return schedule;
}

/** The effective foster rule for a user. Disabled via disabledKeys 'foster_checkin'. */
export function mergeFosterRule(override: FollowupSettings | null): FosterRule {
    return {
        intervalDays: override?.fosterIntervalDays ?? DEFAULT_FOSTER_RULE.intervalDays,
        windowDays: DEFAULT_FOSTER_RULE.windowDays,
        disabled: !!override?.disabledKeys?.includes('foster_checkin'),
    };
}

export function getMessageTemplate(subtype: FollowupSubtype, override: FollowupSettings | null): string {
    return override?.messages?.[subtype] || DEFAULT_MESSAGES[subtype];
}

export interface RecordedFollowup {
    id: string;
    date: Date | null;
    followupKey: string | null;
    subtype: string | null; // adopter_events.followup_subtype (null on legacy rows)
    /** 'follow_up' | 'returned_pet' (adopter_events) or an ANIMAL_EVENT_TYPES value. */
    eventType: string;
}

export interface ProjectedFollowup {
    key: string;
    kind: FollowupKind;
    subtype: FollowupSubtype;
    copyKey: string;
    /** For checkin_custom copy: the offset in days. */
    offsetDays?: number;
    dueDate: Date;
    windowEndsAt: Date;
    status: FollowupStatus;
    satisfiedById?: string;
}

const DAY_MS = 86400000;
export function addDays(d: Date | number, n: number): Date {
    return new Date((d instanceof Date ? d.getTime() : d) + n * DAY_MS);
}

export interface ComputeFollowupsInput {
    placementStartedAt: Date;
    placementType?: string; // 'adoption' (default) | 'foster'
    animal: { estimatedBirthDate: Date | null; neutered: number | null };
    schedule: ScheduleEntry[];
    fosterRule?: FosterRule;
    recorded: RecordedFollowup[];
    now: Date;
}

/**
 * Project the follow-up slots for one placement and resolve each one's status:
 * 'done' (a recorded event satisfies it), 'upcoming' (before due), 'due'
 * (inside the window) or 'missed' (past the window — never notified).
 */
export function computeFollowups(input: ComputeFollowupsInput): ProjectedFollowup[] {
    const { placementStartedAt, placementType = 'adoption', animal, schedule, recorded, now } = input;
    const fosterRule = input.fosterRule ?? { ...DEFAULT_FOSTER_RULE };

    const slots: ProjectedFollowup[] = [];

    if (placementType === 'foster') {
        if (fosterRule.disabled) return [];
        // Recurring series: the full past + only the NEXT upcoming occurrence.
        for (let n = 1; n <= 60; n++) {
            const dueDate = addDays(placementStartedAt, n * fosterRule.intervalDays);
            slots.push({
                key: `foster_checkin_m${n}`, kind: 'checkin', subtype: 'adaptation',
                copyKey: 'foster_checkin', offsetDays: n * fosterRule.intervalDays,
                dueDate, windowEndsAt: addDays(dueDate, fosterRule.windowDays),
                status: FOLLOWUP_STATUS.UPCOMING,
            });
            if (dueDate > now) break;
        }
    } else {
        for (const e of schedule) {
            let dueDate: Date;
            if (e.kind === 'checkin') {
                dueDate = addDays(placementStartedAt, e.offsetDays ?? 0);
            } else if (e.key === 'health_vaccines') {
                if (!animal.estimatedBirthDate) continue;
                const ageAtPlacementDays = (placementStartedAt.getTime() - animal.estimatedBirthDate.getTime()) / DAY_MS;
                if (ageAtPlacementDays >= VACCINES_AGE_LIMIT_DAYS) continue;
                dueDate = addDays(placementStartedAt, VACCINES_DUE_OFFSET_DAYS);
            } else if (e.key === 'health_neuter') {
                if (!animal.estimatedBirthDate) continue;
                dueDate = addDays(animal.estimatedBirthDate, NEUTER_AGE_DAYS);
            } else {
                continue;
            }
            slots.push({
                key: e.key, kind: e.kind, subtype: e.subtype, copyKey: e.copyKey,
                offsetDays: e.offsetDays, dueDate, windowEndsAt: addDays(dueDate, e.windowDays),
                status: FOLLOWUP_STATUS.UPCOMING,
            });
        }
    }

    // ── matching ──
    const used = new Set<string>();
    const slotKeys = new Set(slots.map(s => s.key));

    // Pass 1: exact followupKey (recorded from the slot's own CTA).
    for (const s of slots) {
        const r = recorded.find(r => r.followupKey === s.key && !used.has(r.id));
        if (r) { s.satisfiedById = r.id; used.add(r.id); }
    }

    // Pass 2: greedy nearest-date heuristic for organically-logged records AND
    // records whose key was orphaned by a schedule edit. Each record satisfies
    // at most one slot. A follow_up with a health subtype satisfies its health
    // milestone (the contact happened); check-in slots take only adaptation/NULL.
    for (const s of slots) {
        if (s.satisfiedById) continue;
        if (s.key === 'health_neuter' && animal.neutered === 1) {
            s.satisfiedById = '__neutered_flag__';
            continue;
        }
        const eligibleType = (r: RecordedFollowup): boolean => {
            if (s.kind === 'checkin') return r.eventType === 'follow_up' && (!r.subtype || r.subtype === 'adaptation');
            if (s.key === 'health_vaccines') {
                return r.eventType === 'vaccination' || r.eventType === 'vet_visit'
                    || (r.eventType === 'follow_up' && r.subtype === 'vaccination');
            }
            return r.eventType === 'neuter' || (r.eventType === 'follow_up' && r.subtype === 'neuter');
        };
        const preDays = s.key === 'health_vaccines' ? VACCINES_LOOKBACK_DAYS : MATCH_PRE_DAYS;
        const from = addDays(s.dueDate, -preDays).getTime();
        const to = s.windowEndsAt.getTime();
        const candidates = recorded
            .filter(r => !used.has(r.id)
                && (!r.followupKey || !slotKeys.has(r.followupKey))
                && !!r.date && eligibleType(r)
                && r.date.getTime() >= from && r.date.getTime() <= to)
            .sort((a, b) => Math.abs(a.date!.getTime() - s.dueDate.getTime()) - Math.abs(b.date!.getTime() - s.dueDate.getTime()));
        if (candidates[0]) { s.satisfiedById = candidates[0].id; used.add(candidates[0].id); }
    }

    for (const s of slots) {
        s.status = s.satisfiedById ? FOLLOWUP_STATUS.DONE
            : now < s.dueDate ? FOLLOWUP_STATUS.UPCOMING
            : now <= s.windowEndsAt ? FOLLOWUP_STATUS.DUE
            : FOLLOWUP_STATUS.MISSED;
    }
    return slots.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
}
