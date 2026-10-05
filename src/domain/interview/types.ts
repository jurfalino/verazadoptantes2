/**
 * Interview guide — shared types (spec: .agents/plans/interview-guide.md §4).
 * Pure: no DB, no server imports. The client and the server both build the
 * question queue from these, so the same state always yields the same queue.
 */
import type { Relationship } from '@/lib/householdMembers';

export type Stage = 'rapport' | 'story' | 'details';
export const STAGES: readonly Stage[] = ['rapport', 'story', 'details'];

export type AnswerKind = 'text' | 'contact' | 'household' | 'choice' | 'number';

export type FactKey =
    | 'name' | 'phones' | 'emails' | 'socials' | 'address' | 'aliases' | 'locality'
    | 'how_found' | 'work' | 'motivation' | 'schedule'
    | 'housing_type' | 'housing_tenure' | 'years_at_address' | 'outdoor_space'
    | 'household' | 'household_agree' | 'pets_current' | 'pets_past' | 'time_alone' | 'vet'
    | 'prev_address' | 'prior_adoptions' | 'returned_before'
    | 'moving_plan' | 'travel_plan' | 'budget' | 'references';

/** Facts a candidate profile can hold and the server can compare. */
export type VerifiableFact = 'phones' | 'emails' | 'socials' | 'address';
export const VERIFIABLE_FACTS: readonly VerifiableFact[] = ['phones', 'emails', 'socials', 'address'];

export type ContactType = 'phone' | 'email' | 'social';
export interface ContactValue { type: ContactType; value: string }
export interface HouseholdValue { name: string; relationship: Relationship | null }

export type AnswerStatus = 'answered' | 'skipped' | 'no_answer';
export interface Answer {
    status: AnswerStatus;
    text?: string;
    contacts?: ContactValue[];
    household?: HouseholdValue[];
    choice?: string;
    number?: number;
}

export interface PrepFacts {
    name: string;
    phones: string[];
    emails: string[];
    socials: string[];
    address: string;
}
export const EMPTY_PREP: PrepFacts = { name: '', phones: [], emails: [], socials: [], address: '' };

/** A possible matching profile, as THIS viewer may see it (built server-side from masked data). */
export interface CandidateSummary {
    adopterId: string;
    displayName: string;
    relevancePercent: number;
    avgRating: number | null;
    adoptionCount: number;
    /** The viewer may add contacts/household to this profile (owner, org-mate, admin). */
    canEdit: boolean;
    /** Facts the profile holds, whether or not the viewer may see them. */
    stored: VerifiableFact[];
    /** Values the viewer may see. A fact in `stored` but absent here is protected. */
    visible: Partial<Record<VerifiableFact, string[]>>;
}

export interface CustomQuestion { id: string; stage: Stage; text: string }

export interface InterviewContext {
    prep: PrepFacts;
    answers: Record<string, Answer>;
    /** Ids in the order they first got an answer record. Never re-ordered. */
    visited: string[];
    custom: CustomQuestion[];
    candidates: CandidateSummary[];
    confirmedAdopterId?: string;
}

export interface KnownFacts {
    name: string;
    phones: string[];
    emails: string[];
    socials: string[];
    address?: string;
    household: HouseholdValue[];
    /** Sorted, unique. */
    filled: FactKey[];
}

export interface QueueItem {
    id: string;
    stage: Stage;
    state: AnswerStatus | 'upcoming';
    added?: { reasonKey: 'interview.reason.followup' | 'interview.reason.verify' | 'interview.reason.custom'; parentId?: string };
    verify?: { fact: VerifiableFact; candidateIds: string[] };
}

export interface QuestionDef {
    id: string;
    stage: Stage;
    kind: AnswerKind;
    /** Lower = asked earlier within its stage. */
    priority: number;
    /** Facts this question establishes. Dropped once all are known. Empty = always asked. */
    fills: FactKey[];
    /** Helps identify the person; moved forward while candidates are unconfirmed. */
    dedup?: boolean;
    /** Acts as `dedup` when it tells the current candidates apart. */
    discriminates?: (candidates: readonly CandidateSummary[]) => boolean;
    /** Values for kind 'choice'; labels are i18n `interview.choice.<value>`. */
    choices?: readonly string[];
    /** Carries a verification hint against candidates that hold this fact. */
    verifies?: VerifiableFact;
    /** Has an i18n technique hint at `interview.h.<id>`. */
    hint?: boolean;
    when?: (known: KnownFacts, ctx: InterviewContext) => boolean;
    /** Follow-up: only asked once a parent answer passes `test`. */
    followUpOf?: { parents: readonly string[]; test: (a: Answer) => boolean };
}
