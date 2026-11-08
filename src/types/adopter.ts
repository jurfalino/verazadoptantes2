/**
 * Shared types for adopter-related components.
 * Derived from the Drizzle schema in db/schema.ts.
 */

export interface Adopter {
    id: string;
    name: string;
    /** How the profile was created: manual | imported | form | contract | api (adopters.source). */
    source?: string | null;
    contactInfo?: string | null;
    /** JSON-serialized ContactEntry[] — see src/lib/contactEntries.ts. */
    contactEntries?: string | null;
    addressInfo?: string | null;
    familyMembers?: string | null;
    householdMembers?: string | null;
    notes?: string | null;
    status?: string | null;
    addedBy?: string | null;
    sourceUrl?: string | null;
    country?: string | null;
    createdAt?: Date | null;
    updatedAt?: Date | null;
    tokenHash?: string | null;
    deletedAt?: Date | null;
    /** v2.19.47: surfaces the adopter-level public flag to client surfaces
     *  that render visibility microcopy. The schema column has been around
     *  since v2.16.0-12 but wasn't exposed on the shared `Adopter` type
     *  until the import-wizard consent toggle made the flag user-controlled
     *  at create time. Loaders coerce the integer column (0|1) to a
     *  boolean here; null is treated as false by consumers. */
    isPublic?: boolean | null;
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
    interview?: { id: string; canViewAnswers: boolean };
    /** Answers of the rescue's own form, sent with an API adoption request (src/lib/activityForms.ts). Only for that rescue and admins. */
    formContent?: Record<string, unknown>;
}

export interface HistoryEntry {
    id: string;
    adopterId: string;
    changedBy?: string | null;
    changes?: string | null;
    changedAt?: Date | number | null;
}

export interface AdopterStats {
    searchHits: number;
    profileViews: number;
}

/**
 * A profile's FLAGS (Jon, 2026-11-07): something on the profile that may need
 * doing — filed by a rescuer («Duplicado», «Inexacto», «Identidad/Domicilio
 * verificado») or found by the system (`systemDuplicate`). Never a reason not
 * to trust the person: that is an alert (PeriodAlertFields, the housemate chips).
 */
export interface ProfileFlags {
    inaccurate: boolean;
    duplicate: boolean;
    systemDuplicate: boolean;
    verified_identity: boolean;
    verified_address: boolean;
}

/** One period ALERT: «{count} adopciones en {days} días» / «Pidió en {count} rescates…» (domain/periodAlerts). */
export type PeriodAlert = { count: number; threshold: number; periodDays: number; actualSpanDays?: number; startDate?: Date | null; endDate?: Date | null };

/** A person's two period ALERTS — reasons not to trust them with an animal; null when below threshold. */
export interface PeriodAlertFields {
    tooManyAdoptions: PeriodAlert | null;
    tooManyRequests: PeriodAlert | null;
}

/**
 * What a search result or a /my-adopters row carries in its `flags` field: the
 * profile's flags AND its period alerts, side by side. Two concepts, one
 * object only because the field predates the split — read each half by its
 * own type (ProfileFlags / PeriodAlertFields).
 */
export type AdopterFlags = ProfileFlags & PeriodAlertFields;

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
    /** On the viewer's «Pendientes de revisar» list, so «Revisar» has somewhere to land. */
    onViewerList?: boolean;
}
