// Client-safe descriptor of the export/import table set. Mirrors the order
// and grouping of TABLE_REGISTRY in dataMigration.ts but carries zero Drizzle
// imports, so the admin/data page can bundle this without pulling the whole
// schema into the client.
//
// If you add a table here you must also add it to TABLE_REGISTRY (and vice
// versa). The keys must match exactly.

export type TableGroupKey =
    | "core"
    | "people"
    | "orgs"
    | "applicants"
    | "pii"
    | "config"
    | "duplicates"
    | "operational"
    | "auth";

export interface TableGroupMeta {
    key: TableGroupKey;
    label: string;
    description: string;
    defaultOn: boolean;
}

export const TABLE_GROUPS: TableGroupMeta[] = [
    { key: "core", label: "Core adopter data", description: "Adopters, adoptions, images, flags, history", defaultOn: true },
    { key: "people", label: "User profiles", description: "Roles, handles, country, T&C acceptance", defaultOn: true },
    { key: "orgs", label: "Organizations", description: "Orgs, members, invites", defaultOn: true },
    { key: "applicants", label: "Applicants & contracts", description: "Form submissions, contract invitations", defaultOn: true },
    { key: "pii", label: "PII access", description: "Requests and grants", defaultOn: true },
    { key: "config", label: "Feature flags / config", description: "App config key/value store", defaultOn: true },
    { key: "duplicates", label: "Duplicate detection cache", description: "Tokens and candidates — can be regenerated", defaultOn: false },
    { key: "operational", label: "Operational logs", description: "Audit, notifications, stats, error reports, blocked logins, chat, searches, data requests", defaultOn: false },
    { key: "auth", label: "Auth (sessions, accounts)", description: "Usually leave OFF — copying sessions/accounts/users between envs breaks sign-in", defaultOn: false },
];

export interface TableMeta {
    key: string;
    label: string;
    group: TableGroupKey;
}

export const TABLE_MANIFEST: TableMeta[] = [
    { key: "app_config", label: "Config", group: "config" },
    { key: "users", label: "Users (Auth)", group: "auth" },
    { key: "user_profiles", label: "User profiles", group: "people" },
    { key: "accounts", label: "Accounts (OAuth)", group: "auth" },
    { key: "sessions", label: "Sessions", group: "auth" },
    { key: "verificationTokens", label: "Verification tokens", group: "auth" },
    { key: "organizations", label: "Organizations", group: "orgs" },
    { key: "org_members", label: "Org members", group: "orgs" },
    { key: "org_invites", label: "Org invites", group: "orgs" },
    { key: "adopters", label: "Adopters", group: "core" },
    { key: "adoptions", label: "Adoptions", group: "core" },
    { key: "adopter_images", label: "Adopter images", group: "core" },
    { key: "adopter_flags", label: "Adopter flags", group: "core" },
    { key: "adopter_history", label: "Adopter history", group: "core" },
    { key: "adopter_stats", label: "Adopter stats", group: "operational" },
    { key: "duplicate_tokens", label: "Duplicate tokens", group: "duplicates" },
    { key: "duplicate_candidates", label: "Duplicate candidates", group: "duplicates" },
    { key: "form_submissions", label: "Form submissions", group: "applicants" },
    { key: "contract_invitations", label: "Contract invitations", group: "applicants" },
    { key: "pii_access_requests", label: "PII access requests", group: "pii" },
    { key: "pii_access_grants", label: "PII access grants", group: "pii" },
    { key: "data_requests", label: "Data requests (ARCO)", group: "operational" },
    { key: "audit_log", label: "Audit log", group: "operational" },
    { key: "notifications", label: "Notifications", group: "operational" },
    { key: "error_reports", label: "Error reports", group: "operational" },
    { key: "blocked_logins", label: "Blocked logins", group: "operational" },
    { key: "searches", label: "Searches", group: "operational" },
    { key: "chat_conversations", label: "Chat conversations", group: "operational" },
    { key: "chat_messages", label: "Chat messages", group: "operational" },
];

export function defaultSelectionFromManifest(): string[] {
    const onGroups = new Set(TABLE_GROUPS.filter(g => g.defaultOn).map(g => g.key));
    return TABLE_MANIFEST.filter(t => onGroups.has(t.group)).map(t => t.key);
}

export function tablesInGroup(groupKey: TableGroupKey): TableMeta[] {
    return TABLE_MANIFEST.filter(t => t.group === groupKey);
}
