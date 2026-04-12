import type { adopters } from '@/db/schema';
import type { AdopterFlags } from '@/types/adopter';

export type SnippetField = 'name' | 'contact' | 'address' | 'family' | 'adoption' | 'history';

export interface MatchSnippet {
    field: SnippetField;
    snippet: string;     // raw text window around the match (empty for history)
    highlights: { start: number; end: number }[]; // multiple highlights for multi-token
}

export interface SearchResult {
    adopter: typeof adopters.$inferSelect;
    matchSnippet: MatchSnippet | null;  // best snippet (highest relevance field)
    relevanceScore: number;
    /** Normalised 0–100 relevance percentage (computed from relevanceScore / SEARCH_SCORE_CEILING). */
    relevancePercent: number;
    avgRating: number | null;
    thumbnail: string | null;
    stats: {
        searchHits: number;
        profileViews: number;
        requests: number;
        adoptions: number;
    };
    flags: AdopterFlags;
}

export interface SearchResponse {
    results: SearchResult[];
    /** Results that scored below the low-relevance threshold on a multi-token query. */
    lowRelevanceResults?: SearchResult[];
    /**
     * Set when the query was a single token and the total result count exceeds
     * REFINEMENT_NUDGE_THRESHOLD. Used by the UI to render a refinement prompt.
     */
    singleTokenResultCount?: number;
    truncated?: boolean;
    totalCount?: number;
    validationError?: 'min_digits' | 'invalid_query' | 'login_required';
}
