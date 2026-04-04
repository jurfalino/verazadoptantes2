'use server';

import { getUser } from './_db';
import { logger } from '@/lib/logger';

export interface OrgActivityEntry {
    id: string;
    userEmail: string;
    action: string;
    target: string | null;
    details: string | null;
    createdAt: number;
}

// Actions that are meaningful for org activity feed
const ACTIVITY_ACTIONS = [
    'adopter_created',
    'adopter_updated',
    'adoption_added',
    'adoption_updated',
    'image_uploaded',
    'flag_created',
    'adopter_deleted',
    'adopter_deletion_requested',
    'verification_added',
];

/**
 * Get recent activity from org members by querying the audit_log table.
 * Filters by org member emails and relevant action types.
 */
export async function getOrgActivity(limit: number = 30): Promise<OrgActivityEntry[]> {
    try {
        const _user = await getUser();
        const { getOrgMemberEmails } = await import('@/app/actions/organizations');
        const emails = await getOrgMemberEmails();

        // If user has no org or is the only member, no team activity to show
        if (emails.length <= 1) return [];

        const { getRequestContext } = await import('@cloudflare/next-on-pages');
        const { env } = getRequestContext();
        if (!env?.DB) return [];

        // Build parameterized query — D1 doesn't support array binding, so we build placeholders
        const placeholders = emails.map(() => '?').join(',');
        const actionPlaceholders = ACTIVITY_ACTIONS.map(() => '?').join(',');

        const result = await env.DB.prepare(
            `SELECT id, user_email, action, target, details, created_at
             FROM audit_log
             WHERE user_email IN (${placeholders})
             AND action IN (${actionPlaceholders})
             ORDER BY created_at DESC
             LIMIT ?`
        ).bind(...emails, ...ACTIVITY_ACTIONS, limit).all<{
            id: string;
            user_email: string;
            action: string;
            target: string | null;
            details: string | null;
            created_at: number;
        }>();

        return (result.results || []).map(row => ({
            id: row.id,
            userEmail: row.user_email,
            action: row.action,
            target: row.target,
            details: row.details,
            createdAt: row.created_at,
        }));
    } catch (error) {
        logger.warn('getOrgActivity failed', { error: error instanceof Error ? error.message : String(error) });
        return [];
    }
}
