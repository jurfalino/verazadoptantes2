/**
 * «Al cambiar de grupos» — a change of groups never switches a rescuer's
 * shared links silently (spec 2026-11-13-group-branding-design.md; rulings
 * R17, R18). Shared by every path that changes a membership: the
 * /organizations server actions (join, create, «Salir», «Quitar del grupo»)
 * and the admin routes (remove a member, delete a group). Not a 'use server'
 * file, so nothing here is a browser-callable action.
 *
 * Two steps around the membership write/delete:
 * - BEFORE (`keepDocsSourceBeforeChange`): a never-chosen source whose
 *   sole-group default the change would flip is stored as what was in effect
 *   (R17); before a join/create, a stored group she had already left becomes
 *   «Los míos» (it must not come back, nor be pre-selected in the question).
 * - AFTER a successful delete (`keepDocsSourceAfterChange`): a stored group
 *   she just lost becomes «Los míos» (R18).
 * Both are compare-and-set writes on her own row, audited on her
 * (`adoption_docs_source_changed`), and NEVER throw: a failure is logged with
 * the caller's context and the membership change goes on.
 */
import { getDb } from '@/lib/db';
import { getFeatureFlag } from '@/config/features';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { getMemberOrgIds, getUserDocsSourceRaw, setDocsSourceIfStill } from '@/lib/adoptionDocsRepo';
import { docsSourceWriteAfterChange, docsSourceWriteBeforeChange, type DocsSourceWrite } from '@/domain/adoptionDocs';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type DocsFlags = { brandingOn: boolean; customDocsOn: boolean };
/** Her state before the change: what the ask decision and the after-step read. */
export type DocsBefore = { raw: string | null; memberOrgIds: string[]; flags: DocsFlags };
export type MembershipChange = 'join' | 'create' | 'leave' | 'removal';

export type ChangeContext = {
    /** Whose groups change — the removed person on a removal, never the actor. */
    email: string;
    orgId: string;
    change: MembershipChange;
    /** Log prefix, e.g. 'leaveOrganization'. */
    op: string;
    /** Extra log context (the caller's own fields: user, memberId, …). */
    ctx?: Record<string, unknown>;
    /** Who removed her (removals only) — recorded in the audit details. */
    actorEmail?: string;
};

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const adding = (change: MembershipChange) => change === 'join' || change === 'create';

/** Her «Al compartir, usar:» state now. Throws on a DB error. */
export async function readDocsBefore(db: Db, email: string): Promise<DocsBefore> {
    const [raw, memberOrgIds, brandingOn, customDocsOn] = await Promise.all([
        getUserDocsSourceRaw(db, email),
        getMemberOrgIds(db, email),
        getFeatureFlag('ENABLE_GROUP_BRANDING'),
        getFeatureFlag('ENABLE_CUSTOM_ADOPTION_DOCS'),
    ]);
    return { raw, memberOrgIds, flags: { brandingOn, customDocsOn } };
}

/** Her groups once the change is done. */
export function groupsAfter(before: DocsBefore, orgId: string, change: MembershipChange): string[] {
    return adding(change) ? [...new Set([...before.memberOrgIds, orgId])] : before.memberOrgIds.filter(id => id !== orgId);
}

async function applyWrite(db: Db, write: DocsSourceWrite, c: ChangeContext): Promise<void> {
    const logCtx = { ...c.ctx, orgId: c.orgId, source: write.value };
    try {
        if (!(await setDocsSourceIfStill(db, c.email, write.expected, write.value))) return; // changed in between: hers wins
        const reason = write.reason === 'left_group' ? 'left_group' : `kept_on_${c.change === 'create' ? 'join' : c.change}`;
        await logAudit({
            userEmail: c.email,
            action: 'adoption_docs_source_changed',
            details: { source: write.value, reason, ...(c.actorEmail ? { actorEmail: c.actorEmail } : {}) },
        });
        logger.info(`${c.op}: docs source kept across the group change`, { ...logCtx, reason });
    } catch (e) {
        logger.warn(`${c.op}: keeping the docs source failed, going on`, { ...logCtx, error: errText(e) });
    }
}

/**
 * Run BEFORE the membership row is written or deleted. Returns her state
 * before the change (for the ask decision and the after-step), or null when
 * even reading it failed (logged; then nothing is kept and nothing asked).
 */
export async function keepDocsSourceBeforeChange(db: Db, c: ChangeContext): Promise<DocsBefore | null> {
    let before: DocsBefore;
    try {
        before = await readDocsBefore(db, c.email);
    } catch (e) {
        logger.warn(`${c.op}: docs source read failed, not kept and not asked`, { ...c.ctx, orgId: c.orgId, error: errText(e) });
        return null;
    }
    const write = docsSourceWriteBeforeChange(before.raw, before.memberOrgIds, groupsAfter(before, c.orgId, c.change), before.flags.brandingOn, adding(c.change));
    if (write) await applyWrite(db, write, c);
    return before;
}

/** Run AFTER a successful leave / removal / group delete, with what the before-step returned. */
export async function keepDocsSourceAfterChange(db: Db, before: DocsBefore | null, c: ChangeContext): Promise<void> {
    if (!before) return; // the before-step already logged why
    const write = docsSourceWriteAfterChange(before.raw, before.memberOrgIds, groupsAfter(before, c.orgId, c.change));
    if (write) await applyWrite(db, write, c);
}
