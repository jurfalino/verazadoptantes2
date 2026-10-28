/**
 * Households as profiles (spec 2026-10-26-households-as-profiles-design): the
 * rules. Every person in a household is an adopter profile; a household is a
 * group of profiles (households / household_memberships). Pure — no DB, no
 * server imports. Reads and writes live in src/lib/households.ts.
 */
import type { Relationship } from '@/lib/householdMembers';
import { realOwner } from './dedupPair';
import type { OpenAlertKind } from './flags';

/** Households read per profile (bounded reads; a person in more is logged). */
export const MAX_HOUSEHOLDS_PER_PROFILE = 10;
/** Memberships read per household. */
export const MAX_HOUSEHOLD_MEMBERS = 30;
/** Housemates on one search / «¿Es este perfil?» card's household line. */
export const MAX_HOUSEHOLD_LINES = 10;

/** Under this current age a profile is a minor. */
export const MINOR_AGE_LIMIT = 18;

/**
 * Duplicate-pair match types that are PERSONAL identifiers (final fix S3): a
 * pair sharing one of these is never hidden or removed as «housemates» — two
 * people of one home share a phone, never an email or an ID number. Exactly
 * the tokenizer's `email` and `id_number` token types.
 */
export const PERSONAL_ID_MATCH_TYPES = ['email', 'id_number'] as const;

/** Does a duplicate pair's match types include a personal identifier? */
export function sharesPersonalIdentifier(types: Iterable<string> | null | undefined): boolean {
    if (!types) return false;
    for (const t of types) if ((PERSONAL_ID_MATCH_TYPES as readonly string[]).includes(t)) return true;
    return false;
}

/** A merge refused because part of a profile's old inline household could not be converted first (Task 7; retry later). */
export const HOUSEHOLD_NOT_CONVERTED = 'household_not_converted';

/** The only relationships shown back from the other side (no gender recorded, so no «padre de»). */
const SYMMETRIC: ReadonlySet<string> = new Set<Relationship>(['partner', 'sibling']);
const LABELLED: ReadonlySet<string> = new Set<Relationship>(['partner', 'child', 'parent', 'sibling', 'other_relative', 'housemate']);

/** The i18n key of a relationship word (`adopter.hh_rel_partner` …). */
export const relationshipKey = (rel: string) => `adopter.hh_rel_${rel}`;

/** A relationship worth a label: one of the known ones, never `unknown` / garbage. */
function labelled(rel: string | null | undefined): string | null {
    return rel && LABELLED.has(rel) ? rel : null;
}

export interface MembershipEdge {
    adopterId: string;
    relationship: string | null | undefined;
    relativeToAdopterId: string | null | undefined;
}

export type MembershipLabel = { key: string; params: Record<string, string> };

/**
 * How member `m` reads on the profile of `viewedProfileId`:
 * - `m` was added next to the viewed profile → «pareja» (`adopter.hh_rel_partner`).
 * - the viewed profile was added next to `m` with a symmetric relationship
 *   (partner, sibling) → that same word. Needs `viewedMembership` (the viewed
 *   profile's own membership in that household); without it, nothing.
 * - `m` was added next to another member → «pareja de Pedro»
 *   (`adopter.hh_rel_of`, params `{ rel, name }`). `params.rel` is itself an
 *   i18n KEY: callers translate it before interpolating.
 * - a relationship pointing at nobody stands alone («conviviente»).
 * - `unknown`, or a relative no longer in the household (not in `names`) → null:
 *   never a wrong «pareja».
 */
export function membershipLabel(
    viewedProfileId: string,
    m: MembershipEdge,
    names: Readonly<Record<string, string>>,
    viewedMembership?: MembershipEdge | null,
): MembershipLabel | null {
    if (m.adopterId === viewedProfileId) return null;
    const rel = labelled(m.relationship);
    const relative = m.relativeToAdopterId && m.relativeToAdopterId !== m.adopterId ? m.relativeToAdopterId : null;
    if (rel && relative === viewedProfileId) return { key: relationshipKey(rel), params: {} };

    const back = viewedMembership ? labelled(viewedMembership.relationship) : null;
    if (back && SYMMETRIC.has(back) && viewedMembership?.relativeToAdopterId === m.adopterId) {
        return { key: relationshipKey(back), params: {} };
    }

    if (!rel) return null;
    if (!relative) return { key: relationshipKey(rel), params: {} };
    const name = names[relative]?.trim();
    if (!name) return null;
    return { key: 'adopter.hh_rel_of', params: { rel: relationshipKey(rel), name } };
}

/** One profile of the household, with who put it there (null for a household's own anchor row). */
export interface HouseholdStanding {
    adopterId: string;
    addedBy?: string | null;
}

/**
 * Who may take a person out of a household:
 * - whoever added that membership — but never on a profile's own anchor row
 *   (added next to nobody: `relativeToAdopterId` empty). Whoever happened to
 *   create the household gets no rights over the person it was made for.
 * - the team (owner, org-mates) of a profile in that household — `privilegedOn`
 *   is isPrivilegedOnProfile per profile, so admins/moderators count there too —
 *   but only through a profile that the viewer's own team did NOT put there
 *   (`isOwnTeam(addedBy)`: the viewer or an org-mate). Standing is never
 *   self-granted: linking your own profile into a household gives you no power
 *   over the others (spec: «others only through the dispute path»).
 * - `isAdmin` covers admins and moderators directly.
 * Nobody signed in (or a sentinel like 'anonymous') never may.
 */
