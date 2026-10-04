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
import { maskEmail } from '@/lib/dates';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auditLog, organizations, users } from '@/db/schema';
import {
    getMemberOrgIds, getUserDocsSource, getSettingsRow, getContractVersion,
    saveContract, saveHiddenStepsIfUnchanged, listOwnerVersions, sha256Hex,
} from '@/lib/adoptionDocsRepo';
import {
    normalizeEmail, resolveDocsOwner, contractSectionsSchema, richDocSchema,
    serializeDocsSource, parseStoredHiddenSteps, SECTION_KEYS, TOGGLEABLE_FORM_STEPS,
    type DocsSource, type DocsOwner, type ContractSections, type RichDoc, type SectionKey,
} from '@/domain/adoptionDocs';
import {
    STANDARD_REVISION, sectionRevisionText, storedSection, stepStates, planItemSave, changedByOthers,
    mergeSections, mergeHidden, sectionAuthor, stepAuthor, type StepState, type HistoryEntry,
} from '@/domain/adoptionDocsCollab';
import { ADOPTION_DOCS_FORM_SAVED, ADOPTION_DOCS_CONTRACT_SAVED } from '@/domain/adoptionDocsActivity';

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
        // `email` is whoever last edited — possibly another group member.
        logger.warn('adoptionDocs.resolveDisplayName: D1 fallback hit', {
            email: maskEmail(email), error: e instanceof Error ? e.message : String(e),
        });
        return email.split('@')[0];
    }
}

/** organizations.name, or null when the org row doesn't exist. Throws on a DB error. */
async function findOrgName(db: Db, orgId: string): Promise<string | null> {
    const row = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).get();
    return row ? row.name : null;
}

