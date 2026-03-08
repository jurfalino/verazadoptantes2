/**
 * Shared types for adopter-related components.
 * Derived from the Drizzle schema in db/schema.ts.
 */

export interface Adopter {
    id: string;
    name: string;
    contactInfo?: string | null;
    addressInfo?: string | null;
    familyMembers?: string | null;
    notes?: string | null;
    status?: string | null;
    addedBy?: string | null;
    sourceUrl?: string | null;
    country?: string | null;
    createdAt?: Date | null;
    updatedAt?: Date | null;
    tokenHash?: string | null;
    deletedAt?: Date | null;
}

export interface AdopterImage {
    id: string;
    adopterId: string;
    adoptionId?: string | null;
    url: string;
    caption?: string | null;
    uploadedAt?: Date | null;
    addedBy?: string | null;
    isProfilePicture?: number | null;
    mediaType?: string | null;
}

export interface AdopterFlag {
    id: string;
    adopterId: string;
    flaggedBy?: string | null;
    reason?: string | null;
    targetAdopterId?: string | null;
    details?: string | null;
    createdAt?: Date | null;
}

export interface AdoptionRecord {
    id: string;
    adopterId?: string | null;
    animalName?: string | null;
    species?: string | null;
    details?: string | null;
    status?: string | null;
    rating?: number | null;
    comments?: string | null;
    date?: Date | number | null;
    addedBy?: string | null;
    onBehalfOf?: string | null;
    recordType?: string | null;
    deliveredToHome?: number | null;
    verifiedAddress?: string | null;
    identityVerified?: number | null;
    sourceUrl?: string | null;
    age?: string | null;
    sex?: string | null;
    color?: string | null;
    microchip?: string | null;
}

export interface HistoryEntry {
    id: string;
    adopterId: string;
    changedBy?: string | null;
    changes?: string | null;
    changedAt?: Date | number | null;
}

export interface AdopterStats {
    searchHits: { '90d': number; '1y': number; 'all': number };
    profileViews: { '90d': number; '1y': number; 'all': number };
}

export interface AdoptionConfig {
    threshold: number;
    periodDays: number;
    requestsThreshold: number;
    requestsPeriodDays: number;
}

export interface DuplicateCandidateInfo {
    id: string;
    otherAdopterId: string;
    otherAdopterName: string;
    matchTypes: string[];
    score: number;
    confidence: string;
}
