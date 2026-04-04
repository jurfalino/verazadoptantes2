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
    truncated?: boolean;
    totalCount?: number;
    validationError?: 'min_digits' | 'invalid_query';
}