async function resolveOrgName(db: Db, orgId: string): Promise<string> {
    try {
        return (await findOrgName(db, orgId)) ?? '';
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
    // Same "customized" test resolveDocsForRescuer uses to decide standard vs
    // custom — and the same guarded parse, so a bad row can't fail the card.
    const { steps, malformed } = parseStoredHiddenSteps(row.hiddenSteps);
    if (malformed) {
        logger.warn('adoptionDocs.summarize: malformed hidden_steps, treating as none', { settingsId: row.id });
    }
    const customized = steps.length > 0 || !!row.contractVersionId;
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

// ── Collaborative editing helpers (see src/domain/adoptionDocsCollab.ts) ──

export type ItemRevisions = { sections: Record<SectionKey, string>; steps: Record<string, StepState> };

/** Per-section revision: a hash of the text as stored, or 'std' for the standard text. */
async function sectionRevisions(sections: ContractSections): Promise<Record<SectionKey, string>> {
    const out = {} as Record<SectionKey, string>;
    for (const k of SECTION_KEYS) {
        const text = sectionRevisionText(k, sections[k]);
        out[k] = text === null ? STANDARD_REVISION : await sha256Hex(text);
    }
    return out;
}

/** Parse a stored contract version's sections, guarded (a bad row reads as standard). */
function parseVersionSections(raw: string, ctx: Record<string, unknown>): ContractSections {
    try {
        const parsed = contractSectionsSchema.safeParse(JSON.parse(raw));
        if (parsed.success) return parsed.data;
        logger.warn('adoptionDocs: invalid stored sections', { ...ctx, issues: parsed.error.issues.map(i => i.path.join('.')) });
    } catch (e) {
        logger.warn('adoptionDocs: malformed stored sections_json', { ...ctx, error: e instanceof Error ? e.message : String(e) });
    }
    return {};
}

/** What the owner's docs are right now, as one read. */
async function readCurrentDocs(db: Db, docsOwner: DocsOwner, ctx: Record<string, unknown>) {
    const settingsRow = await getSettingsRow(db, docsOwner);
    let sections: ContractSections = {};
    if (settingsRow?.contractVersionId) {
        const versionRow = await getContractVersion(db, settingsRow.contractVersionId);
        if (!versionRow) logger.warn('adoptionDocs: contract version missing', { ...ctx, contractVersionId: settingsRow.contractVersionId });
        else sections = parseVersionSections(versionRow.sectionsJson, { ...ctx, contractVersionId: versionRow.id });
    }
    const { steps: hidden, malformed } = parseStoredHiddenSteps(settingsRow?.hiddenSteps);
    if (malformed) logger.warn('adoptionDocs: malformed hidden_steps, showing none hidden', { ...ctx, settingsId: settingsRow?.id });
    return {
        settingsRow,
        versionId: settingsRow?.contractVersionId ?? null,
        sections,
        hidden,
        hiddenRaw: settingsRow?.hiddenSteps ?? null,
    };
}

/**
 * Display names (name, else email handle — never a full email) of whoever
 * introduced each section's current text, from the owner's version history.
 * Falls back to the last saver when the history doesn't reach (old unsigned
 * versions are cleaned up; a reset to the standard text writes no version).
 */
async function sectionAuthors(
    db: Db, docsOwner: DocsOwner, current: Awaited<ReturnType<typeof readCurrentDocs>>, keys: SectionKey[],
): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    if (!keys.length) return out;
    let history: HistoryEntry[] = [];
    try {
        const versions = await listOwnerVersions(db, docsOwner);
        history = versions.map(v => ({ sections: parseVersionSections(v.sectionsJson, { versionId: v.id }), by: v.createdBy }));
        // Reset to the standard text: no version row is current — the
        // settings row's last saver did it.
        if (!current.versionId) history.unshift({ sections: {}, by: current.settingsRow?.updatedBy ?? null });
    } catch (e) {
        logger.warn('adoptionDocs.sectionAuthors: history lookup failed, using last saver', {
            ownerType: docsOwner.ownerType, error: e instanceof Error ? e.message : String(e),
        });
    }
    for (const k of keys) {
        const email = sectionAuthor(k, history) ?? current.settingsRow?.updatedBy ?? null;
        out[k] = email ? await resolveDisplayName(db, email) : '';
    }
    return out;
}

/** Same, for form questions: from the form-save audit rows that record which toggles changed. */
async function stepAuthors(
    db: Db, docsOwner: DocsOwner, current: Awaited<ReturnType<typeof readCurrentDocs>>, keys: string[],
): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    if (!keys.length) return out;
    let rows: Array<{ by: string | null; changedSteps: Array<{ id: string; hidden: boolean }> }> = [];
    try {
        const where = docsOwner.ownerType === 'org'
            ? and(eq(auditLog.action, ADOPTION_DOCS_FORM_SAVED), eq(auditLog.target, docsOwner.ownerId))
            : and(eq(auditLog.action, ADOPTION_DOCS_FORM_SAVED), eq(auditLog.userEmail, docsOwner.ownerId), isNull(auditLog.target));
        const raw = await db.select({ userEmail: auditLog.userEmail, details: auditLog.details })
            .from(auditLog).where(where).orderBy(desc(auditLog.createdAt), sql`rowid DESC`).limit(50).all() as Array<{ userEmail: string | null; details: string | null }>;
        rows = raw.map(r => {
            let changed: Array<{ id: string; hidden: boolean }> = [];
            try {
                const d = r.details ? JSON.parse(r.details) : {};
                if (Array.isArray(d.changedSteps)) changed = d.changedSteps.filter((c: unknown): c is { id: string; hidden: boolean } =>
                    !!c && typeof (c as { id?: unknown }).id === 'string' && typeof (c as { hidden?: unknown }).hidden === 'boolean');
            } catch { /* an unreadable audit row only loses its attribution — skip it */ }
            return { by: r.userEmail, changedSteps: changed };
        });
    } catch (e) {
        logger.warn('adoptionDocs.stepAuthors: audit lookup failed, using last saver', {
            ownerType: docsOwner.ownerType, error: e instanceof Error ? e.message : String(e),
        });
    }
    const states = stepStates(current.hidden);
    for (const k of keys) {
        const email = stepAuthor(k, states[k], rows) ?? current.settingsRow?.updatedBy ?? null;
        out[k] = email ? await resolveDisplayName(db, email) : '';
    }
    return out;
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

        const email = actorEmail;
        const [rawSource, selfRow, memberOrgIds] = await Promise.all([
            getUserDocsSource(db, email),
            getSettingsRow(db, { ownerType: 'user', ownerId: normalizeEmail(email) }),
            // Same case-tolerant membership lookup the public resolution uses,
            // so the card and the public form always agree on the groups.
            getMemberOrgIds(db, email),
        ]);

        // Names by single-row lookups (no inArray on D1). A membership whose
        // org row is gone is dropped, as before; a failed lookup keeps the
        // (verified) membership with an empty name rather than hiding it.
        const named = await Promise.all(memberOrgIds.map(async id => {
            try {
                const name = await findOrgName(db, id);
                return name === null ? null : { id, name };
            } catch (e) {
                logger.warn('adoptionDocs.getOverview: org name lookup failed', {
                    actorEmail: email, orgId: id, error: e instanceof Error ? e.message : String(e),
                });
                return { id, name: '' };
            }
        }));
        const orgs = named.filter((o): o is { id: string; name: string } => o !== null);

        // Effective source — same fallback resolveDocsForRescuer applies, so
        // the settings card never shows an org the caller has since left.
        const effectiveOwner = resolveDocsOwner(actorEmail, rawSource, memberOrgIds);
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
            logger.warn('adoptionDocs.setSource: invalid source', { actorEmail, source: String(source).slice(0, 64) });
            return { success: false, error: 'invalid' };
        }
        if (parsed.type === 'org') {
            const orgIds = await getMemberOrgIds(db, actorEmail);
            if (!orgIds.includes(parsed.orgId)) {
                logger.warn('adoptionDocs.setSource: forbidden', { actorEmail, orgId: parsed.orgId });
                return { success: false, error: 'forbidden' };
            }
        }

        const { getRequestContext } = await import('@/lib/requestContext');
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
            errorId: logger.error('adoptionDocs.setSource failed', e, { actorEmail, source: String(source).slice(0, 64) }),
        };
    }
}

