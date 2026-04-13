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

// ── Unified findAdopters types ────────────────────────────────────────────────

export type SearchMode = 'duplicate' | 'discovery';

/**
 * Result from findAdopters in mode='duplicate'.
 * Lightweight — no full adopter row, no enrichment.
 * relevancePercent ceiling: PRACTICAL_MAX_DUPLICATE (12).
 * Do NOT compare relevancePercent values across modes.
 */
export interface DuplicateMatch {
    adopterId: string;
    adopterName: string;
    /** Normalized 0–100. Ceiling: PRACTICAL_MAX_DUPLICATE. */
    relevancePercent: number;
    /** Token types that fired (e.g. 'phone', 'name_word', 'name_word_fuzzy'). */
    matchTypes: string[];
    /** How the adopter was found — diagnostic only, not shown in UI. */
    source: 'token' | 'like' | 'both';
}

/**
 * Result from findAdopters in mode='discovery'.
 * Includes full adopter row. Enrichment fields are always present
 * (defaulting to null / zero-values when enrich=false) so consumers
 * never need optional chaining on stats or flags.
 * relevancePercent ceiling: SEARCH_SCORE_CEILING (150).
 * Do NOT compare relevancePercent values across modes.
 */
export interface DiscoveryMatch {
    adopterId: string;
    adopterName: string;
    /** Normalized 0–100. Ceiling: SEARCH_SCORE_CEILING. */
    relevancePercent: number;
    matchTypes: string[];
    source: 'token' | 'like' | 'both';
    /** Full adopter row — always populated in discovery mode. */
    adopter: typeof adopters.$inferSelect;
    matchSnippet: MatchSnippet | null;
    avgRating: number | null;
    thumbnail: string | null;
    /** Always populated. Defaults to all-zero when enrich=false. */
    stats: { searchHits: number; profileViews: number; requests: number; adoptions: number };
    /** Always populated. Defaults to all-false when enrich=false. */
    flags: AdopterFlags;
}

/** Discriminated union for generic consumer code. Prefer the concrete type when mode is known at the call site. */
export type AdopterMatch = DuplicateMatch | DiscoveryMatch;

export interface FindAdoptersInput {
    // ── Duplicate mode ──────────────────────────────────────────────
    /** Free-text name — tokenised into name_full + name_word tokens. Used in both modes. */
    name?: string;
    /** Free-text contact block — phones/emails/socials extracted if structured fields absent. */
    contactInfo?: string;
    /** Pre-parsed phone digit strings. Skips extraction from contactInfo when supplied. */
    phones?: string[];
    /** Pre-parsed email addresses. Skips extraction from contactInfo when supplied. */
    emails?: string[];
    /** Pre-parsed social handles. Skips extraction from contactInfo when supplied. */
    socials?: string[];
    /**
     * Exclude this adopter ID from results.
     * Used by the contract route to exclude the just-created adopter from its own match.
     */
    excludeAdopterId?: string;

    // ── Discovery mode ──────────────────────────────────────────────
    /**
     * Unstructured raw query string — discovery mode only.
     * Searched via LIKE across name, contactInfo, addressInfo, familyMembers.
     * Silently ignored when mode='duplicate'.
     */
    raw?: string;
}

export interface FindAdoptersOptions {
    mode: SearchMode;
    /**
     * Run enrichAdopters (thumbnail, rating, stats, flags).
     * Default: true for discovery, false for duplicate.
     * Ignored in duplicate mode — enrichment is never run there.
     */
    enrich?: boolean;
    /**
     * Suppress results below this relevance %.
     * Default: 15 for duplicate mode, 0 for discovery mode.
     */
    minRelevance?: number;
    /** Max results returned. Default: SEARCH_RESULT_LIMIT. */
    limit?: number;
}

export interface FindAdoptersResponse {
    results: DiscoveryMatch[] | DuplicateMatch[];
    /** Discovery mode only — results below relevance threshold, shown collapsed in UI. */
    lowRelevanceResults?: DiscoveryMatch[];
    /** Discovery mode only — single-token result count when above REFINEMENT_NUDGE_THRESHOLD. */
    singleTokenResultCount?: number;
    truncated?: boolean;
    totalCount?: number;
    validationError?: 'min_digits' | 'invalid_query' | 'login_required';
}
