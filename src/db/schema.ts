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
    query: text("query").notNull(),
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
});

// Adopter Stats - Track profile events for analytics
export const adopterStats = sqliteTable("adopter_stats", {
    id: text("id").primaryKey(),
    adopterId: text("adopter_id").notNull(),
    eventType: text("event_type").notNull(), // search_hit, profile_view, adoption_request, adoption_completed
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
}, (table) => ({
    adopterIdx: index("idx_stats_adopter").on(table.adopterId),
    createdIdx: index("idx_stats_created").on(table.createdAt),
}));

// App Config - Admin-configurable settings
export const appConfig = sqliteTable("app_config", {
    key: text("key").primaryKey(),
    value: text("value").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    updatedBy: text("updated_by"),
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
