/**
 * Form answers a rescue's own tool sent with an API adoption request
 * (activity_forms). Like our own form results (/form-results), the answers are
 * for the rescue that registered the request (its owner and organization) and
 * admins — everyone else sees the activity, not the applicant's answers.
 * Server-only.
 */
import { eq } from 'drizzle-orm';
import { activityForms } from '@/db/schema';
import { logger } from '@/lib/logger';
import { loadRescueKeys } from '@/lib/rescueKeys';
import { knownRescuer } from '@/domain/requestDensity';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

export async function attachActivityForms<T extends { id: string; recordType?: string | null; addedBy?: string | null }>(
    db: Db, records: T[], viewer: string | null, viewerIsAdmin: boolean,
): Promise<Array<T & { formContent?: Record<string, unknown> }>> {
    const requests = records.filter(r => r.recordType === 'adoption_request');
    if (requests.length === 0 || !viewer) return records;
    const keys = await loadRescueKeys(db, [viewer, ...requests.map(r => r.addedBy)], 'attachActivityForms');
    const me = knownRescuer(viewer);
    const myRescue = me ? keys.get(me) ?? `user:${me}` : null;
    const visible = requests.filter(r => {
        if (viewerIsAdmin) return true;
        const by = knownRescuer(r.addedBy);
        return !!by && !!myRescue && (keys.get(by) ?? `user:${by}`) === myRescue;
    });
    if (visible.length === 0) return records;
    const forms = new Map<string, Record<string, unknown>>();
    await Promise.all(visible.map(async r => {
        const row = await db.select({ formContent: activityForms.formContent }).from(activityForms).where(eq(activityForms.activityId, r.id)).get()
            .catch((e: unknown) => {
                logger.warn('attachActivityForms: D1 fallback hit', { recordId: r.id, error: e instanceof Error ? e.message : String(e) });
                return undefined;
            });
        if (!row?.formContent) return;
        try { forms.set(r.id, JSON.parse(row.formContent)); } catch (e) {
            logger.warn('attachActivityForms: unreadable form content', { recordId: r.id, error: e instanceof Error ? e.message : String(e) });
        }
    }));
    return records.map(r => forms.has(r.id) ? { ...r, formContent: forms.get(r.id) } : r);
}
