import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const adopters = sqliteTable("adopters", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    // Free text blobs for flexible contact info and addresses
    contactInfo: text("contact_info"), // Stores phones, emails, socials, etc.
    addressInfo: text("address_info"), // Stores physical addresses
    familyMembers: text("family_members"), // Stores household members / aliases

    // Metadata
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    status: text("status").default("good"),
}, (table) => ({
    nameIdx: index("name_idx").on(table.name),
}));

export const adopterImages = sqliteTable("adopter_images", {
    id: text("id").primaryKey(),
    adopterId: text("adopter_id").notNull(),
    url: text("url").notNull(), // Base64 or URL
    caption: text("caption"),
    uploadedAt: integer("uploaded_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    addedBy: text("added_by").default("anonymous"),
});

export const adopterFlags = sqliteTable("adopter_flags", {
    id: text("id").primaryKey(),
    adopterId: text("adopter_id").notNull(), // The profile being flagged
    flaggedBy: text("flagged_by").default("anonymous"),
    reason: text("reason").default("duplicate"), // duplicate, fake, abusive
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
    adopterId: text("adopter_id").notNull(),
    animalName: text("animal_name"),
    species: text("species"), // cat, dog, etc
    details: text("details"),
    status: text("status"), // completed, failed, etc
    rating: integer("rating"),
    comments: text("comments"),
    date: integer("date", { mode: "timestamp" }),
    addedBy: text("added_by").default("anonymous"),
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
