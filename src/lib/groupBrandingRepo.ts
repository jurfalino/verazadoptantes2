/**
 * Group branding — repository and public-resolution helpers.
 *
 * The only module that reads/writes the organizations branding columns
 * (logo_url … branding_updated_by). Public routes resolve what a page should
 * look like with `resolveBrandingForRescuer` / `resolveBrandingForOrgSlug`,
 * which never throw: any failure means today's look (null), logged as warn.
 * Server actions (src/app/actions/groupBranding.ts) call the read/write helpers.
 *
 * Spec: docs/superpowers/specs/2026-11-13-group-branding-design.md.
 */

import { eq } from 'drizzle-orm';
import { organizations } from '@/db/schema';
import { getDb } from '@/lib/db';
import { getFeatureFlag } from '@/config/features';
import { logger } from '@/lib/logger';
import { maskEmail } from '@/lib/dates';
import { getEffectiveDocsSource } from '@/lib/adoptionDocsRepo';
import { normalizeEmail } from '@/domain/adoptionDocs';
import {
    brandingFromOrgRow, hasBranding, pickBrandingOrgId,
    type BrandingFields, type OrgImageKind, type PublicBranding,
} from '@/domain/groupBranding';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

const brandingColumns = {
    name: organizations.name,
    slug: organizations.slug,
    logoUrl: organizations.logoUrl,
    bannerUrl: organizations.bannerUrl,
    brandTheme: organizations.brandTheme,
    brandAccent: organizations.brandAccent,
    instagramUrl: organizations.instagramUrl,
    facebookUrl: organizations.facebookUrl,
    websiteUrl: organizations.websiteUrl,
};

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The group's branding as stored (defaults for NULL), or null when the group doesn't exist. Throws on a DB error. */
export async function getOrgBranding(db: Db, orgId: string): Promise<PublicBranding | null> {
    const row = await db.select(brandingColumns).from(organizations).where(eq(organizations.id, orgId)).get();
    return row ? brandingFromOrgRow(row) : null;
}

/** Branding plus who changed it last (for the dashboard editor). Throws on a DB error. */
export async function getOrgBrandingWithMeta(db: Db, orgId: string): Promise<
    (PublicBranding & { updatedAt: Date | null; updatedBy: string | null }) | null
> {
    const row = await db.select({
        ...brandingColumns,
        updatedAt: organizations.brandingUpdatedAt,
        updatedBy: organizations.brandingUpdatedBy,
    }).from(organizations).where(eq(organizations.id, orgId)).get();
    if (!row) return null;
    return { ...brandingFromOrgRow(row), updatedAt: row.updatedAt ?? null, updatedBy: row.updatedBy ?? null };
}

async function findOrgIdBySlug(db: Db, slug: string): Promise<string | null> {
    const row = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug)).get();
    return row?.id ?? null;
}

/**
 * The branding a rescuer's public page carries: the `hintOrgSlug` group if the
 * rescuer belongs to it (a forged hint is ignored), else their effective
 * «Al compartir, usar:» group. Null for flag off, no group, «Los míos», a group
 * with nothing set, or any error — never throws.
 */
export async function resolveBrandingForRescuer(
    db: Db, rescuerEmail: string | null | undefined, hintOrgSlug?: string | null,
): Promise<PublicBranding | null> {
    const email = rescuerEmail?.trim();
    if (!email || email === 'anonymous') return null;
    // Public, unauthenticated routes: never log the rescuer's full email.
    const who = maskEmail(normalizeEmail(email));
    const hint = hintOrgSlug?.trim() || null;
    try {
        if (!(await getFeatureFlag('ENABLE_GROUP_BRANDING'))) return null;
        const [{ source, memberOrgIds }, hintOrgId] = await Promise.all([
            getEffectiveDocsSource(db, email),
            hint ? findOrgIdBySlug(db, hint.slice(0, 120)) : Promise.resolve(null),
        ]);
        const orgId = pickBrandingOrgId({ hintOrgId, memberOrgIds, source });
        if (!orgId) return null;
        const branding = await getOrgBranding(db, orgId);
        return branding && hasBranding(branding) ? branding : null;
    } catch (e) {
        logger.warn('resolveBrandingForRescuer: fell back to no branding', {
            rescuer: who, hintOrgSlug: hint?.slice(0, 120) ?? null, error: errorMessage(e),
        });
        return null;
    }
}

/** A group catalogue's branding (regardless of its members' choices). Null for flag off, unknown slug, nothing set, or any error. */
export async function resolveBrandingForOrgSlug(db: Db, slug: string): Promise<PublicBranding | null> {
    const s = slug?.trim();
    if (!s) return null;
    try {
        if (!(await getFeatureFlag('ENABLE_GROUP_BRANDING'))) return null;
        const row = await db.select(brandingColumns).from(organizations).where(eq(organizations.slug, s)).get();
        if (!row) return null;
        const branding = brandingFromOrgRow(row);
        return hasBranding(branding) ? branding : null;
    } catch (e) {
        logger.warn('resolveBrandingForOrgSlug: fell back to no branding', { slug: s.slice(0, 120), error: errorMessage(e) });
        return null;
    }
}

/** Writes theme, accent and links (already sanitized) and stamps who/when. */
export async function saveOrgBrandingFields(db: Db, orgId: string, fields: BrandingFields, actorEmail: string): Promise<void> {
    await db.update(organizations).set({
        brandTheme: fields.theme,
        brandAccent: fields.accentId,
        instagramUrl: fields.instagramUrl,
        facebookUrl: fields.facebookUrl,
        websiteUrl: fields.websiteUrl,
        brandingUpdatedAt: new Date(),
        brandingUpdatedBy: actorEmail,
    }).where(eq(organizations.id, orgId));
}

/** Points the logo or banner at `url` (null removes it) and stamps who/when. */
export async function setOrgImageUrl(db: Db, orgId: string, kind: OrgImageKind, url: string | null, actorEmail: string): Promise<void> {
    const column = kind === 'logo' ? { logoUrl: url } : { bannerUrl: url };
    await db.update(organizations).set({
        ...column,
        brandingUpdatedAt: new Date(),
        brandingUpdatedBy: actorEmail,
    }).where(eq(organizations.id, orgId));
}
