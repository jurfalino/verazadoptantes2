'use server';

/**
 * Group branding — server actions behind the «Personalizar» section of a
 * group card. Authorization + orchestration only: every read/write of the
 * branding columns goes through src/lib/groupBrandingRepo.ts, the rules live
 * in src/domain/groupBranding.ts. Any member may edit (same rule as renaming
 * a group). Spec: docs/superpowers/specs/2026-11-13-group-branding-design.md.
 *
 * IMPORTANT: a 'use server' file may only export async functions and types.
 */

import { getUser, getDb } from './_db';
import { getFeatureFlag } from '@/config/features';
import { logAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { getMemberOrgIds } from '@/lib/adoptionDocsRepo';
import { getOrgBranding, getOrgBrandingWithMeta, saveOrgBrandingFields, setOrgImageUrl } from '@/lib/groupBrandingRepo';
import { checkOrgImageDataUrl, storeOrgImageDataUrl } from '@/lib/r2';
import { displayNameOf } from '@/lib/collabAttribution';
import {
    sanitizeBrandingInput, ORG_IMAGE_KINDS,
    type BrandingFields, type BrandingInput, type OrgImageKind, type SocialKind,
} from '@/domain/groupBranding';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type GroupBrandingView = BrandingFields & {
    logoUrl: string | null; bannerUrl: string | null;
    updatedAt: number | null; updatedByName: string | null;
};

type Denied = { success: false; error: 'disabled' | 'forbidden' };

/** Flag on + the caller belongs to `orgId`; else the refusal to return. */
async function authorize(db: Db, actorEmail: string, orgId: unknown, op: string): Promise<Denied | null> {
    if (!(await getFeatureFlag('ENABLE_GROUP_BRANDING'))) return { success: false, error: 'disabled' };
    const orgIds = await getMemberOrgIds(db, actorEmail);
    if (typeof orgId !== 'string' || !orgIds.includes(orgId)) {
        logger.warn(`groupBranding.${op}: forbidden`, { actorEmail, orgId: String(orgId).slice(0, 64) });
        return { success: false, error: 'forbidden' };
    }
    return null;
}

/** Which of theme/accent/links a save actually changes (for the audit trail). */
function changedFields(before: BrandingFields, after: BrandingFields): string[] {
    const out: string[] = [];
    if (before.theme !== after.theme) out.push('theme');
    if (before.accentId !== after.accentId) out.push('accent');
    if (before.instagramUrl !== after.instagramUrl) out.push('instagram');
    if (before.facebookUrl !== after.facebookUrl) out.push('facebook');
    if (before.websiteUrl !== after.websiteUrl) out.push('website');
    return out;
}

/** The editor's data for one group: what is set now, and who changed it last. */
export async function getGroupBranding(orgId: string): Promise<{
    success: boolean; data?: GroupBrandingView; error?: 'disabled' | 'forbidden' | 'generic'; errorId?: string;
}> {
    let actorEmail: string | undefined;
    try {
        actorEmail = await getUser();
        const db = await getDb();
        if (!db) throw new Error('Database not available');

        const denied = await authorize(db, actorEmail, orgId, 'get');
        if (denied) return denied;

        const row = await getOrgBrandingWithMeta(db, orgId);
        if (!row) {
            logger.warn('groupBranding.get: group row missing', { actorEmail, orgId });
            return { success: false, error: 'forbidden' };
        }
        const updatedByName = row.updatedBy ? (await displayNameOf(db, row.updatedBy)) || null : null;
        return {
            success: true,
            data: {
                theme: row.theme, accentId: row.accentId,
                instagramUrl: row.instagramUrl, facebookUrl: row.facebookUrl, websiteUrl: row.websiteUrl,
                logoUrl: row.logoUrl, bannerUrl: row.bannerUrl,
                updatedAt: row.updatedAt ? Math.floor(row.updatedAt.getTime() / 1000) : null,
                updatedByName,
            },
        };
    } catch (e) {
        return { success: false, error: 'generic', errorId: logger.error('groupBranding.get failed', e, { actorEmail, orgId }) };
    }
}

/** Saves theme, accent and the social links. A bad value is refused with its field named, never stored. */
export async function saveGroupBranding(orgId: string, input: BrandingInput): Promise<{
    success: boolean; field?: 'theme' | 'accent' | SocialKind;
    error?: 'disabled' | 'forbidden' | 'invalid' | 'generic'; errorId?: string;
}> {
    let actorEmail: string | undefined;
    try {
        actorEmail = await getUser();
        const db = await getDb();
        if (!db) throw new Error('Database not available');

        const denied = await authorize(db, actorEmail, orgId, 'save');
        if (denied) return denied;

        const sanitized = sanitizeBrandingInput(input);
        if (!sanitized.ok) {
            logger.warn('groupBranding.save: invalid input', { actorEmail, orgId, field: sanitized.field });
            return { success: false, error: 'invalid', field: sanitized.field };
        }

        const before = await getOrgBranding(db, orgId);
        if (!before) {
            logger.warn('groupBranding.save: group row missing', { actorEmail, orgId });
            return { success: false, error: 'forbidden' };
        }
        const fields = changedFields(before, sanitized.value);
        if (!fields.length) return { success: true };

        await saveOrgBrandingFields(db, orgId, sanitized.value, actorEmail);
        await logAudit({ userEmail: actorEmail, action: 'group_branding_changed', target: orgId, details: { orgId, fields } });
        return { success: true };
    } catch (e) {
        return { success: false, error: 'generic', errorId: logger.error('groupBranding.save failed', e, { actorEmail, orgId }) };
    }
}

/** Uploads (data URL, resized in the browser) or removes (null) the group's logo or banner. */
export async function setGroupImage(orgId: string, kind: OrgImageKind, dataUrl: string | null): Promise<{
    success: boolean; url?: string | null; error?: 'disabled' | 'forbidden' | 'invalid' | 'generic'; errorId?: string;
}> {
    let actorEmail: string | undefined;
    try {
        actorEmail = await getUser();
        const db = await getDb();
        if (!db) throw new Error('Database not available');

        // Membership before anything touches the bucket: orgId is the client's and ends up in a public key.
        const denied = await authorize(db, actorEmail, orgId, 'setImage');
        if (denied) return denied;

        if (!(ORG_IMAGE_KINDS as readonly string[]).includes(kind)) {
            logger.warn('groupBranding.setImage: invalid kind', { actorEmail, orgId, kind: String(kind).slice(0, 16) });
            return { success: false, error: 'invalid' };
        }

        let url: string | null = null;
        if (dataUrl !== null) {
            const check = checkOrgImageDataUrl(dataUrl);
            if (!check.ok) {
                logger.warn('groupBranding.setImage: image refused', {
                    actorEmail, orgId, kind, reason: check.reason, size: typeof dataUrl === 'string' ? dataUrl.length : null,
                });
                return { success: false, error: 'invalid' };
            }
            url = await storeOrgImageDataUrl(dataUrl, orgId, kind);
            if (!url) {
                return { success: false, error: 'generic', errorId: logger.error('groupBranding.setImage: R2 upload failed', new Error('R2 upload failed'), { actorEmail, orgId, kind }) };
            }
        }

        await setOrgImageUrl(db, orgId, kind, url, actorEmail);
        await logAudit({ userEmail: actorEmail, action: 'group_branding_changed', target: orgId, details: { orgId, fields: [kind] } });
        return { success: true, url };
    } catch (e) {
        return { success: false, error: 'generic', errorId: logger.error('groupBranding.setImage failed', e, { actorEmail, orgId, kind }) };
    }
}
