/**
 * API exact's one rule set (identity verdict spec 2026-11-02): what the identifier lookup
 * found, judged by the pure verdict, then the exact decision table. Pure (no DB): runExact,
 * the docs' scenarios and the golden test all call it.
 */
import { decideExactOutcome, type CandidateNames, type ExactOutcome } from '@/domain/apiExactMatch';
import { judgeIdentity, type PersonFacts, type SharedIdentifier, type Verdict } from '@/domain/identityVerdict';
import { apiSocialHandles, type SearchRequest } from './schemas';

export type MatchedOn = 'email' | 'phone' | 'documentId' | 'social';

export interface IdentifierHits {
    candidates: CandidateNames[];
    matchedOn: Map<string, MatchedOn[]>;
    /** Per hit profile: each identifier it shares and how many differently-named hit profiles hold it (the verdict's input). */
    shared: Map<string, SharedIdentifier[]>;
}

type ExactPerson = Pick<SearchRequest['person'], 'fullName' | 'email' | 'phone' | 'socials'> & { documentId?: { value: string } };

/** The identity verdict for every hit profile (src/domain/identityVerdict.ts). */
export function judgeHits(person: ExactPerson, hits: IdentifierHits): Map<string, Verdict> {
    const facts: PersonFacts = {
        name: person.fullName ?? '', aliases: [],
        phones: person.phone ? [person.phone] : [], emails: person.email ? [person.email] : [],
        socials: apiSocialHandles(person.socials),
        documentIds: person.documentId ? [person.documentId.value] : [],
    };
    return new Map(hits.candidates.map(c => [c.profileId, judgeIdentity(facts, {
        adopterId: c.profileId, name: c.name, aliases: c.aliases,
        shared: hits.shared.get(c.profileId) ?? [],
        relevancePercent: 0, matchTypes: [], matchValues: [], source: 'token',
    }).verdict]));
}

/** API exact's answer for the hits: the decision table on the identity verdict. */
export function exactOutcomeOf(person: ExactPerson, hits: IdentifierHits): ExactOutcome {
    return decideExactOutcome(person.fullName ?? '', hits.candidates, judgeHits(person, hits));
}
