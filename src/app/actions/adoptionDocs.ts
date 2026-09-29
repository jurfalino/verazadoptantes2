'use server';

/**
 * Custom adoption form + contract — server actions backing the settings
 * card and editor page (Task 10). Authorization + orchestration only; every
 * read/write of adoption_doc_settings / contract_versions routes through
 * src/lib/adoptionDocsRepo.ts. See
 * docs/superpowers/specs/2026-09-29-custom-adoption-docs-design.md §3.1.
 *
 * IMPORTANT: a 'use server' file may only export async functions and
 * types — every export below is `export async function` or `export type`.
 * Private helpers may be sync; they're not part of the server-action
 * surface Next.js processes.
 */

import { getUser, getDb } from './_db';
import { getFeatureFlag } from '@/config/features';
import { logAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { eq } from 'drizzle-orm';
import { organizations, users } from '@/db/schema';
import { getOrgsForEmail } from '@/lib/orgMembership';
import {
    getMemberOrgIds, getUserDocsSource, getSettingsRow, getContractVersion,
    saveHiddenSteps, saveContract,
} from '@/lib/adoptionDocsRepo';
import {
    normalizeEmail, resolveDocsOwner, sanitizeHiddenSteps, contractSectionsSchema,
    serializeDocsSource, ADOPTION_DOCS_FORM_SAVED, ADOPTION_DOCS_CONTRACT_SAVED,
    type DocsSource, type DocsOwner, type ContractSections,
} from '@/domain/adoptionDocs';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type OwnerRef = { type: 'self' } | { type: 'org'; orgId: string };
export type DocsSummary = { customized: boolean; updatedAt: number | null; updatedByName: string | null };

// ── Private helpers (sync/async — not exported, so the 'use server' export
// rule doesn't apply to them) ──────────────────────────────────────

/**
 * users.name for `email`, falling back to the local-part — same rule as the
 * contract route's rescuerDisplay (src/app/api/contract/[id]/route.ts).
 */
async function resolveDisplayName(db: Db, email: string): Promise<string> {
    try {
        const row = await db.select({ name: users.name }).from(users).where(eq(users.email, email)).get();
        const name = row?.name?.trim();
        return name || email.split('@')[0];
    } catch (e) {
        logger.warn('adoptionDocs.resolveDisplayName: D1 fallback hit', {
            email, error: e instanceof Error ? e.message : String(e),
        });
        return email.split('@')[0];
    }
}

async function resolveOrgName(db: Db, orgId: string): Promise<string> {
    try {
        const row = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).get();
        return row?.name ?? '';
    } catch (e) {
        logger.warn('adoptionDocs.resolveOrgName: D1 fallback hit', {
            orgId, error: e instanceof Error ? e.message : String(e),
        });
        return '';
    }
}

async function summarizeSettingsRow(
    db: Db, row: Awaited<ReturnType<typeof getSettingsRow>>,
): Promise<DocsSummary> {
    if (!row) return { customized: false, updatedAt: null, updatedByName: null };
    // Same "customized" test resolveDocsForRescuer uses to decide standard vs custom.
    const hiddenCount: number = row.hiddenSteps ? (JSON.parse(row.hiddenSteps) as unknown[]).length : 0;
    const customized = hiddenCount > 0 || !!row.contractVersionId;
    return {
        customized,
        updatedAt: row.updatedAt,
        updatedByName: await resolveDisplayName(db, row.updatedBy),
    };
}

/**
 * self → the session email; org → verified org membership (any member may
 * edit, per spec D1). Returns null when the caller isn't authorized.
 */
async function resolveOwner(db: Db, actorEmail: string, owner: OwnerRef): Promise<DocsOwner | null> {
    if (owner.type === 'self') return { ownerType: 'user', ownerId: normalizeEmail(actorEmail) };
    const orgIds = await getMemberOrgIds(db, actorEmail);
    if (!orgIds.includes(owner.orgId)) return null;
    return { ownerType: 'org', ownerId: owner.orgId };
}

/**
 * Strict parser for the client-supplied `source` string — unlike the
 * lenient `parseDocsSource` (used to read a stored value back, where any
 * unrecognized string silently means "self"), an invalid write here must be
 * rejected, not quietly coerced.
 */
function parseSourceInput(source: string): DocsSource | null {
    if (source === 'self') return { type: 'self' };
    if (source.startsWith('org:') && source.length > 4) return { type: 'org', orgId: source.slice(4) };
    return null;
}

// ── Actions ─────────────────────────────────────────────────────

/**
 * Settings-card overview: which source is currently active (falling back to
 * self if the stored org was left — spec Review Focus #4), plus a
 * customized/last-edited summary for "self" and every org the caller
 * belongs to.
 */
