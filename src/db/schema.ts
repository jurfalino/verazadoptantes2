import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const adopters = sqliteTable("adopters", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    // Free text blobs for flexible contact info and addresses
    contactInfo: text("contact_info"), // Stores phones, emails, socials, etc.
    // Structured, categorized contact methods. JSON: ContactEntry[] (see
    // src/lib/contactEntries.ts). contactInfo above is derived from this for
    // every new/edited row; null on rows last saved before this column existed.
    contactEntries: text("contact_entries"),
    addressInfo: text("address_info"), // Stores physical addresses
    familyMembers: text("family_members"), // Stores household members / aliases
    notes: text("notes"), // Free-text observations, age, behavior, etc.

    // Metadata
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    status: text("status").default("5"), // Rating: 1-5 (1=Dangerous, 5=Excellent)
    // v2.19.9 + migration 0048: column is NOT NULL with the existing
    // 'anonymous' default sentinel. The structural guarantee replaces the
    // v2.19.8 client-side defensive check on the Created-by column. Before
    // the constraint, anyone with raw D1 write access (wrangler, a future
    // Drizzle update that passes explicit `null`) could land a NULL row;
    // the schema now enforces. The other two `added_by` columns (adoptions,
    // adopterImages) are intentionally NOT touched in this migration —
    // narrower blast radius; can be tightened in a follow-up if needed.
    addedBy: text("added_by").notNull().default("anonymous"),
    sourceUrl: text("source_url"), // Link to original post/source
    country: text("country"), // ISO 3166-1 alpha-2 country code (e.g. AR, US, MX)

    // Duplicate detection
    tokenHash: text("token_hash"), // Hash of tokenizable fields, null = needs tokenization
    deletedAt: integer("deleted_at", { mode: "timestamp" }), // Soft-delete for merged profiles

    // Provenance (added in migration 0042): how was this adopter record created?
    // 'manual' = rescuer typed it. 'form' = adopter submitted the application
    // form. 'contract' = adopter signed the contract on the open legacy path.
    // 'imported' = bulk-imported via ImportWizard. Default 'manual' so every
    // pre-migration row stays valid; the backfill upgrades known form-sourced
    // rows automatically.
    source: text("source").notNull().default("manual"),

    // Public profile flag (added in migration 0046, gated by
    // ENABLE_PUBLIC_PROFILES). Admin override that bypasses PII gating on the
    // whole record for any authenticated viewer — name renders fully, all
    // contact entries unmasked, addressInfo unmasked. Per-entry `isPublic`
    // (inside the contactEntries JSON) is the finer-grained primitive; this
    // column is the "the admin has confirmed the whole record is publicly
    // known" override that wins over a contributor's later-added private
    // contact entries too. 0 = private (default), 1 = public.
    isPublic: integer("is_public").notNull().default(0),

    // Walkthrough demo rows (added in migration 0052). 1 = a seeded record used
    // ONLY by the guided walkthrough demo. These rows are also soft-deleted
    // (deletedAt SET) so every `deleted_at IS NULL` query excludes them for
    // free; the walkthrough + the /admin/walkthrough panel fetch them by this
    // marker (ignoring deletedAt). Never tokenized, never in real search.
    isDemo: integer("is_demo").notNull().default(0),
}, (table) => ({
    nameIdx: index("name_idx").on(table.name),
}));