/** The editor's data for one owner: hidden steps + contract sections + who/when. */
export async function getAdoptionDocs(owner: OwnerRef): Promise<{
    success: boolean;
    data?: {
        ownerName: string; hiddenSteps: string[]; sections: ContractSections;
        updatedAt: number | null; updatedByName: string | null;
        /** Per-item revisions the editor sends back with a save. */
        revisions: ItemRevisions;
    };
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

        // Each stored JSON column parsed on its own and guarded: a bad row
        // opens the editor with defaults for that part instead of failing.
        const [current, ownerName] = await Promise.all([
            readCurrentDocs(db, docsOwner, { actorEmail, owner }),
            owner.type === 'org' ? resolveOrgName(db, owner.orgId) : Promise.resolve(''),
        ]);
        const updatedByName = current.settingsRow ? await resolveDisplayName(db, current.settingsRow.updatedBy) : null;

        return {
            success: true,
            data: {
                ownerName,
                hiddenSteps: current.hidden,
                sections: current.sections,
                updatedAt: current.settingsRow?.updatedAt ?? null,
                updatedByName,
                revisions: { sections: await sectionRevisions(current.sections), steps: stepStates(current.hidden) },
            },
        };
    } catch (e) {
        return {
            success: false, error: 'generic',
            errorId: logger.error('adoptionDocs.get failed', e, { actorEmail, owner }),
        };
    }
}

// ── Saves: only what this editor changed, each item checked against the
// revision it was loaded at (src/domain/adoptionDocsCollab.ts). ─────────

const stepIdSchema = z.enum(TOGGLEABLE_FORM_STEPS as unknown as [string, ...string[]]);
const stepStateSchema = z.enum(['hidden', 'shown']);
const sectionKeySchema = z.enum(['2', '3', '4']);
const revSchema = z.string().max(100);

const formSaveSchema = z.object({
    loaded: z.partialRecord(stepIdSchema, stepStateSchema),
    changes: z.array(z.object({ key: stepIdSchema, hidden: z.boolean(), expected: stepStateSchema })).max(TOGGLEABLE_FORM_STEPS.length),
}).strict();

