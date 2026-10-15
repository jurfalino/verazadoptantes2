/**
 * Form answers a rescue's own tool sent with an API adoption request
 * (activity_forms). Like our own form results (/form-results), the answers are
 * for the rescue that registered the request — the rescuer who sent it, or
 * someone in a DIRECTLY shared organization — and admins. Everyone else sees
 * the activity, not the applicant's answers. Server-only.
 */
import { eq } from 'drizzle-orm';
import { activityForms } from '@/db/schema';
import { logger } from '@/lib/logger';
import { loadOrgMembership, sameRescueDirect } from '@/lib/rescueKeys';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

export async function attachActivityForms<T extends { id: string; recordType?: string | null }>(
    db: Db, records: T[], viewer: string | null, viewerIsAdmin: boolean, membership?: Map<string, string[]>,
): Promise<Array<T & { formContent?: Record<string, unknown> }>> {
    const requests = records.filter(r => r.recordType === 'adoption_request');
    if (requests.length === 0 || !viewer) return records;
    const rows = await Promise.all(requests.map(r =>
        db.select({ formContent: activityForms.formContent, addedBy: activityForms.addedBy }).from(activityForms).where(eq(activityForms.activityId, r.id)).get()
            .then((row: { formContent: string; addedBy: string | null } | undefined) => row ? { id: r.id, ...row } : null)
            .catch((e: unknown) => {
                logger.warn('attachActivityForms: D1 fallback hit', { recordId: r.id, error: e instanceof Error ? e.message : String(e) });
                return null;
            })));
    const found = rows.filter((x): x is { id: string; formContent: string; addedBy: string | null } => !!x);
    if (found.length === 0) return records;
    // Decided by who SENT the form (activity_forms.added_by), not by the activity row.
    const orgs = viewerIsAdmin ? new Map<string, string[]>() : membership ?? await loadOrgMembership(db, 'attachActivityForms');
    const forms = new Map<string, Record<string, unknown>>();
    for (const f of found) {
        if (!viewerIsAdmin && !sameRescueDirect(viewer, f.addedBy, orgs)) continue;
        try { forms.set(f.id, JSON.parse(f.formContent)); } catch (e) {
            logger.warn('attachActivityForms: unreadable form content', { recordId: f.id, error: e instanceof Error ? e.message : String(e) });
        }
    }
    return records.map(r => forms.has(r.id) ? { ...r, formContent: forms.get(r.id) } : r);
}
