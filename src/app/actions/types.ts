import type { adopters } from '@/db/schema';
import type { AdopterFlags } from '@/types/adopter';

export interface SearchResult {
    adopter: typeof adopters.$inferSelect;
    matchContext?: string;
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
