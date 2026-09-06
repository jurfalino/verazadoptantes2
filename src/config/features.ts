/**
 * Feature Flags System
 * 
 * Flags can be:
 * 1. DB-backed (stored in appConfig table, toggleable via Admin UI)
 * 2. Env-backed (set in environment variables)
 * 
 * DB flags take precedence over env flags.
 * Uses dynamic import for getDb to avoid Edge runtime issues in local dev.
 */

import { appConfig } from '@/db/schema';
import { eq } from 'drizzle-orm';

// Define all feature flags with their defaults
export const FEATURE_FLAGS = {
    ENABLE_CONTENT_IMPORT: false,
    ENABLE_ANIMALS_FOR_ADOPTION: false,
    // v2.55.16 (animal-timeline PR3): projected follow-ups — the future
    // timeline + banner on the animal page, the per-user schedule section in
    // /settings, the /my-animals pendientes badges, and (PR4) the reminder
    // cron Worker's run gate. Client-visible → also in PUBLIC_FLAG_KEYS.
    ENABLE_FOLLOWUPS: false,
    ENABLE_SEARCH_CARD_METADATA: true,
    ENABLE_CHAT_WIDGET: false,
    // PostHog session replay + product analytics (v2.49.0). Runs in PARALLEL
    // with Clarity and Amplitude — it replaces neither yet. Unlike those two
    // (loaded by Zaraz), PostHog is an app-code dependency: Zaraz's PostHog
    // component is server-side only and cannot do session replay.
    // Recording is UNMASKED by explicit decision — see the privacy note in
    // .agents/plans/2026-09-01-posthog-integration.md (D1).
    // Default off — server-side only, deliberately NOT in PUBLIC_FLAG_KEYS.
    ENABLE_POSTHOG: false,
    ENABLE_MILESTONE_BADGE: true,
    ENABLE_QUICK_ACCESS_STRIP: true,
    // Paste box in the adopter contact editor (bulk paste + auto-categorize).
    // When off, contact info is entered only via the manual typed fields.
    ENABLE_CONTACT_PASTE: true,
    // PII access gating (phase 2). When on: non-owner viewers see only the
    // contact info they searched/matched, the rest is masked behind approvable
    // access requests, and core-record edits are restricted to owner+admin.
    // Default off — server-side only, deliberately NOT in PUBLIC_FLAG_KEYS.
    ENABLE_PII_ACCESS_GATING: false,
    // Public-mode profiles (v2.16.0-12). When on:
    //  - Contact entries with `isPublic=true` (stamped by the ImportWizard
    //    write path on entries derived from public social posts) are NOT
    //    masked for any authenticated viewer.
    //  - Adopters with `is_public=1` (admin override via /admin/adopters
    //    pill toggle) have their whole record bypass PII masking — name
    //    renders fully, every contact entry unmasked, addressInfo unmasked.
    //    The admin override exposes even contributor-added entries that
    //    don't carry their own isPublic flag.
    // When off: both signals are completely ignored; existing PII gating
    // behavior is unchanged and the admin toggle is hidden.
    // Default off — server-side only, deliberately NOT in PUBLIC_FLAG_KEYS.
    ENABLE_PUBLIC_PROFILES: false,
    // Clean-homepage mode (v2.16.0-16). When on: the two activity cards
    // ("Registrar una adopción" + "Dejar una observación") are hidden and
    // the surviving import affordance is rendered as a small secondary
    // link-pill below the search instead of a peer card. Search becomes
    // unambiguously the homepage's primary action; import stays
    // discoverable for power users. Default off.
    ENABLE_CLEAN_HOMEPAGE: false,
    // Contact-import path (v2.16.0-33). Gates the homepage CTA that opens the
    // OS contact picker / .vcf upload and pre-fills the ImportWizard with the
    // chosen contact. The PWA share-target route handles arriving vCards
    // regardless of this flag (the manifest is static and can't be gated) —
    // only the homepage entry point is conditional. Default off.
    ENABLE_CONTACT_IMPORT: false,
    // Google Contacts import (v2.18.0). Separate from ENABLE_CONTACT_IMPORT
    // because the People-API path requires Google's OAuth verification
    // process — independent rollout cadence. When on, the homepage import
    // card surfaces a third "Desde Google Contacts" button alongside the
    // post + device-contacts options. Default off.
    ENABLE_GOOGLE_CONTACTS_IMPORT: false,
    // v2.14.10-1: three flags gate visibility of the public-showcase URL chips
    // on /my-animals. Each defaults FALSE so the URLs stay hidden until an
    // admin enables them explicitly per the staged rollout plan.
    SHOWCASE_GLOBAL_VISIBLE: false,
    SHOWCASE_ORG_VISIBLE: false,
    SHOWCASE_USER_VISIBLE: false,
    // v2.22.0: first-run click-Next demo modal teaching how to search an adopter,
    // over three mocked records. Public + admin-togglable. Default off.
    ENABLE_GUIDED_WALKTHROUGH: false,
    // Structured household/family members (name+relationship+own contacts) —
    // replaces the free-text family section. Household redesign (2026-08).
    ENABLE_HOUSEHOLD_MEMBERS: false,
    // Email OTP login (6-digit code) as an alternative to Google OAuth.
    // Requires Resend to be configured (RESEND_API_KEY secret + verified
    // sending domain) before enabling anywhere real. Client-visible (login
    // modal) → also in PUBLIC_FLAG_KEYS. Default off.
    ENABLE_EMAIL_OTP: false,
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

// Cache for feature flag values (refreshed on each request in Edge)
const _flagCache: Map<FeatureFlag, boolean> | null = null;

/**
 * Get a feature flag value
 * Priority: DB > ENV > Default
 * 
 * Note: On local dev, DB may not be available, so we gracefully fall back to env/default
 */
export async function getFeatureFlag(flag: FeatureFlag): Promise<boolean> {
    // Try environment variable first (fastest, works everywhere)
    const envValue = process.env[flag];
    if (envValue !== undefined) {
        return envValue === 'true' || envValue === '1';
    }

    // Try DB (only works in production/Cloudflare environment)
    try {
        // Dynamic import to avoid Edge runtime issues in local dev
        const { getDb } = await import('@/lib/db');
        const db = await getDb();
        if (db) {
            const row = await db.select()
                .from(appConfig)
                .where(eq(appConfig.key, flag))
                .get();

            if (row) {
                return row.value === 'true' || row.value === '1';
            }
        }
    } catch {
        // DB unavailable (local dev or error), use default
    }

    // Return default
    return FEATURE_FLAGS[flag];
}

/**
 * Set a feature flag in the database
 */
export async function setFeatureFlag(flag: FeatureFlag, value: boolean, updatedBy?: string): Promise<boolean> {
    try {
        const { getDb } = await import('@/lib/db');
        const db = await getDb();
        if (!db) return false;

        await db.insert(appConfig)
            .values({
                key: flag,
                value: value ? 'true' : 'false',
                updatedBy: updatedBy || 'system',
            })
            .onConflictDoUpdate({
                target: appConfig.key,
                set: {
                    value: value ? 'true' : 'false',
                    updatedBy: updatedBy || 'system',
                },
            });

        return true;
    } catch {
        return false;
    }
}

/**
 * Get all feature flags with their current values
 */
export async function getAllFeatureFlags(): Promise<Record<FeatureFlag, boolean>> {
    const result: Record<FeatureFlag, boolean> = {
        ENABLE_CONTENT_IMPORT: false,
        ENABLE_ANIMALS_FOR_ADOPTION: false,
        ENABLE_FOLLOWUPS: false,
        ENABLE_EMAIL_OTP: false,
        ENABLE_SEARCH_CARD_METADATA: true,
        ENABLE_CHAT_WIDGET: false,
        ENABLE_POSTHOG: false,
        ENABLE_MILESTONE_BADGE: true,
        ENABLE_QUICK_ACCESS_STRIP: true,
        ENABLE_CONTACT_PASTE: true,
        ENABLE_PII_ACCESS_GATING: false,
        ENABLE_PUBLIC_PROFILES: false,
        ENABLE_CLEAN_HOMEPAGE: false,
        ENABLE_CONTACT_IMPORT: false,
        ENABLE_GOOGLE_CONTACTS_IMPORT: false,
        SHOWCASE_GLOBAL_VISIBLE: false,
        SHOWCASE_ORG_VISIBLE: false,
        SHOWCASE_USER_VISIBLE: false,
        ENABLE_GUIDED_WALKTHROUGH: false,
        ENABLE_HOUSEHOLD_MEMBERS: false,
    };

    for (const flag of Object.keys(FEATURE_FLAGS) as FeatureFlag[]) {
        result[flag] = await getFeatureFlag(flag);
    }

    return result;
}
