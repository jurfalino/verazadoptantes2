import type { adopters } from '@/db/schema';

export interface AdopterFlags {
    inaccurate: boolean;
    duplicate: boolean;
    systemDuplicate: boolean;
    verified_identity: boolean;
    verified_address: boolean;
    tooManyAdoptions: { count: number; threshold: number; periodDays: number } | null;
    tooManyRequests: { count: number; threshold: number; periodDays: number } | null;
}

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