const contractSaveSchema = z.object({
    loaded: z.partialRecord(sectionKeySchema, revSchema),
    changes: z.array(z.object({
        key: sectionKeySchema,
        /** null = back to the standard text. */
        doc: richDocSchema.nullable(),
        expectedRev: revSchema,
    })).max(SECTION_KEYS.length),
}).strict();

export type FormSaveInput = z.infer<typeof formSaveSchema>;
export type ContractSaveInput = { loaded: Partial<Record<SectionKey, string>>; changes: Array<{ key: SectionKey; doc: RichDoc | null; expectedRev: string }> };

export type StepConflict = { key: string; by: string; theirs: StepState };
export type SectionConflict = { key: SectionKey; by: string; theirRev: string; doc: RichDoc | null };
export type ItemUpdate = { key: string; by: string };

type SaveFail = { success: false; error: string; errorId?: string };

/** CAS attempts per save: the first read, plus one re-read if another save landed in between. */
const SAVE_ATTEMPTS = 2;

/** Save the form questions this editor toggled. */
export async function saveFormSteps(owner: OwnerRef, input: FormSaveInput): Promise<SaveFail | {
    success: true;
    data: { saved: string[]; conflicts: StepConflict[]; updatedByOthers: ItemUpdate[]; hiddenSteps: string[]; revisions: Record<string, StepState> };
}> {
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

        const parsed = formSaveSchema.safeParse(input);
        if (!parsed.success) {
            return { success: false, error: 'invalid', errorId: logger.error('adoptionDocs.saveFormSteps: invalid input', new Error('invalid input'), {
                actorEmail, owner, issues: parsed.error.issues.map(i => i.path.join('.')),
            }) };
        }
        const { loaded, changes } = parsed.data;

        for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
            const current = await readCurrentDocs(db, docsOwner, { actorEmail, owner });
            const currentRevs = stepStates(current.hidden);
            const plan = planItemSave(currentRevs, changes.map(c => ({
                key: c.key, value: c.hidden, newRev: c.hidden ? 'hidden' : 'shown', expectedRev: c.expected,
            })));
            const applied = changes.filter(c => plan.apply.includes(c.key)).map(c => ({ key: c.key, hidden: c.hidden }));
            const next = mergeHidden(current.hidden, applied);

            if (applied.length) {
                const ok = await saveHiddenStepsIfUnchanged(db, docsOwner, next, actorEmail, current.hiddenRaw, !!current.settingsRow);
                if (!ok) continue; // someone saved in between — re-read and re-check
                await logAudit({
                    userEmail: actorEmail,
                    action: ADOPTION_DOCS_FORM_SAVED,
                    target: owner.type === 'org' ? owner.orgId : undefined,
                    details: {
                        ownerType: docsOwner.ownerType,
                        ...(owner.type === 'org' ? { orgId: owner.orgId } : {}),
                        hiddenCount: next.length,
                        // Who-changed-what for later conflicts («<Nombre> cambió esta pregunta»).
                        changedSteps: applied.map(a => ({ id: a.key, hidden: a.hidden })),
                    },
                });
            }

            const others = changedByOthers(loaded, currentRevs, changes.map(c => c.key));
            const conflictKeys = plan.conflicts;
            const names = await stepAuthors(db, docsOwner, current, [...new Set([...conflictKeys, ...others])]);
            const finalHidden = applied.length ? next : current.hidden;
            if (conflictKeys.length) logger.info('adoptionDocs.saveFormSteps: conflicts', { actorEmail, owner, conflicts: conflictKeys });
            return {
                success: true,
                data: {
                    saved: [...plan.apply, ...plan.alreadySaved],
                    conflicts: conflictKeys.map(k => ({ key: k, by: names[k] ?? '', theirs: currentRevs[k] })),
                    updatedByOthers: others.map(k => ({ key: k, by: names[k] ?? '' })),
                    hiddenSteps: finalHidden,
                    revisions: stepStates(finalHidden),
                },
            };
        }
        return { success: false, error: 'busy', errorId: logger.error('adoptionDocs.saveFormSteps: lost the race twice', new Error('busy'), { actorEmail, owner }) };
    } catch (e) {
        return {
            success: false, error: 'generic',
            errorId: logger.error('adoptionDocs.saveFormSteps failed', e, { actorEmail, owner }),
        };
    }
}

