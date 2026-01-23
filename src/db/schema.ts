import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const adopters = sqliteTable("adopters", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    // Free text blobs for flexible contact info and addresses
    contactInfo: text("contact_info"), // Stores phones, emails, socials, etc.
    addressInfo: text("address_info"), // Stores physical addresses

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
    details: text("details"),
    status: text("status"), // completed, failed, etc
    rating: integer("rating"),
    comments: text("comments"),
    date: integer("date", { mode: "timestamp" }),
    addedBy: text("added_by").default("anonymous"),
});
