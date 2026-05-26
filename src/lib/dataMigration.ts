// Server-side registry for the admin Data Migration page. Pairs each manifest
// entry (client-safe metadata in dataMigrationManifest.ts) with the Drizzle
// table reference plus the primary-key columns needed for upsert.
//
// Single source of truth for what the export/import API endpoints handle.
// Adding a table = one entry here + a matching entry in the manifest.

import type { AnySQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { getTableColumns } from "drizzle-orm";
import * as schema from "@/db/schema";
import { TABLE_MANIFEST, defaultSelectionFromManifest } from "./dataMigrationManifest";

export interface TableEntry {
    key: string;
    table: SQLiteTable;
    pk: string[]; // JS property names (not SQL column names)
}

// Map of key → drizzle table ref + PK. Order must match TABLE_MANIFEST.
const TABLE_DETAILS: Record<string, { table: SQLiteTable; pk: string[] }> = {
    app_config: { table: schema.appConfig, pk: ["key"] },
    users: { table: schema.users, pk: ["id"] },
    user_profiles: { table: schema.userProfiles, pk: ["userId"] },
    accounts: { table: schema.accounts, pk: ["provider", "providerAccountId"] },
    sessions: { table: schema.sessions, pk: ["sessionToken"] },
    verificationTokens: { table: schema.verificationTokens, pk: ["identifier", "token"] },
    organizations: { table: schema.organizations, pk: ["id"] },
    org_members: { table: schema.orgMembers, pk: ["id"] },
    org_invites: { table: schema.orgInvites, pk: ["id"] },
    adopters: { table: schema.adopters, pk: ["id"] },
    adoptions: { table: schema.adoptions, pk: ["id"] },
    adopter_images: { table: schema.adopterImages, pk: ["id"] },
    adopter_flags: { table: schema.adopterFlags, pk: ["id"] },
    adopter_history: { table: schema.adopterHistory, pk: ["id"] },
    adopter_stats: { table: schema.adopterStats, pk: ["id"] },
    duplicate_tokens: { table: schema.duplicateTokens, pk: ["id"] },
    duplicate_candidates: { table: schema.duplicateCandidates, pk: ["id"] },
    form_submissions: { table: schema.formSubmissions, pk: ["id"] },
    contract_invitations: { table: schema.contractInvitations, pk: ["token"] },
    pii_access_requests: { table: schema.piiAccessRequests, pk: ["id"] },
    pii_access_grants: { table: schema.piiAccessGrants, pk: ["id"] },
    data_requests: { table: schema.dataRequests, pk: ["id"] },
    audit_log: { table: schema.auditLog, pk: ["id"] },
    notifications: { table: schema.notifications, pk: ["id"] },
    error_reports: { table: schema.errorReports, pk: ["id"] },
    blocked_logins: { table: schema.blockedLogins, pk: ["id"] },
    searches: { table: schema.searches, pk: ["id"] },
    chat_conversations: { table: schema.chatConversations, pk: ["id"] },
    chat_messages: { table: schema.chatMessages, pk: ["id"] },
};

// Build the ordered registry from the manifest so insert order = manifest order.
export const TABLE_REGISTRY: TableEntry[] = TABLE_MANIFEST.map(m => {
    const details = TABLE_DETAILS[m.key];
    if (!details) {
        throw new Error(`dataMigration: manifest key "${m.key}" has no TABLE_DETAILS entry`);
    }
    return { key: m.key, table: details.table, pk: details.pk };
});

export const TABLE_BY_KEY: Record<string, TableEntry> = Object.fromEntries(
    TABLE_REGISTRY.map(e => [e.key, e])
);

export function defaultSelection(): string[] {
    return defaultSelectionFromManifest();
}

export function pickInsertOrder(selectedKeys: string[]): TableEntry[] {
    const set = new Set(selectedKeys);
    return TABLE_REGISTRY.filter(e => set.has(e.key));
}

export function pickDeleteOrder(selectedKeys: string[]): TableEntry[] {
    return [...pickInsertOrder(selectedKeys)].reverse();
}

/**
 * Convert a JSON-round-tripped row back into something Drizzle can insert.
 * Why: `mode: "timestamp"` and `mode: "timestamp_ms"` columns come out of
 * `db.select().all()` as JS `Date`s, which JSON.stringify renders as ISO
 * strings. Without converting back, ISO strings land in INTEGER columns and
 * `parseInt("2026-05-25...")` reads back as 2026 ms past the epoch.
 */
export function coerceRow(table: SQLiteTable, row: Record<string, unknown>): Record<string, unknown> {
    const cols = getTableColumns(table) as Record<string, AnySQLiteColumn>;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
        const col = cols[key];
        if (value !== null && col && isTimestampColumn(col) && typeof value === "string") {
            out[key] = new Date(value);
        } else {
            out[key] = value;
        }
    }
    return out;
}

function isTimestampColumn(col: AnySQLiteColumn): boolean {
    return col.columnType === "SQLiteTimestamp" || col.columnType === "SQLiteTimestampMs";
}