export async function getAdoptionDocsOverview(): Promise<{
    success: boolean;
    data?: { source: string; self: DocsSummary; orgs: Array<{ id: string; name: string } & DocsSummary> };
    error?: string;
    errorId?: string;
}> {
    let actorEmail: string | undefined;
    try {
        actorEmail = await getUser();
        if (!(await getFeatureFlag('ENABLE_CUSTOM_ADOPTION_DOCS'))) return { success: false, error: 'disabled' };

        const db = await getDb();
        if (!db) throw new Error('Database not available');

        const [rawSource, selfRow, orgs] = await Promise.all([
            getUserDocsSource(db, actorEmail),
            getSettingsRow(db, { ownerType: 'user', ownerId: normalizeEmail(actorEmail) }),
            getOrgsForEmail(actorEmail),
        ]);

        // Effective source — same fallback resolveDocsForRescuer applies, so
        // the settings card never shows an org the caller has since left.
        const effectiveOwner = resolveDocsOwner(actorEmail, rawSource, orgs.map(o => o.id));
        const source = effectiveOwner.ownerType === 'org' ? `org:${effectiveOwner.ownerId}` : 'self';

        const [self, orgSummaries] = await Promise.all([
            summarizeSettingsRow(db, selfRow),
            Promise.all(orgs.map(async org => {
                const row = await getSettingsRow(db, { ownerType: 'org', ownerId: org.id });
                const summary = await summarizeSettingsRow(db, row);
                return { id: org.id, name: org.name, ...summary };
            })),
        ]);

        return { success: true, data: { source, self, orgs: orgSummaries } };
    } catch (e) {
        return {
            success: false, error: 'generic',
            errorId: logger.error('adoptionDocs.getOverview failed', e, { actorEmail }),
        };
    }
}

/** Switch which owner's settings the caller's public form/contract read from. */
export async function setAdoptionDocsSource(source: string): Promise<{ success: boolean; error?: string; errorId?: string }> {
    let actorEmail: string | undefined;
    try {
        actorEmail = await getUser();
        if (!(await getFeatureFlag('ENABLE_CUSTOM_ADOPTION_DOCS'))) return { success: false, error: 'disabled' };

        const db = await getDb();
        if (!db) throw new Error('Database not available');

        const parsed = parseSourceInput(source);
        if (!parsed) {
            logger.warn('adoptionDocs.setSource: invalid source', { actorEmail, source });
            return { success: false, error: 'invalid' };
        }
        if (parsed.type === 'org') {
            const orgIds = await getMemberOrgIds(db, actorEmail);
            if (!orgIds.includes(parsed.orgId)) {
                logger.warn('adoptionDocs.setSource: forbidden', { actorEmail, orgId: parsed.orgId });
                return { success: false, error: 'forbidden' };
            }
        }

        const { getRequestContext } = await import('@cloudflare/next-on-pages');
        const { env } = getRequestContext();
        if (!env?.DB) throw new Error('Database not available');

        const user = await env.DB.prepare(`SELECT id FROM user WHERE email = ? LIMIT 1`)
            .bind(actorEmail).first<{ id: string }>();
        if (!user) throw new Error('User not found');

        const value = serializeDocsSource(parsed); // null for self, 'org:<id>' for org
        await env.DB.prepare(
            `INSERT INTO user_profiles (user_id, adoption_docs_source) VALUES (?, ?)
             ON CONFLICT(user_id) DO UPDATE SET adoption_docs_source = excluded.adoption_docs_source`
        ).bind(user.id, value).run();

        // Preference change, not a team event — audited for traceability
        // (same pattern as saveFollowupSettings) but intentionally not in
        // ACTIVITY_ACTIONS, since it's the caller's own read-source choice.
        await logAudit({
            userEmail: actorEmail,
            action: 'adoption_docs_source_changed',
            details: { source: value ?? 'self' },
        });

        return { success: true };
    } catch (e) {
        return {
            success: false, error: 'generic',
            errorId: logger.error('adoptionDocs.setSource failed', e, { actorEmail, source }),
        };
    }
}

