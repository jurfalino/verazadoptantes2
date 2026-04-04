import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const adopters = sqliteTable("adopters", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    // Free text blobs for flexible contact info and addresses
    contactInfo: text("contact_info"), // Stores phones, emails, socials, etc.
    addressInfo: text("address_info"), // Stores physical addresses
    familyMembers: text("family_members"), // Stores household members / aliases
    notes: text("notes"), // Free-text observations, age, behavior, etc.

    // Metadata
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    status: text("status").default("5"), // Rating: 1-5 (1=Dangerous, 5=Excellent)
    addedBy: text("added_by").default("anonymous"),
    sourceUrl: text("source_url"), // Link to original post/source
    country: text("country"), // ISO 3166-1 alpha-2 country code (e.g. AR, US, MX)

    // Duplicate detection
    tokenHash: text("token_hash"), // Hash of tokenizable fields, null = needs tokenization
    deletedAt: integer("deleted_at", { mode: "timestamp" }), // Soft-delete for merged profiles
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
    recordType: text("record_type").default("adoption"), // adoption, adoption_request, observation, follow_up, returned_pet
    deliveredToHome: integer("delivered_to_home"), // 1 if pet was delivered to adopter's home
    verifiedAddress: text("verified_address"), // Snapshot of verified address at time of adoption
    identityVerified: integer("identity_verified"), // 1 if adopter identity was verified during this adoption
    sourceUrl: text("source_url"), // Link to original post/source for this specific record
    age: text("age"), // Approximate age (e.g., "2 años", "3 meses")
    sex: text("sex"), // macho, hembra
    color: text("color"), // Color/markings description
    microchip: text("microchip"), // Microchip number if available
});

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
    organization: text("organization"),
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
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
}, (table) => ({
    userIdx: index("idx_form_user").on(table.userId),
    statusIdx: index("idx_form_status").on(table.status),
}));

// ── Organizations ────────────────────────────────────────────────

export const organizations = sqliteTable("organizations", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
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