export const adopterImages = sqliteTable("adopter_images", {
    id: text("id").primaryKey(),
    adopterId: text("adopter_id").notNull(),
    adoptionId: text("adoption_id"), // Optional: link to specific adoption record
    url: text("url").notNull(), // Base64 or URL
    caption: text("caption"),
    uploadedAt: integer("uploaded_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    addedBy: text("added_by").default("anonymous"),
    isProfilePicture: integer("is_profile_picture").default(0), // 1 if this is the profile picture
    mediaType: text("media_type").default("image"), // 'image' or 'video'
    thumbnailUrl: text("thumbnail_url"), // Video thumbnail URL (R2)
});

export const adopterFlags = sqliteTable("adopter_flags", {
    id: text("id").primaryKey(),
    adopterId: text("adopter_id").notNull(), // The profile being flagged
    flaggedBy: text("flagged_by").default("anonymous"),
    reason: text("reason").default("duplicate"), // duplicate, inaccurate_information
    targetAdopterId: text("target_adopter_id"), // If duplicate, which one is the original?
    details: text("details"),
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
});

export const adopterHistory = sqliteTable("adopter_history", {
    id: text("id").primaryKey(),
    adopterId: text("adopter_id").notNull(),
    changedBy: text("changed_by").default("anonymous"),
    changes: text("changes"), // JSON string of what changed
    changedAt: integer("changed_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    // 'edit' (owner/admin core-record write via saveAdopter / appendToExistingAdopter)
    // | 'contribution' (any authenticated user via addContactEntry). Only 'edit'
    // rows make the writer an "editor" for PII visibility purposes.
    kind: text("kind").notNull().default('edit'),
});

export const searches = sqliteTable("searches", {
    id: text("id").primaryKey(),
    query: text("query").notNull().unique(),
    type: text("type").default("general"), // name, phone, etc
    count: integer("count").default(1),
    lastSearchedAt: integer("last_searched_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
});

export const adoptions = sqliteTable("adoptions", {
    id: text("id").primaryKey(),
    adopterId: text("adopter_id"), // Nullable for "Available" animals not yet linked
    animalName: text("animal_name"),
    species: text("species"), // cat, dog, etc
    details: text("details"),
    status: text("status"), // completed, failed, etc
    rating: integer("rating"),
    comments: text("comments"),
    date: integer("date", { mode: "timestamp" }),
    addedBy: text("added_by").default("anonymous"),
    onBehalfOf: text("on_behalf_of"), // Name of person this was recorded for
    recordType: text("record_type").default("adoption"), // adoption, adoption_request, observation, follow_up, returned_pet, available, foster
    deliveredToHome: integer("delivered_to_home"), // 1 if pet was delivered to adopter's home
    verifiedAddress: text("verified_address"), // Snapshot of verified address at time of adoption
    identityVerified: integer("identity_verified"), // 1 if adopter identity was verified during this adoption
    sourceUrl: text("source_url"), // Link to original post/source for this specific record
    age: text("age"), // Approximate age (e.g., "2 años", "3 meses") — DEPRECATED, prefer estimatedBirthDate
    estimatedBirthDate: integer("estimated_birth_date", { mode: "timestamp" }), // Computed from age input
    neutered: integer("neutered"), // 1 if neutered/spayed, 0 or null if not
    sex: text("sex"), // macho, hembra
    color: text("color"), // Color/markings description
    microchip: text("microchip"), // Microchip number if available
});

// ============================================================================
// NORMALIZED MODEL (replaces the overloaded `adoptions` table)
// See .agents/plans/animals-placements-normalization.md. `adoptions` conflated
// three concepts; these split them cleanly:
//   - animals        : physical identity + inventory status
//   - placements     : custody spans (animal↔adopter, foster/adoption, start/end)
//   - adopterEvents  : adopter-scoped activity (observation, request, follow-up, return)
// Migration preserves ids: each old adoptions.id becomes an animals.id (for
// available/foster/adoption rows) OR an adopter_events.id (for the 4 event types),
// so existing refs (contractInvitations.animalId, adopterImages.adoptionId,
// formSubmissions.selectedAnimalId, piiAccessRequests.activityId) keep resolving.
// ============================================================================

// Physical animal identity + inventory status. One row per animal.
// Current placement is DERIVED (placements WHERE animalId=? AND endedAt IS NULL) —
// no denormalized pointer (avoids a mutable-sync obligation).
export const animals = sqliteTable("animals", {
    id: text("id").primaryKey(), // Preserves the originating adoptions.id
    name: text("name"), // was animal_name
    species: text("species"),
    details: text("details"),
    age: text("age"), // legacy free-text; prefer estimatedBirthDate
    estimatedBirthDate: integer("estimated_birth_date", { mode: "timestamp" }),
    neutered: integer("neutered"),
    sex: text("sex"),
    color: text("color"),
    microchip: text("microchip"),
    sourceUrl: text("source_url"), // Original post/source for the animal
    addedBy: text("added_by").default("anonymous"), // Rescuer who owns it
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    deletedAt: integer("deleted_at", { mode: "timestamp" }), // Soft delete
}, (table) => ({
    addedByIdx: index("idx_animals_added_by").on(table.addedBy),
}));

// Custody spans: an animal held by an adopter as foster or adoption. Active
// placement has endedAt IS NULL; ended rows ARE the custody history (subsumes the
// interim animal_placements ledger). A move closes the prior span (set endedAt)
// and inserts a new active one.
export const placements = sqliteTable("placements", {
    id: text("id").primaryKey(), // NEW id (not preserved from adoptions)
    animalId: text("animal_id").notNull(), // → animals.id
    adopterId: text("adopter_id").notNull(), // → adopters.id (the foster home / adopter)
    recordType: text("record_type").notNull(), // 'foster' | 'adoption'
    startedAt: integer("started_at", { mode: "timestamp" }), // was adoptions.date
    endedAt: integer("ended_at", { mode: "timestamp" }), // NULL = active/current
    rating: integer("rating"),
    status: text("status"),
    deliveredToHome: integer("delivered_to_home"),
    verifiedAddress: text("verified_address"),
    identityVerified: integer("identity_verified"),
    onBehalfOf: text("on_behalf_of"),
    comments: text("comments"), // contract screenshot JSON etc.
    sourceUrl: text("source_url"),
    recordedBy: text("recorded_by").default("anonymous"),
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
}, (table) => ({
    animalIdx: index("idx_placements_animal").on(table.animalId),
    adopterIdx: index("idx_placements_adopter").on(table.adopterId),
    activeIdx: index("idx_placements_active").on(table.animalId, table.endedAt),
}));

// Adopter-scoped activity that is NOT a custody placement: observations and
// adoption requests (no specific animal) + follow-ups / returns (reference a prior
// placement/animal). Preserves the originating adoptions.id.
export const adopterEvents = sqliteTable("adopter_events", {
    id: text("id").primaryKey(), // Preserves the originating adoptions.id
    adopterId: text("adopter_id").notNull(),
    eventType: text("event_type").notNull(), // 'observation' | 'adoption_request' | 'follow_up' | 'returned_pet'
    animalId: text("animal_id"), // NULL for observation/adoption_request
    placementId: text("placement_id"), // NULL unless follow_up/returned_pet references a placement
    animalName: text("animal_name"), // denormalized name for follow_up/returned_pet (references an animal, possibly not in inventory)
    species: text("species"), // for adoption_request
    status: text("status"), // legacy free-text status carried from adoptions (vestigial, never filtered)
    rating: integer("rating"),
    details: text("details"),
    date: integer("date", { mode: "timestamp" }),
    onBehalfOf: text("on_behalf_of"),
    sourceUrl: text("source_url"),
    recordedBy: text("recorded_by").default("anonymous"),
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    // Moderation: when set, this note was reviewed as a FALSE POSITIVE in the
    // "Contacto en notas" data-quality report and is excluded from it. Cleared
    // when the note is edited so a materially changed note is re-reviewed. See
    // src/app/actions/dataQuality.ts.
    piiDismissedAt: integer("pii_dismissed_at", { mode: "timestamp" }),
}, (table) => ({
    adopterIdx: index("idx_events_adopter").on(table.adopterId),
    animalIdx: index("idx_events_animal").on(table.animalId),
}));

// Adopter Stats - Track analytics events (search hits, profile views)
// Note: adoption/request counts come from the adoptions table, not from stats events
export const adopterStats = sqliteTable("adopter_stats", {
    id: text("id").primaryKey(),
    adopterId: text("adopter_id").notNull(),
    eventType: text("event_type").notNull(), // search_hit, profile_view
    userId: text("user_id"), // Actor email — null for anonymous/legacy events
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
}, (table) => ({
    adopterIdx: index("idx_stats_adopter").on(table.adopterId),
    createdIdx: index("idx_stats_created").on(table.createdAt),
    userIdx: index("idx_stats_user").on(table.userId),
}));

// App Config - Admin-configurable settings
export const appConfig = sqliteTable("app_config", {
    key: text("key").primaryKey(),
    value: text("value").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    updatedBy: text("updated_by"),
});

// Duplicate Detection - Token index for finding duplicate adopters
export const duplicateTokens = sqliteTable("duplicate_tokens", {
    id: text("id").primaryKey(),
    adopterId: text("adopter_id").notNull(),
    tokenType: text("token_type").notNull(), // name_full, name_word, phone, phone_suffix, email, social, address_word, source_url
    tokenValue: text("token_value").notNull(),
}, (table) => ({
    tokenIdx: index("idx_dup_token").on(table.tokenType, table.tokenValue),
    adopterIdx: index("idx_dup_adopter").on(table.adopterId),
}));

// Duplicate Detection - Pre-computed candidate pairs
export const duplicateCandidates = sqliteTable("duplicate_candidates", {
    id: text("id").primaryKey(),
    adopter1Id: text("adopter1_id").notNull(),
    adopter2Id: text("adopter2_id").notNull(),
    matchTypes: text("match_types").notNull(), // JSON array: ["phone","name_word"]
    matchValues: text("match_values"),          // JSON: {"phone":"1155234567","name_word":["garcia"]}
    score: integer("score").notNull(),
    confidence: text("confidence").notNull(),   // high, medium, low
    status: text("status").default("pending"),  // pending, dismissed, merged
    detectedAt: integer("detected_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
    resolvedBy: text("resolved_by"),
});

// Data Requests - Track ARCO rights requests and inaccuracy reports
export const dataRequests = sqliteTable("data_requests", {
    id: text("id").primaryKey(),
    adopterId: text("adopter_id"), // Nullable — may be a general request
    requesterName: text("requester_name").notNull(),
    requesterEmail: text("requester_email"),
    requestType: text("request_type").notNull().default("inaccuracy"), // inaccuracy, access, rectification, deletion
    details: text("details"),
    status: text("status").notNull().default("pending"), // pending, resolved, rejected
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
    resolvedBy: text("resolved_by"),
});

// ── PII Access Gating ────────────────────────────────────────────
// Behind the ENABLE_PII_ACCESS_GATING flag. Both tables are additive and
// unused until the flag is enabled. A non-owner viewer who needs an adopter's
// contact details files a request; the record owner / an editor / an admin
// approves or denies it.

// pii_access_requests — a viewer's request to see an adopter's contact info.
export const piiAccessRequests = sqliteTable("pii_access_requests", {
    id: text("id").primaryKey(),
    adopterId: text("adopter_id").notNull(),
    requesterEmail: text("requester_email").notNull(),
    justification: text("justification"),
    // The adoptions row that triggered the request, when activity-driven.
    activityId: text("activity_id"),
    status: text("status").notNull().default("pending"), // pending, approved, denied
    resolvedByEmail: text("resolved_by_email"),
    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
    resolutionNote: text("resolution_note"),
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
}, (table) => ({
    adopterStatusIdx: index("idx_pii_req_adopter_status").on(table.adopterId, table.status),
    requesterStatusIdx: index("idx_pii_req_requester_status").on(table.requesterEmail, table.status),
}));

// pii_access_grants — the access facts. A live (non-revoked) row means
// `grantee_email` can see some/all of `adopter_id`'s contact info.
//   scope='entry'       — one entry, unlocked by a search match.
//   scope='all_contact' — every contact field, unlocked by an approved request.
export const piiAccessGrants = sqliteTable("pii_access_grants", {
    id: text("id").primaryKey(),
    adopterId: text("adopter_id").notNull(),
    granteeEmail: text("grantee_email").notNull(),
    scope: text("scope").notNull(), // all_contact, entry
    // For scope='entry': hash of the normalized matched value (never raw PII).
    entryRef: text("entry_ref"),
    origin: text("origin").notNull(), // search_match, request
    requestId: text("request_id"), // links the pii_access_requests row, when origin='request'
    grantedByEmail: text("granted_by_email").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    revokedAt: integer("revoked_at", { mode: "timestamp" }),
    revokedByEmail: text("revoked_by_email"),
}, (table) => ({
    granteeAdopterIdx: index("idx_pii_grant_grantee_adopter").on(table.granteeEmail, table.adopterId),
}));



// Auth.js Tables
import type { AdapterAccount } from "next-auth/adapters";
import { primaryKey } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("user", {
    id: text("id")
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    name: text("name"),
    email: text("email").notNull(),
    emailVerified: integer("emailVerified", { mode: "timestamp_ms" }),
    image: text("image"),
    // The Google OAuth-provided display name, kept in sync on every sign-in
    // (v2.18.6). Separate from `name` so the admin oversight UI can show
    // both "display name" (customizable via /settings) AND "Google account
    // name" when they differ. See lib/audit.ts:ensureUserProfile and
    // migration 0047.
    googleName: text("google_name"),
});

export const accounts = sqliteTable(
    "account",
    {
        userId: text("userId")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        type: text("type").$type<AdapterAccount["type"]>().notNull(),
        provider: text("provider").notNull(),
        providerAccountId: text("providerAccountId").notNull(),
        refresh_token: text("refresh_token"),
        access_token: text("access_token"),
        expires_at: integer("expires_at"),
        token_type: text("token_type"),
        scope: text("scope"),
        id_token: text("id_token"),
        session_state: text("session_state"),
    },
    (account) => ({
        compoundKey: primaryKey({
            columns: [account.provider, account.providerAccountId],
        }),
    })
);

export const sessions = sqliteTable("session", {
    sessionToken: text("sessionToken").primaryKey(),
    userId: text("userId")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
});

export const verificationTokens = sqliteTable(
    "verificationToken",
    {
        identifier: text("identifier").notNull(),
        token: text("token").notNull(),
        expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
    },
    (vt) => ({
        compoundKey: primaryKey({ columns: [vt.identifier, vt.token] }),
    })
);

export const userProfiles = sqliteTable("user_profiles", {
    userId: text("user_id").primaryKey(),
    // organization: text("organization") — DEPRECATED & DROPPED in v2.12.1-34 (migration 0037).
    // Real org membership lives in `organizations` + `org_members` tables. The legacy
    // column was a free-text annotation only the admin form ever wrote to and was never
    // synced with the user-facing /organizations system.
    role: text("role").default("viewer"), // viewer, contributor, admin
    notes: text("notes"),
    commsOptIn: integer("comms_opt_in").default(0),
    country: text("country"), // ISO 3166-1 alpha-2 (e.g. AR, US, MX) — auto-detected via CF-IPCountry
    countryConfirmed: integer("country_confirmed").default(0), // 1 if user has confirmed their country
    province: text("province"), // Region/state name (e.g. "Buenos Aires") — auto-detected via cf-region
    provinceCode: text("province_code"), // ISO subdivision code (e.g. "B") — auto-detected via cf-region-code
    city: text("city"), // City name (e.g. "La Plata") — auto-detected via cf-ipcity
    timezone: text("timezone"), // IANA timezone (e.g. "America/Argentina/Buenos_Aires") — via cf-timezone
    lastActiveAt: integer("last_active_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    // Legal
    termsAcceptedAt: integer("terms_accepted_at", { mode: "timestamp" }), // Unix timestamp when T&C were accepted
    termsVersion: integer("terms_version"), // Version of T&C accepted (matches CURRENT_TERMS_VERSION)
    // v2.14.10: shareable handle for the public /user/[handle] showcase URL.
    // Kebab-cased, integer suffix on collision (no hash). Auto-assigned by
    // ensureUserProfile() on first sign-in via generateUniqueSlug(); stable thereafter.
    handle: text("handle").unique(),
});

export const auditLog = sqliteTable("audit_log", {
    id: text("id").primaryKey(),
    userId: text("user_id"),
    userEmail: text("user_email"),
    action: text("action").notNull(),
    target: text("target"),
    details: text("details"), // JSON string
    device: text("device"),
    isPWA: integer("is_pwa").default(0),
    ipAddress: text("ip_address"),
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
}, (table) => ({
    userIdx: index("idx_audit_user").on(table.userId),
    actionIdx: index("idx_audit_action").on(table.action),
    createdIdx: index("idx_audit_created").on(table.createdAt),
}));

// Spreadsheet-import audit — a run header (written when the import starts, so an
// abandoned run is still visible) plus its per-row items (written at the end).
// Admin-only view at /admin/imports.
export const importRuns = sqliteTable("import_runs", {
    id: text("id").primaryKey(),                 // runId (client-generated)
    actorEmail: text("actor_email"),             // resolved server-side, not trusted from the client
    source: text("source"),                      // spreadsheet filename
    total: integer("total").default(0),          // rows the run set out to import
    createdCount: integer("created_count").default(0),
    updatedCount: integer("updated_count").default(0),
    skippedCount: integer("skipped_count").default(0),
    failedCount: integer("failed_count").default(0),
    status: text("status").notNull().default("running"), // 'running' | 'completed'
    startedAt: integer("started_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    finishedAt: integer("finished_at", { mode: "timestamp" }),
}, (table) => ({
    actorIdx: index("idx_import_runs_actor").on(table.actorEmail),
    startedIdx: index("idx_import_runs_started").on(table.startedAt),
}));

export const importRunItems = sqliteTable("import_run_items", {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    rowIndex: integer("row_index"),              // source-row number (1-based, for the admin view)
    adopterId: text("adopter_id"),               // the created/updated record (null for skip/fail)
    adopterName: text("adopter_name"),
    action: text("action"),                      // 'create' | 'upsert' | 'skip'
    status: text("status"),                      // 'created' | 'updated' | 'skipped' | 'failed'
    matchedAdopterId: text("matched_adopter_id"),        // the existing record it matched (null if none)
    matchedAdopterName: text("matched_adopter_name"),
    matchConfidence: integer("match_confidence"),        // relevancePercent 0–100
    message: text("message"),
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
}, (table) => ({
    runIdx: index("idx_import_run_items_run").on(table.runId),
}));

// In-App Notifications
export const notifications = sqliteTable("notifications", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(), // recipient email
    type: text("type").notNull().default("contract_result"), // contract_result, system, etc.
    title: text("title").notNull(),
    body: text("body").notNull(),
    url: text("url"), // link to results page
    icon: text("icon").default("📋"),
    read: integer("read").default(0), // 0=unread, 1=read
    dismissed: integer("dismissed").default(0), // 0=active, 1=dismissed/archived
    metadata: text("metadata"), // JSON blob (match count, animal name, etc.)
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
}, (table) => ({
    userIdx: index("idx_notif_user").on(table.userId, table.read, table.createdAt),
    typeIdx: index("idx_notif_type").on(table.type, table.createdAt),
}));

// User-submitted error reports from /auth-error (v2.14.9-14). The page hides
// the real reason behind "Ocurrió un error inesperado" and includes a
// "Report this problem" form — real apps have those, so the form makes the
// deception more credible. Admins read what blocked users said via the same
// /admin/blocked-logins page (separate table, correlated by time + IP).
//
// No FK to user/session because the user is unauthenticated at this point.
// Correlation to a specific blocked attempt is manual (admin eyeballs the
// timestamp).
export const errorReports = sqliteTable("error_reports", {
    id: text("id").primaryKey(),
    email: text("email"),       // optional — user may or may not fill it
    message: text("message"),   // optional — user may submit empty
    userAgent: text("user_agent"),
    ipHash: text("ip_hash"),    // truncated/hashed CF-Connecting-IP (privacy)
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`).notNull(),
}, (table) => ({
    createdIdx: index("idx_error_reports_created").on(table.createdAt),
}));

// Blocked sign-in attempts — written when an OAuth login is rejected by the
// adopter-login gate (v2.14.9-14). Admins view historical attempts at
// /admin/blocked-logins. We deliberately keep this separate from notifications
// because notifications are dismissable/read-state per-admin; blocked-logins
// is the immutable audit trail of "someone tried, here's why we said no."
export const blockedLogins = sqliteTable("blocked_logins", {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    attemptedAt: integer("attempted_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`).notNull(),
    matchedAdopterIds: text("matched_adopter_ids").notNull(), // JSON array of adopter IDs
    reason: text("reason").notNull(), // 'low_rating' | 'too_many_adoptions' | 'too_many_requests' | composite
    matchedSummary: text("matched_summary"), // JSON snapshot: name, avgRating, addedBy, lastChangedBy per match
}, (table) => ({
    attemptedIdx: index("idx_blocked_attempted").on(table.attemptedAt),
    emailIdx: index("idx_blocked_email").on(table.email),
}));

// PetShield Form Submissions
export const formSubmissions = sqliteTable("form_submissions", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),          // Who shared the form (rescuer email)
    // Step 2: Identity
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    // Step 3: Geolocation
    latitude: text("latitude"),
    longitude: text("longitude"),
    // Step 4: Selfie
    selfieUrl: text("selfie_url"),              // R2 URL after upload
    // Step 5: Species & Life Stage
    species: text("species"),                    // dog, cat, both, other
    lifeStage: text("life_stage"),               // puppy, young, senior, none
    specialNeeds: integer("special_needs").default(0),
    // Step 6: Intent
    intent: text("intent"),                      // self, gift
    // Step 7: Household
    household: text("household"),                // JSON array: ["children","pets","outdoor","presence"]
    // All answers as JSON (future-proof)
    answersJson: text("answers_json"),           // Full JSON blob of all form answers
    // Metadata
    status: text("status").default("pending"),   // pending, reviewed, linked
    linkedAdopterId: text("linked_adopter_id"),  // Set when rescuer links to profile
    notificationId: text("notification_id"),     // Back-reference to notification
    // v2.14.10: when the form was launched from the public showcase
    // (`/animal/[id]` → "Adoptar"), this captures which animal the
    // applicant selected. Lets the rescuer's notification + UI show
    // "X aplicó para Luna" instead of the generic "X completó el formulario".
    // Null when the form was shared generically (no animal pre-selected).
    selectedAnimalId: text("selected_animal_id"),
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
}, (table) => ({
    userIdx: index("idx_form_user").on(table.userId),
    statusIdx: index("idx_form_status").on(table.status),
}));

// ── Contract Invitations ─────────────────────────────────────────
// Per-adopter contract token. Issued by createContractInvitation()
// when a rescuer picks an applicant for an animal. Locks the contract
// flow to one specific adopter so it's no longer "whoever signs first
// wins". One outstanding invite per animal: issuing a new token retires
// prior unused ones via server-action logic (no DB constraint needed).

export const contractInvitations = sqliteTable("contract_invitations", {
    token: text("token").primaryKey(),
    animalId: text("animal_id").notNull(),
    adopterId: text("adopter_id").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
    usedAt: integer("used_at"),
    expiresAt: integer("expires_at"),
    // Language the sharing rescuer was using when they issued the invite.
    // Drives the contract-app's whole-screen language (chrome + contract body).
    // Nullable for legacy rows; the contract-app falls back to 'es'.
    locale: text("locale"),
}, (table) => ({
    animalIdx: index("idx_contract_inv_animal").on(table.animalId),
}));

// ── Organizations ────────────────────────────────────────────────

export const organizations = sqliteTable("organizations", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    // v2.14.10: shareable slug for the public /org/[slug] showcase URL.
    // Kebab-cased, integer suffix on collision (no hash). Nullable for legacy
    // rows; backfilled in migration 0041. Set by createOrganization / rename
    // via generateUniqueSlug().
    slug: text("slug").unique(),
});

export const orgMembers = sqliteTable("org_members", {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    userEmail: text("user_email").notNull(),
    role: text("role").default("member"),
    joinedAt: integer("joined_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
}, (table) => ({
    uniqueMember: index("idx_org_member_unique").on(table.orgId, table.userEmail),
    emailIdx: index("idx_org_member_email").on(table.userEmail),
}));

export const orgInvites = sqliteTable("org_invites", {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    createdBy: text("created_by").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
}, (table) => ({
    orgIdx: index("idx_org_invite_org").on(table.orgId),
}));

// ── Support Chat ─────────────────────────────────────────────────
// Floating chat widget routed to admin via Telegram bot.
// `id` doubles as the conversationId held in the user's localStorage; the
// first 8 hex chars are embedded in every Telegram-forwarded message so the
// admin's reply (via Telegram's Reply gesture) can be attributed back to the
// right conversation in the webhook handler.

export const chatConversations = sqliteTable("chat_conversations", {
    id: text("id").primaryKey(),
    userEmail: text("user_email"),                          // null for anonymous visitors
    userLabel: text("user_label"),                          // human label shown to the admin in Telegram
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    lastMessageAt: integer("last_message_at", { mode: "timestamp" }),
    blocked: integer("blocked").default(0),                 // admin can mute a conversation via /block
    hourCount: integer("hour_count").default(0),            // rolling per-hour message counter (rate limit)
    hourWindowStart: integer("hour_window_start", { mode: "timestamp" }),
}, (table) => ({
    lastMessageIdx: index("idx_chat_conv_last").on(table.lastMessageAt),
}));

export const chatMessages = sqliteTable("chat_messages", {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull(),
    direction: text("direction").notNull(),                 // 'user' | 'admin'
    body: text("body").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    telegramMessageId: integer("telegram_message_id"),      // Telegram message_id for the bot's forwarded message — admin reply-to anchor
}, (table) => ({
    convIdx: index("idx_chat_msgs_conv").on(table.conversationId),
    convCreatedIdx: index("idx_chat_msgs_conv_created").on(table.conversationId, table.createdAt),
}));
