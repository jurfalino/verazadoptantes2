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

import { and, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { adoptionDocSettings, contractVersions, signedContracts, userProfiles, users, orgMembers } from '@/db/schema';
import { getDb } from '@/lib/db';
import { getFeatureFlag } from '@/config/features';
import { logger } from '@/lib/logger';
import {
    normalizeEmail, resolveDocsOwner, parseDocsSource,
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

export async function getUserDocsSource(db: Db, email: string): Promise<DocsSource> {
    const normalized = normalizeEmail(email);
    const row = await db.select({ adoptionDocsSource: userProfiles.adoptionDocsSource })
        .from(userProfiles)
        .innerJoin(users, eq(users.id, userProfiles.userId))
        .where(sql`lower(${users.email}) = ${normalized}`)
        .get();
    return parseDocsSource(row?.adoptionDocsSource ?? null);
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
export async function resolveDocsForRescuer(db: Db, rescuerEmail: string | null | undefined): Promise<ResolvedDocs | null> {
    const email = rescuerEmail?.trim();
    if (!email || email === 'anonymous') return null;

    try {
        if (!(await getFeatureFlag('ENABLE_CUSTOM_ADOPTION_DOCS'))) return null;

        const owner = resolveDocsOwner(email, await getUserDocsSource(db, email), await getMemberOrgIds(db, email));
        const settingsRow = await getSettingsRow(db, owner);
        if (!settingsRow) return null;

        const hiddenSteps: string[] = settingsRow.hiddenSteps ? JSON.parse(settingsRow.hiddenSteps) : [];
        if (!hiddenSteps.length && !settingsRow.contractVersionId) return null;

        let contract: ResolvedDocs['contract'] = null;
        if (settingsRow.contractVersionId) {
            const versionRow = await getContractVersion(db, settingsRow.contractVersionId);
            if (!versionRow) {
                logger.warn('resolveDocsForRescuer: contract version missing', {
                    rescuerEmail: email, contractVersionId: settingsRow.contractVersionId,
                });
            } else {
                const parsed = contractSectionsSchema.safeParse(JSON.parse(versionRow.sectionsJson));
                if (!parsed.success) {
                    logger.warn('resolveDocsForRescuer: invalid contract sections', {
                        rescuerEmail: email, contractVersionId: versionRow.id,
                        issues: parsed.error.issues.map(i => i.path.join('.')),
                    });
                } else {
                    contract = { versionId: versionRow.id, sections: parsed.data };
                }
            }
        }

        return { hiddenSteps, contract };
    } catch (error) {
        logger.warn('resolveDocsForRescuer: fell back to standard', {
            rescuerEmail: email, error: error instanceof Error ? error.message : String(error),
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

async function cleanupUnsignedVersions(db: Db, owner: DocsOwner, now: number): Promise<void> {
    await db.delete(contractVersions).where(and(
        eq(contractVersions.ownerType, owner.ownerType),
        eq(contractVersions.ownerId, owner.ownerId),
        isNull(contractVersions.firstSignedAt),
        isNotNull(contractVersions.replacedAt),
        lt(contractVersions.replacedAt, now - UNSIGNED_VERSION_TTL_SECONDS),
    ));
}

export async function saveContract(
    db: Db, owner: DocsOwner, sections: ContractSections, actorEmail: string,
): Promise<{ action: 'noop' | 'setStandard' | 'insert'; versionId: string | null }> {
    const normalized = normalizeSections(sections);
    const nextHash = isStandardSections(normalized) ? null : await sha256Hex(canonicalSectionsJson(normalized));

    const settingsRow = await getSettingsRow(db, owner);
    const current = settingsRow?.contractVersionId ? await getContractVersion(db, settingsRow.contractVersionId) : null;

    const plan = planContractSave(current ? { contentHash: current.contentHash } : null, nextHash);

    if (plan === 'noop') {
        return { action: 'noop', versionId: current?.id ?? null };
    }

    const now = nowSeconds();

    if (plan === 'setStandard') {
        // planContractSave only returns 'setStandard' when a current version exists.
        await db.update(contractVersions).set({ replacedAt: now }).where(eq(contractVersions.id, current!.id));
        await db.insert(adoptionDocSettings).values({
            id: crypto.randomUUID(),
            ownerType: owner.ownerType,
            ownerId: owner.ownerId,
            contractVersionId: null,
            updatedAt: now,
            updatedBy: actorEmail,
        }).onConflictDoUpdate({
            target: [adoptionDocSettings.ownerType, adoptionDocSettings.ownerId],
            set: { contractVersionId: null, updatedAt: now, updatedBy: actorEmail },
        });
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
    if (current) {
        await db.update(contractVersions).set({ replacedAt: now }).where(eq(contractVersions.id, current.id));
    }
    await db.insert(adoptionDocSettings).values({
        id: crypto.randomUUID(),
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        contractVersionId: newId,
        updatedAt: now,
        updatedBy: actorEmail,
    }).onConflictDoUpdate({
        target: [adoptionDocSettings.ownerType, adoptionDocSettings.ownerId],
        set: { contractVersionId: newId, updatedAt: now, updatedBy: actorEmail },
    });
    await cleanupUnsignedVersions(db, owner, now);
    return { action: 'insert', versionId: newId };
}

export async function recordSignature(db: Db, row: {
    animalId: string;
    adopterId: string | null;
    contractVersionId: string | null;
    standardVersion: string | null;
    locale: string | null;
    fileKey: string | null;
    via: 'token' | 'open';
}): Promise<void> {
    const now = nowSeconds();
    let contentHash: string | null = null;

    if (row.contractVersionId) {
        const versionRow = await getContractVersion(db, row.contractVersionId);
        if (versionRow) {
            contentHash = versionRow.contentHash;
            await db.update(contractVersions)
                .set({ firstSignedAt: now })
                .where(and(eq(contractVersions.id, versionRow.id), isNull(contractVersions.firstSignedAt)));
        } else {
            logger.warn('recordSignature: unknown contract version', {
                animalId: row.animalId, contractVersionId: row.contractVersionId,
            });
        }
    }

    await db.insert(signedContracts).values({
        id: crypto.randomUUID(),
        animalId: row.animalId,
        adopterId: row.adopterId,
        contractVersionId: row.contractVersionId,
        standardVersion: row.standardVersion,
        locale: row.locale,
        contentHash,
        fileKey: row.fileKey,
        via: row.via,
        signedAt: now,
    });
}