/** The editor's data for one owner: hidden steps + contract sections + who/when. */
export async function getAdoptionDocs(owner: OwnerRef): Promise<{
    success: boolean;
    data?: { ownerName: string; hiddenSteps: string[]; sections: ContractSections; updatedAt: number | null; updatedByName: string | null };
    error?: string;
    errorId?: string;
}> {
    let actorEmail: string | undefined;
    try {
        actorEmail = await getUser();
        if (!(await getFeatureFlag('ENABLE_CUSTOM_ADOPTION_DOCS'))) return { success: false, error: 'disabled' };

        const db = await getDb();
        if (!db) throw new Error('Database not available');

        const docsOwner = await resolveOwner(db, actorEmail, owner);
        if (!docsOwner) {
            logger.warn('adoptionDocs.get: forbidden', { actorEmail, owner });
            return { success: false, error: 'forbidden' };
        }

        const [settingsRow, ownerName] = await Promise.all([
            getSettingsRow(db, docsOwner),
            owner.type === 'org' ? resolveOrgName(db, owner.orgId) : Promise.resolve(''),
        ]);

        const hiddenSteps: string[] = settingsRow?.hiddenSteps ? JSON.parse(settingsRow.hiddenSteps) : [];

        let sections: ContractSections = {};
        if (settingsRow?.contractVersionId) {
            const versionRow = await getContractVersion(db, settingsRow.contractVersionId);
            if (!versionRow) {
                logger.warn('adoptionDocs.get: contract version missing', {
                    actorEmail, owner, contractVersionId: settingsRow.contractVersionId,
                });
            } else {
                const parsed = contractSectionsSchema.safeParse(JSON.parse(versionRow.sectionsJson));
                if (parsed.success) {
                    sections = parsed.data;
                } else {
                    logger.warn('adoptionDocs.get: invalid stored sections', {
                        actorEmail, owner, issues: parsed.error.issues.map(i => i.path.join('.')),
                    });
                }
            }
        }

        const updatedByName = settingsRow ? await resolveDisplayName(db, settingsRow.updatedBy) : null;

        return {
            success: true,
            data: {
                ownerName,
                hiddenSteps,
                sections,
                updatedAt: settingsRow?.updatedAt ?? null,
                updatedByName,
            },
        };
    } catch (e) {
        return {
            success: false, error: 'generic',
            errorId: logger.error('adoptionDocs.get failed', e, { actorEmail, owner }),
        };
    }
}

/** Save the hidden-step selection for the form. */
export async function saveFormSteps(owner: OwnerRef, hiddenSteps: string[]): Promise<{ success: boolean; error?: string; errorId?: string }> {
    let actorEmail: string | undefined;
    try {
        actorEmail = await getUser();
        if (!(await getFeatureFlag('ENABLE_CUSTOM_ADOPTION_DOCS'))) return { success: false, error: 'disabled' };

        const db = await getDb();
        if (!db) throw new Error('Database not available');

        const docsOwner = await resolveOwner(db, actorEmail, owner);
        if (!docsOwner) {
            logger.warn('adoptionDocs.saveFormSteps: forbidden', { actorEmail, owner });
            return { success: false, error: 'forbidden' };
        }

        const sanitized = sanitizeHiddenSteps(hiddenSteps);
        await saveHiddenSteps(db, docsOwner, sanitized, actorEmail);

        await logAudit({
            userEmail: actorEmail,
            action: ADOPTION_DOCS_FORM_SAVED,
            target: owner.type === 'org' ? owner.orgId : undefined,
            details: {
                ownerType: docsOwner.ownerType,
                ...(owner.type === 'org' ? { orgId: owner.orgId } : {}),
                hiddenCount: sanitized.length,
            },
        });

        return { success: true };
    } catch (e) {
        return {
            success: false, error: 'generic',
            errorId: logger.error('adoptionDocs.saveFormSteps failed', e, { actorEmail, owner }),
        };
    }
}

/** Save the contract's editable sections (§1.2 version rules applied by saveContract). */
export async function saveContractSections(owner: OwnerRef, sections: unknown): Promise<{
    success: boolean;
    data?: { standard: boolean };
    error?: string;
    errorId?: string;
}> {
    let actorEmail: string | undefined;
    try {
        actorEmail = await getUser();
        if (!(await getFeatureFlag('ENABLE_CUSTOM_ADOPTION_DOCS'))) return { success: false, error: 'disabled' };

        const db = await getDb();
        if (!db) throw new Error('Database not available');

        const docsOwner = await resolveOwner(db, actorEmail, owner);
        if (!docsOwner) {
            logger.warn('adoptionDocs.saveContractSections: forbidden', { actorEmail, owner });
            return { success: false, error: 'forbidden' };
        }

        const parsed = contractSectionsSchema.safeParse(sections);
        if (!parsed.success) {
            logger.warn('adoptionDocs.saveContractSections: invalid input', {
                actorEmail, owner, issues: parsed.error.issues.map(i => i.path.join('.')),
            });
            return { success: false, error: 'invalid' };
        }

        const result = await saveContract(db, docsOwner, parsed.data, actorEmail);

        if (result.action !== 'noop') {
            await logAudit({
                userEmail: actorEmail,
                action: ADOPTION_DOCS_CONTRACT_SAVED,
                target: owner.type === 'org' ? owner.orgId : undefined,
                details: {
                    ownerType: docsOwner.ownerType,
                    ...(owner.type === 'org' ? { orgId: owner.orgId } : {}),
                    action: result.action,
                },
            });
        }

        return { success: true, data: { standard: result.versionId === null } };
    } catch (e) {
        return {
            success: false, error: 'generic',
            errorId: logger.error('adoptionDocs.saveContractSections failed', e, { actorEmail, owner }),
        };
    }
}
