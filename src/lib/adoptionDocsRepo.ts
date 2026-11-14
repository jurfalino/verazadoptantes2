/**
 * Custom adoption form + contract — repository and public-resolution helper.
 *
 * The only module that reads/writes adoption_doc_settings, contract_versions
 * and signed_contracts. Public API routes (Task 6) resolve what a rescuer's
 * form/contract should look like via `resolveDocsForRescuer`; server actions
 * (Task 5) call the read/write helpers directly for the settings UI.
 *
 * See docs/superpowers/specs/2026-09-29-custom-adoption-docs-design.md §1.2
 * (version rules) and §3.2 (resolution).
 */

import { and, desc, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { adoptionDocSettings, contractVersions, signedContracts, userProfiles, users, orgMembers } from '@/db/schema';
import { getDb } from '@/lib/db';
import { getFeatureFlag } from '@/config/features';
import { logger } from '@/lib/logger';
import { maskEmail } from '@/lib/dates';
import {
    normalizeEmail, resolveDocsOwner, parseDocsSource, effectiveDocsSource, parseStoredHiddenSteps, isContractVersionOwnedBy,
    contractSectionsSchema, normalizeSections, isStandardSections, canonicalSectionsJson,
    planContractSave, UNSIGNED_VERSION_TTL_SECONDS,
    type DocsSource, type DocsOwner, type ContractSections,
} from '@/domain/adoptionDocs';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type ResolvedDocs = {
    hiddenSteps: string[];
    contract: { versionId: string; sections: ContractSections } | null;
};

function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
}

