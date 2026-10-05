/**
 * The question bank (spec §4.3). Copy lives in i18n `interview.q.<id>`; Jon
 * edits the Spanish before flag-on (D5). Ordering, applicability and
 * follow-ups are rules here; `queue.ts` applies them.
 */
import type { Answer, QuestionDef } from './types';

/** Test a regex against everything an answer says: text, choice, household. */
export function textMatches(re: RegExp): (a: Answer) => boolean {
    return (a) => {
        const parts = [a.text ?? '', a.choice ?? '', ...(a.household ?? []).flatMap(h => [h.name, h.relationship ?? ''])];
        return re.test(parts.filter(Boolean).join('\n'));
    };
}

const LOST_PET = /(perd|escap|muri|falleci|regal|devolv|lost|ran away|died|passed away|gave (him|her|it) away|rehom|returned|perdeu|fugiu|morreu|faleceu|doei|devolvi)/i;
const KIDS = /(child|hij|niñ|nene|nena|beb|chic[oa]s?\b|kid|son\b|daughter|baby|filh|crian)/i;
const PETS_NOW = /(perr|gat|dog|cat|cachorr|gato|cão|cao)/i;
const yearsHere = (a?: Answer) => (a?.status === 'answered' && typeof a.number === 'number' ? a.number : null);

export const QUESTION_BANK: readonly QuestionDef[] = [
    // ── Confianza (rapport) ───────────────────────────────────────────────
    { id: 'rapport_good_time', stage: 'rapport', kind: 'choice', priority: 5, fills: [], choices: ['yes', 'later'] },
    { id: 'rapport_how_found', stage: 'rapport', kind: 'text', priority: 10, fills: ['how_found'] },
    { id: 'rapport_work', stage: 'rapport', kind: 'text', priority: 20, fills: ['work'] },
    { id: 'rapport_area', stage: 'rapport', kind: 'text', priority: 30, fills: ['locality'], dedup: true, when: (k) => !k.address },
    { id: 'rapport_nickname', stage: 'rapport', kind: 'text', priority: 40, fills: ['aliases'], dedup: true },
    { id: 'rapport_phone', stage: 'rapport', kind: 'contact', priority: 50, fills: ['phones'], dedup: true, verifies: 'phones' },
    { id: 'rapport_social', stage: 'rapport', kind: 'contact', priority: 60, fills: ['socials'], dedup: true, verifies: 'socials' },
    { id: 'rapport_childhood_pets', stage: 'rapport', kind: 'text', priority: 65, fills: [] },
    { id: 'rapport_why_now', stage: 'rapport', kind: 'text', priority: 70, fills: ['motivation'] },

    // ── Historia (open narrative) ─────────────────────────────────────────
    { id: 'story_typical_day', stage: 'story', kind: 'text', priority: 10, fills: ['schedule'], hint: true },
    { id: 'story_home', stage: 'story', kind: 'text', priority: 20, fills: [] },
    { id: 'story_housing_type', stage: 'story', kind: 'choice', priority: 25, fills: ['housing_type'], choices: ['house', 'apartment', 'ph', 'other'] },
    { id: 'story_tenure', stage: 'story', kind: 'choice', priority: 26, fills: ['housing_tenure'], choices: ['own', 'rent', 'family'] },
    { id: 'story_years_here', stage: 'story', kind: 'number', priority: 27, fills: ['years_at_address'] },
    { id: 'story_address', stage: 'story', kind: 'text', priority: 28, fills: ['address'], dedup: true, verifies: 'address' },
    { id: 'story_household', stage: 'story', kind: 'household', priority: 30, fills: ['household'], dedup: true },
    { id: 'story_household_opinion', stage: 'story', kind: 'text', priority: 35, fills: ['household_agree'], when: (k) => k.household.length > 0 },
    { id: 'story_pets_now', stage: 'story', kind: 'text', priority: 40, fills: ['pets_current'] },
    { id: 'story_pets_past', stage: 'story', kind: 'text', priority: 45, fills: ['pets_past'], hint: true },
    { id: 'story_time_alone', stage: 'story', kind: 'number', priority: 50, fills: ['time_alone'] },
    { id: 'story_outdoor', stage: 'story', kind: 'text', priority: 55, fills: ['outdoor_space'] },
    { id: 'story_vet', stage: 'story', kind: 'text', priority: 60, fills: ['vet'] },

    // ── Detalles (probing) ────────────────────────────────────────────────
    { id: 'details_pet_what_happened', stage: 'details', kind: 'text', priority: 5, fills: [], hint: true,
        followUpOf: { parents: ['story_pets_past'], test: textMatches(LOST_PET) } },
    { id: 'details_other_phones', stage: 'details', kind: 'contact', priority: 10, fills: [], dedup: true, verifies: 'phones', hint: true },
    { id: 'details_other_socials', stage: 'details', kind: 'contact', priority: 15, fills: [], dedup: true, verifies: 'socials' },
    { id: 'details_email', stage: 'details', kind: 'contact', priority: 18, fills: ['emails'], dedup: true, verifies: 'emails' },
    { id: 'details_landlord', stage: 'details', kind: 'text', priority: 20, fills: [],
        followUpOf: { parents: ['story_tenure'], test: textMatches(/^rent$/m) } },
    { id: 'details_moved_before', stage: 'details', kind: 'text', priority: 25, fills: ['prev_address'], dedup: true,
        when: (_k, ctx) => { const y = yearsHere(ctx.answers.story_years_here); return y !== null && y < 2; } },
    { id: 'details_prior_adoptions', stage: 'details', kind: 'text', priority: 30, fills: ['prior_adoptions'],
        discriminates: (cs) => cs.length >= 2 && new Set(cs.map(c => c.adoptionCount > 0)).size > 1 },
    { id: 'details_returned', stage: 'details', kind: 'text', priority: 35, fills: ['returned_before'], hint: true },
    { id: 'details_kids', stage: 'details', kind: 'text', priority: 38, fills: [],
        followUpOf: { parents: ['story_household'], test: textMatches(KIDS) } },
    { id: 'details_pets_now_care', stage: 'details', kind: 'text', priority: 40, fills: [],
        followUpOf: { parents: ['story_pets_now'], test: textMatches(PETS_NOW) } },
    { id: 'details_moving_plans', stage: 'details', kind: 'text', priority: 45, fills: ['moving_plan'] },
    { id: 'details_hardest_moment', stage: 'details', kind: 'text', priority: 48, fills: [] },
    { id: 'details_holidays', stage: 'details', kind: 'text', priority: 50, fills: ['travel_plan'] },
    { id: 'details_prev_pet_home', stage: 'details', kind: 'text', priority: 55, fills: [],
        when: (k) => k.filled.includes('pets_past') && k.filled.includes('years_at_address') },
    { id: 'details_yesterday', stage: 'details', kind: 'text', priority: 60, fills: [], when: (k) => k.filled.includes('schedule') },
    { id: 'details_who_cares', stage: 'details', kind: 'text', priority: 65, fills: [], when: (k) => k.household.length > 0 },
    { id: 'details_vet_where', stage: 'details', kind: 'text', priority: 70, fills: [], when: (k) => k.filled.includes('vet') },
    { id: 'details_budget', stage: 'details', kind: 'text', priority: 75, fills: ['budget'] },
    { id: 'details_references', stage: 'details', kind: 'text', priority: 80, fills: ['references'] },
];

const BY_ID = new Map(QUESTION_BANK.map(q => [q.id, q]));
export function questionById(id: string): QuestionDef | undefined {
    return BY_ID.get(id);
}