export function canRemoveMembership(
    viewer: {
        email: string | null | undefined;
        privilegedOn: (adopterId: string) => boolean;
        isAdmin: boolean;
        /** The viewer or one of their org-mates (case-insensitive). */
        isOwnTeam: (email: string | null | undefined) => boolean;
    },
    m: { addedBy?: string | null; relativeToAdopterId?: string | null },
    household: readonly HouseholdStanding[],
): boolean {
    const me = realOwner(viewer.email?.trim() ?? null)?.toLowerCase();
    if (!me) return false;
    if (viewer.isAdmin) return true;
    const adder = realOwner(m.addedBy?.trim() ?? null)?.toLowerCase();
    if (adder && adder === me && !!m.relativeToAdopterId) return true;
    const ownTeamAdded = (by: string | null | undefined) => {
        const b = realOwner(by?.trim() ?? null)?.toLowerCase();
        return !!b && (b === me || viewer.isOwnTeam(b));
    };
    return household.some(h => viewer.privilegedOn(h.adopterId) && !ownTeamAdded(h.addedBy));
}

/**
 * Age today: the recorded age plus whole years elapsed since `ageAsOf`
 * (YYYY-MM-DD). A malformed `ageAsOf` (e.g. '27/10/2026') makes the current
 * age unknown (null), never NaN.
 */
export function currentAge(
    m: { age?: number | null; ageAsOf?: string | null },
    today: Date = new Date(),
): number | null {
    if (typeof m.age !== 'number' || !Number.isFinite(m.age)) return null;
    if (!m.ageAsOf) return m.age;
    const [y, mo, d] = m.ageAsOf.split('-').map(Number);
    if (![y, mo, d].every(Number.isFinite)) return null;
    let years = today.getUTCFullYear() - y;
    const month = today.getUTCMonth() + 1;
    if (month < mo || (month === mo && today.getUTCDate() < d)) years--;
    return m.age + Math.max(0, years);
}

/**
 * «Menor de edad»: a known age decides (current age under 18 — so at 18 the
 * tag drops by itself, even though the box turned on when the age was
 * entered); with no age, or an unreadable `ageAsOf`, the «Es menor de edad»
 * checkbox (`is_minor`) does.
 */
export function isMinor(
    p: { age?: number | null; ageAsOf?: string | null; isMinor?: number | boolean | null },
    today: Date = new Date(),
): boolean {
    const age = currentAge(p, today);
    // Unknown (or unreadable) age: the checkbox decides — never fail open.
    if (age != null && Number.isFinite(age)) return age < MINOR_AGE_LIMIT;
    return !!p.isMinor;
}

/** A household with a gift membership is a gift household (never «Convive con»). */
export function isGiftHousehold(memberships: ReadonlyArray<{ giftRecipient?: number | boolean | null }>): boolean {
    return memberships.some(m => !!m.giftRecipient);
}

/**
 * The key two names in one household are "the same person" by (unattended
 * adds, the interview's rule): case, accents and spacing ignored.
 */
export function householdNameKey(name: string | null | undefined): string {
    return (name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * A housemate on a search / «¿Es este perfil?» card: «Convive con Pedro ★1».
 * Live summary data only (name, rating, open alerts, minor) — never contacts.
 */
export type HouseholdLine = {
    name: string;
    profileId: string;
    rating: number | null;
    /** Open alerts, one per kind (openAlertKinds). */
    openAlerts: OpenAlertKind[];
    isMinor: boolean;
    /** Every household the two share is a gift household (never «Convive con»). */
    isGift: boolean;
    /** The home the line belongs to (the first ordinary one the two share): the card groups by it — «Convive con» / «En otro hogar, con». */
    householdId: string;
};

/**
 * The card's household line grouped by home, in order: the first home is
 * «Convive con», every later one «En otro hogar, con». Gift-only lines are
 * left out (a gift recipient doesn't live there).
 */
export function householdLineGroups(lines: ReadonlyArray<HouseholdLine> | null | undefined): HouseholdLine[][] {
    const groups = new Map<string, HouseholdLine[]>();
    for (const l of lines ?? []) {
        if (l.isGift) continue;
        const g = groups.get(l.householdId);
        if (g) g.push(l); else groups.set(l.householdId, [l]);
    }
    return [...groups.values()];
}

/**
 * Which household «+ Agregar» names (Task 8, coordinator ruling; compact
 * section, addendum 2026-10-27): the home it adds into, always — the one home
 * the profile is in, or the one picked in «¿En qué hogar?». Only a
 * profile-level add (the profile is in no household yet) names none, so the
 * server's own-home default applies (Task 2 fix A: being linked into X's home
 * never makes X the default of a profile-level add).
 */
export function householdForAdd(view: { id: string } | null): string | undefined {
    return view ? view.id : undefined;
}

/**
 * The homes are told apart — a small divider per home and «¿En qué hogar?»
 * before adding — only when the profile lives in 2+ (addendum 2026-10-27:
 * no «Hogar con …» titles otherwise; one home's rows say who lives there).
 */
export function separateHomes(homes: ReadonlyArray<unknown>): boolean {
    return homes.length >= 2;
}