export async function sha256Hex(s: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function getMemberOrgIds(db: Db, email: string): Promise<string[]> {
    const normalized = normalizeEmail(email);
    const rows = await db.select({ orgId: orgMembers.orgId })
        .from(orgMembers)
        .where(sql`lower(${orgMembers.userEmail}) = ${normalized}`)
        .all();
    return rows.map((r: { orgId: string }) => r.orgId);
}

/** The stored «Al compartir, usar:» value as-is: NULL (never chosen) is not the same as 'self'. */
export async function getUserDocsSourceRaw(db: Db, email: string): Promise<string | null> {
    const normalized = normalizeEmail(email);
    const row = await db.select({ adoptionDocsSource: userProfiles.adoptionDocsSource })
        .from(userProfiles)
        .innerJoin(users, eq(users.id, userProfiles.userId))
        .where(sql`lower(${users.email}) = ${normalized}`)
        .get();
    return row?.adoptionDocsSource ?? null;
}

/**
 * Compare-and-set of the «Al compartir, usar:» choice: store `value` only while
 * the stored value is still `expected` (null = never chosen) — a choice made
 * in between is never overwritten. Used to keep what was in effect across a
 * group change (src/lib/docsSourceKeep.ts). Same case-insensitive user
 * match as getUserDocsSourceRaw. Returns whether a value was written. Throws
 * on a DB error.
 */
export async function setDocsSourceIfStill(db: Db, email: string, expected: string | null, value: string): Promise<boolean> {
    const normalized = normalizeEmail(email);
    const updated = await db.update(userProfiles).set({ adoptionDocsSource: value })
        .where(and(
            expected === null ? isNull(userProfiles.adoptionDocsSource) : eq(userProfiles.adoptionDocsSource, expected),
            sql`EXISTS (SELECT 1 FROM user u WHERE u.id = user_profiles.user_id AND lower(u.email) = ${normalized})`,
        ))
        .returning({ userId: userProfiles.userId });
    if (updated.length > 0 || expected !== null) return updated.length > 0;
    // Never chosen because there is no profile row yet: create it with the value.
    const user = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${normalized}`).get() as { id: string } | undefined;
    if (!user) return false;
    const inserted = await db.insert(userProfiles).values({ userId: user.id, adoptionDocsSource: value })
        .onConflictDoNothing()
        .returning({ userId: userProfiles.userId });
    return inserted.length > 0;
}

export async function getUserDocsSource(db: Db, email: string): Promise<DocsSource> {
    return parseDocsSource(await getUserDocsSourceRaw(db, email));
}

/**
 * The share source actually in effect for `email` (its form, contract and —
 * with group branding — its look), plus the groups it belongs to. A user who
 * never chose and is in exactly one group gets that group, but only while
 * ENABLE_GROUP_BRANDING is on. The source may still name a group the user has
 * left: callers apply resolveDocsOwner / pickBrandingOrgId, which fall back.
 * Throws on a DB error (callers log with their own context).
 */
export type EffectiveDocsSource = { source: DocsSource; memberOrgIds: string[] };

/** `brandingOn`: ENABLE_GROUP_BRANDING already read by the caller for this request (skips a second read). */
export async function getEffectiveDocsSource(db: Db, email: string, opts: { brandingOn?: boolean } = {}): Promise<EffectiveDocsSource> {
    const [raw, memberOrgIds, soleGroupDefault] = await Promise.all([
        getUserDocsSourceRaw(db, email),
        getMemberOrgIds(db, email),
        opts.brandingOn ?? getFeatureFlag('ENABLE_GROUP_BRANDING'),
    ]);
    return { source: effectiveDocsSource(raw, memberOrgIds, soleGroupDefault), memberOrgIds };
}

/**
 * One request's effective-source lookup, shared by the docs and the branding
 * resolution (the public form needs both). Lazy: nothing runs until a caller
 * asks, so an early return (no rescuer) never leaves a rejected promise
 * unawaited. A failure rejects every caller, each inside its own try/catch.
 */
export function sharedEffectiveDocsSource(db: Db, email: string, opts: { brandingOn?: boolean } = {}): () => Promise<EffectiveDocsSource> {
    let pending: Promise<EffectiveDocsSource> | null = null;
    return () => (pending ??= getEffectiveDocsSource(db, email, opts));
}

export async function getSettingsRow(db: Db, owner: DocsOwner): Promise<typeof adoptionDocSettings.$inferSelect | null> {
    const row = await db.select().from(adoptionDocSettings)
        .where(and(eq(adoptionDocSettings.ownerType, owner.ownerType), eq(adoptionDocSettings.ownerId, owner.ownerId)))
        .get();
    return row ?? null;
}

export async function getContractVersion(db: Db, id: string): Promise<typeof contractVersions.$inferSelect | null> {
    const row = await db.select().from(contractVersions).where(eq(contractVersions.id, id)).get();
    return row ?? null;
}

/**
 * What the public form + contract should serve for this rescuer's animals.
 * Returns null for "standard" in every non-customized or failure case — the
 * public page must never break because of this lookup. See global constraint:
 * with no settings row, or the flag off, the form/contract stay byte-identical.
 */
export async function resolveDocsForRescuer(
    db: Db, rescuerEmail: string | null | undefined,
    opts: { effective?: () => Promise<EffectiveDocsSource> } = {},
): Promise<ResolvedDocs | null> {
    const email = rescuerEmail?.trim();
    if (!email || email === 'anonymous') return null;

    // Never log the rescuer's full email here — this runs on public,
    // unauthenticated routes. Masked is enough to correlate.
    const who = maskEmail(normalizeEmail(email));
    try {
        // Same effective source the branding uses, so a page's docs and look always agree.
        const [enabled, { source, memberOrgIds }] = await Promise.all([
            getFeatureFlag('ENABLE_CUSTOM_ADOPTION_DOCS'),
            opts.effective ? opts.effective() : getEffectiveDocsSource(db, email),
        ]);
        if (!enabled) return null;
        const owner = resolveDocsOwner(email, source, memberOrgIds);
        const settingsRow = await getSettingsRow(db, owner);
        if (!settingsRow) return null;

        // Each stored JSON column is parsed on its own: a bad hidden_steps
        // value drops only the hidden steps, a bad sections_json drops only
        // the contract — never both, never the whole page.
        const { steps: hiddenSteps, malformed } = parseStoredHiddenSteps(settingsRow.hiddenSteps);
        if (malformed) {
            logger.warn('resolveDocsForRescuer: malformed hidden_steps, showing every step', {
                rescuer: who, settingsId: settingsRow.id,
            });
        }
        if (!hiddenSteps.length && !settingsRow.contractVersionId) return null;

        let contract: ResolvedDocs['contract'] = null;
        if (settingsRow.contractVersionId) {
            const versionRow = await getContractVersion(db, settingsRow.contractVersionId);
            if (!versionRow) {
                logger.warn('resolveDocsForRescuer: contract version missing', {
                    rescuer: who, contractVersionId: settingsRow.contractVersionId,
                });
            } else {
                let raw: unknown;
                let jsonOk = true;
                try {
                    raw = JSON.parse(versionRow.sectionsJson);
                } catch (e) {
                    jsonOk = false;
                    logger.warn('resolveDocsForRescuer: malformed sections_json, standard contract', {
                        rescuer: who, contractVersionId: versionRow.id,
                        error: e instanceof Error ? e.message : String(e),
                    });
                }
                if (jsonOk) {
                    const parsed = contractSectionsSchema.safeParse(raw);
                    if (!parsed.success) {
                        logger.warn('resolveDocsForRescuer: invalid contract sections', {
                            rescuer: who, contractVersionId: versionRow.id,
                            issues: parsed.error.issues.map(i => i.path.join('.')),
                        });
                    } else {
                        contract = { versionId: versionRow.id, sections: parsed.data };
                    }
                }
            }
        }

        return { hiddenSteps, contract };
    } catch (error) {
        logger.warn('resolveDocsForRescuer: fell back to standard', {
            rescuer: who, error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

export async function saveHiddenSteps(db: Db, owner: DocsOwner, hiddenSteps: string[], actorEmail: string): Promise<void> {
    const now = nowSeconds();
    const hiddenStepsJson = hiddenSteps.length ? JSON.stringify(hiddenSteps) : null;
    await db.insert(adoptionDocSettings).values({
        id: crypto.randomUUID(),
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        hiddenSteps: hiddenStepsJson,
        updatedAt: now,
        updatedBy: actorEmail,
    }).onConflictDoUpdate({
        target: [adoptionDocSettings.ownerType, adoptionDocSettings.ownerId],
        set: { hiddenSteps: hiddenStepsJson, updatedAt: now, updatedBy: actorEmail },
    });
}

/**
 * Compare-and-swap on the hidden_steps column only (contract saves share the
 * row and must not collide with it): writes `hiddenSteps` only if the stored
 * value is still `expected` (the raw column value the caller read; null =
 * "no row / nothing hidden"). False when someone else saved in between.
 */
export async function saveHiddenStepsIfUnchanged(
    db: Db, owner: DocsOwner, hiddenSteps: string[], actorEmail: string, expected: string | null, rowExists: boolean,
): Promise<boolean> {
    const now = nowSeconds();
    const json = hiddenSteps.length ? JSON.stringify(hiddenSteps) : null;
    const ownerCond = and(eq(adoptionDocSettings.ownerType, owner.ownerType), eq(adoptionDocSettings.ownerId, owner.ownerId));
    if (!rowExists) {
        const ins = await db.insert(adoptionDocSettings).values({
            id: crypto.randomUUID(), ownerType: owner.ownerType, ownerId: owner.ownerId,
            hiddenSteps: json, updatedAt: now, updatedBy: actorEmail,
        }).onConflictDoNothing().returning({ id: adoptionDocSettings.id });
        return ins.length > 0;
    }
    const upd = await db.update(adoptionDocSettings)
        .set({ hiddenSteps: json, updatedAt: now, updatedBy: actorEmail })
        .where(and(ownerCond, expected === null ? isNull(adoptionDocSettings.hiddenSteps) : eq(adoptionDocSettings.hiddenSteps, expected)))
        .returning({ id: adoptionDocSettings.id });
    return upd.length > 0;
}

/** The owner's contract versions, newest first (bounded) — the history attribution walks. */
export async function listOwnerVersions(db: Db, owner: DocsOwner, limit = 50): Promise<Array<{ id: string; sectionsJson: string; createdBy: string; createdAt: number }>> {
    return db.select({
        id: contractVersions.id, sectionsJson: contractVersions.sectionsJson,
        createdBy: contractVersions.createdBy, createdAt: contractVersions.createdAt,
    }).from(contractVersions)
        .where(and(eq(contractVersions.ownerType, owner.ownerType), eq(contractVersions.ownerId, owner.ownerId)))
        // Same-second saves tie on created_at; insertion order (rowid) breaks the tie.
        .orderBy(desc(contractVersions.createdAt), sql`rowid DESC`)
        .limit(limit)
        .all();
}

async function cleanupUnsignedVersions(db: Db, owner: DocsOwner, now: number): Promise<void> {
    await db.delete(contractVersions).where(and(
        eq(contractVersions.ownerType, owner.ownerType),
        eq(contractVersions.ownerId, owner.ownerId),
        isNull(contractVersions.firstSignedAt),
        isNotNull(contractVersions.replacedAt),
        lt(contractVersions.replacedAt, now - UNSIGNED_VERSION_TTL_SECONDS),
    ));
}

/**
 * `expectedVersionId` (optional) turns the final pointer update into a
 * compare-and-swap on contract_version_id: the save only lands if the
 * owner's current version is still the one the caller read; otherwise the
 * new (unsigned) version is marked replaced so cleanup collects it, and the
 * result says `raced` — the caller re-reads and re-checks. Undefined = the
 * old unconditional behaviour.
 */
export async function saveContract(
    db: Db, owner: DocsOwner, sections: ContractSections, actorEmail: string,
    expectedVersionId?: string | null,
): Promise<{ action: 'noop' | 'setStandard' | 'insert'; versionId: string | null; raced?: boolean }> {
    const normalized = normalizeSections(sections);
    const nextHash = isStandardSections(normalized) ? null : await sha256Hex(canonicalSectionsJson(normalized));

    const settingsRow = await getSettingsRow(db, owner);
    if (expectedVersionId !== undefined && (settingsRow?.contractVersionId ?? null) !== expectedVersionId) {
        return { action: 'noop', versionId: settingsRow?.contractVersionId ?? null, raced: true };
    }
    const current = settingsRow?.contractVersionId ? await getContractVersion(db, settingsRow.contractVersionId) : null;
    const cas = expectedVersionId !== undefined;
    const ownerCond = and(eq(adoptionDocSettings.ownerType, owner.ownerType), eq(adoptionDocSettings.ownerId, owner.ownerId));
    /** Point the owner at `versionId`; under CAS only if the pointer is still `expectedVersionId`. */
    const pointTo = async (versionId: string | null, now: number): Promise<boolean> => {
        if (!cas) {
            await db.insert(adoptionDocSettings).values({
                id: crypto.randomUUID(), ownerType: owner.ownerType, ownerId: owner.ownerId,
                contractVersionId: versionId, updatedAt: now, updatedBy: actorEmail,
            }).onConflictDoUpdate({
                target: [adoptionDocSettings.ownerType, adoptionDocSettings.ownerId],
                set: { contractVersionId: versionId, updatedAt: now, updatedBy: actorEmail },
            });
            return true;
        }
        if (!settingsRow) {
            const ins = await db.insert(adoptionDocSettings).values({
                id: crypto.randomUUID(), ownerType: owner.ownerType, ownerId: owner.ownerId,
                contractVersionId: versionId, updatedAt: now, updatedBy: actorEmail,
            }).onConflictDoNothing().returning({ id: adoptionDocSettings.id });
            return ins.length > 0;
        }
        const upd = await db.update(adoptionDocSettings)
            .set({ contractVersionId: versionId, updatedAt: now, updatedBy: actorEmail })
            .where(and(ownerCond, expectedVersionId === null
                ? isNull(adoptionDocSettings.contractVersionId)
                : eq(adoptionDocSettings.contractVersionId, expectedVersionId as string)))
            .returning({ id: adoptionDocSettings.id });
        return upd.length > 0;
    };

    const plan = planContractSave(current ? { contentHash: current.contentHash } : null, nextHash);

    if (plan === 'noop') {
        return { action: 'noop', versionId: current?.id ?? null };
    }

    const now = nowSeconds();

    if (plan === 'setStandard') {
        // planContractSave only returns 'setStandard' when a current version exists.
        if (!(await pointTo(null, now))) return { action: 'noop', versionId: current!.id, raced: true };
        await db.update(contractVersions).set({ replacedAt: now }).where(eq(contractVersions.id, current!.id));
        await cleanupUnsignedVersions(db, owner, now);
        return { action: 'setStandard', versionId: null };
    }

    // insert
    const newId = crypto.randomUUID();
    await db.insert(contractVersions).values({
        id: newId,
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        sectionsJson: canonicalSectionsJson(normalized),
        contentHash: nextHash as string,
        createdAt: now,
        createdBy: actorEmail,
        firstSignedAt: null,
        replacedAt: null,
    });
    if (!(await pointTo(newId, now))) {
        // Lost the race: this version never became current. Mark it replaced
        // so the unsigned-version cleanup collects it.
        await db.update(contractVersions).set({ replacedAt: now }).where(eq(contractVersions.id, newId));
        return { action: 'noop', versionId: current?.id ?? null, raced: true };
    }
    if (current) {
        await db.update(contractVersions).set({ replacedAt: now }).where(eq(contractVersions.id, current.id));
    }
    await cleanupUnsignedVersions(db, owner, now);
    return { action: 'insert', versionId: newId };
}

/**
 * Records which contract text an adopter signed (spec §1.4). The version id
 * the client sent is always stored as given, but it only counts — content
 * hash recorded, first_signed_at stamped (which makes it undeletable) — when
 * it belongs to the animal's owner (`ownerEmail`, i.e. animal.addedBy): their
 * own version, or one of an org they're a member of. Anything else (unknown
 * id, someone else's version, a failed lookup) is warned about and stored
 * with content_hash NULL. The lookups never stop the row being written.
 */
export async function recordSignature(db: Db, row: {
    animalId: string;
    adopterId: string | null;
    contractVersionId: string | null;
    standardVersion: string | null;
    locale: string | null;
    fileKey: string | null;
    via: 'token' | 'open';
    /** animal.addedBy — whose version this may legitimately be. */
    ownerEmail: string | null;
    /** H1: what the adopter typed, the matches found and the placement opened — the contract result's home. */
    submitted?: Record<string, string> | null;
    matchCount?: number | null;
    placementId?: string | null;
}): Promise<string> {
    const now = nowSeconds();
    let contentHash: string | null = null;

    if (row.contractVersionId) {
        try {
            const versionRow = await getContractVersion(db, row.contractVersionId);
            if (!versionRow) {
                logger.warn('recordSignature: unknown contract version', {
                    animalId: row.animalId, contractVersionId: row.contractVersionId,
                });
            } else {
                const ownerOrgIds = versionRow.ownerType === 'org' && row.ownerEmail
                    ? await getMemberOrgIds(db, row.ownerEmail)
                    : [];
                if (isContractVersionOwnedBy(versionRow, row.ownerEmail, ownerOrgIds)) {
                    contentHash = versionRow.contentHash;
                    await db.update(contractVersions)
                        .set({ firstSignedAt: now })
                        .where(and(eq(contractVersions.id, versionRow.id), isNull(contractVersions.firstSignedAt)));
                } else {
                    logger.warn('recordSignature: contract version not owned by the animal owner', {
                        animalId: row.animalId, contractVersionId: row.contractVersionId,
                        versionOwnerType: versionRow.ownerType,
                    });
                }
            }
        } catch (e) {
            contentHash = null;
            logger.warn('recordSignature: version ownership lookup failed, storing without hash', {
                animalId: row.animalId, contractVersionId: row.contractVersionId,
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }

    const id = crypto.randomUUID();
    await db.insert(signedContracts).values({
        id,
        animalId: row.animalId,
        adopterId: row.adopterId,
        contractVersionId: row.contractVersionId,
        standardVersion: row.standardVersion,
        locale: row.locale,
        contentHash,
        fileKey: row.fileKey,
        via: row.via,
        signedAt: now,
        submittedJson: row.submitted ? JSON.stringify(row.submitted) : null,
        matchCount: row.matchCount ?? null,
        placementId: row.placementId ?? null,
    });
    return id;
}