/** Save the contract sections this editor changed (§1.2 version rules still apply: a save is a new version). */
export async function saveContractSections(owner: OwnerRef, input: ContractSaveInput): Promise<SaveFail | {
    success: true;
    data: {
        saved: SectionKey[]; conflicts: SectionConflict[]; updatedByOthers: ItemUpdate[];
        sections: ContractSections; revisions: Record<SectionKey, string>; standard: boolean;
    };
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

        const parsed = contractSaveSchema.safeParse(input);
        if (!parsed.success) {
            return { success: false, error: 'invalid', errorId: logger.error('adoptionDocs.saveContractSections: invalid input', new Error('invalid input'), {
                actorEmail, owner, issues: parsed.error.issues.map(i => i.path.join('.')),
            }) };
        }
        const loaded = parsed.data.loaded as Partial<Record<SectionKey, string>>;
        // Each change as it would be stored (standard text → null) with its revision.
        const changes = await Promise.all(parsed.data.changes.map(async c => {
            const key = c.key as SectionKey;
            const doc = storedSection(key, c.doc as RichDoc | null);
            const text = sectionRevisionText(key, doc);
            return { key, value: doc, newRev: text === null ? STANDARD_REVISION : await sha256Hex(text), expectedRev: c.expectedRev };
        }));

        for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
            const current = await readCurrentDocs(db, docsOwner, { actorEmail, owner });
            const currentRevs = await sectionRevisions(current.sections);
            const plan = planItemSave(currentRevs, changes);
            const applied = changes.filter(c => plan.apply.includes(c.key)).map(c => ({ key: c.key, doc: c.value }));

            let finalSections = current.sections;
            let finalVersionId = current.versionId;
            if (applied.length) {
                const next = mergeSections(current.sections, applied);
                const result = await saveContract(db, docsOwner, next, actorEmail, current.versionId);
                if (result.raced) continue; // someone saved in between — re-read and re-check
                finalSections = next;
                finalVersionId = result.versionId;
                if (result.action !== 'noop') {
                    await logAudit({
                        userEmail: actorEmail,
                        action: ADOPTION_DOCS_CONTRACT_SAVED,
                        target: owner.type === 'org' ? owner.orgId : undefined,
                        details: {
                            ownerType: docsOwner.ownerType,
                            ...(owner.type === 'org' ? { orgId: owner.orgId } : {}),
                            action: result.action,
                            sections: applied.map(a => a.key),
                        },
                    });
                }
            }

            const others = changedByOthers(loaded as Record<SectionKey, string>, currentRevs, changes.map(c => c.key));
            const names = await sectionAuthors(db, docsOwner, current, [...new Set([...plan.conflicts, ...others])]);
            if (plan.conflicts.length) logger.info('adoptionDocs.saveContractSections: conflicts', { actorEmail, owner, conflicts: plan.conflicts });
            return {
                success: true,
                data: {
                    saved: [...plan.apply, ...plan.alreadySaved],
                    conflicts: plan.conflicts.map(k => ({ key: k, by: names[k] ?? '', theirRev: currentRevs[k], doc: current.sections[k] ?? null })),
                    updatedByOthers: others.map(k => ({ key: k, by: names[k] ?? '' })),
                    sections: finalSections,
                    revisions: await sectionRevisions(finalSections),
                    standard: finalVersionId === null,
                },
            };
        }
        return { success: false, error: 'busy', errorId: logger.error('adoptionDocs.saveContractSections: lost the race twice', new Error('busy'), { actorEmail, owner }) };
    } catch (e) {
        return {
            success: false, error: 'generic',
            errorId: logger.error('adoptionDocs.saveContractSections failed', e, { actorEmail, owner }),
        };
    }
}
