/**
 * Org-membership helpers used by the v2.18.11 org-collab feature set.
 *
 * One mental model: the org is the trust boundary. Two members of the same
 * org are "org-mates" for every gating purpose — PII visibility, edit gates,
 * audit-log visibility, owner notifications. Outside the org, the
 * strangers-by-default posture is preserved.
 *
 * All helpers fail open returning empty/false on DB errors so a transient
 * D1 hiccup doesn't lock collaborators out of teammate profiles. The audit
 * log + notification system is the trust-but-verify backstop.
 */

import { eq } from 'drizzle-orm';
import { organizations, orgMembers } from '@/db/schema';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';

export interface OrgRef {
    id: string;
    name: string;
    slug: string | null;
}

const normEmail = (e: string | null | undefined): string =>
    (e ?? '').toLowerCase().trim();

/**
 * True iff `viewerEmail` and `ownerEmail` share at least one organization.
 * Returns false for empty / equal emails (equality is checked at the caller —
 * owner==viewer is `isOwner`, not `isOrgMate`).
 *
 * Two queries: viewer's orgs, then existence check on (orgs ∩ owner's orgs).
 * Sized to drop straight through D1's read replica; never fetches member
 * lists.
 */
export async function isOrgMate(
    viewerEmail: string | null | undefined,
    ownerEmail: string | null | undefined,
): Promise<boolean> {
    const v = normEmail(viewerEmail);
    const o = normEmail(ownerEmail);
    if (!v || !o || v === o) return false;
    try {
        const db = await getDb();
        if (!db) return false;

        const viewerOrgs = await db.select({ orgId: orgMembers.orgId })
            .from(orgMembers)
            .where(eq(orgMembers.userEmail, v));
        if (viewerOrgs.length === 0) return false;

        const orgIds = viewerOrgs.map((r: { orgId: string }) => r.orgId);
        // inArray is documented-broken on D1 for large arrays (see
        // docs/D1_COMPATIBILITY.md). Most users belong to <5 orgs in
        // practice, so we loop — Promise.all keeps the cost flat.
        const hits = await Promise.all(orgIds.map((orgId: string) =>
            db.select({ userEmail: orgMembers.userEmail })
                .from(orgMembers)
                .where(eq(orgMembers.orgId, orgId))
                .all()
                .then((rows: { userEmail: string }[]) =>
                    rows.some(r => normEmail(r.userEmail) === o))
        ));
        return hits.some(Boolean);
    } catch (e) {
        logger.warn('isOrgMate failed — failing closed (treated as stranger)', {
            viewer: v, owner: o,
            error: e instanceof Error ? e.message : String(e),
        });
        return false;
    }
}

/**
 * Returns every org the email belongs to. Sorted by joinedAt ASC so the
 * "earliest org" is first (used as the attribution fallback when there's
 * no shared org with the viewer).
 */
export async function getOrgsForEmail(email: string | null | undefined): Promise<OrgRef[]> {
    const e = normEmail(email);
    if (!e) return [];
    try {
        const db = await getDb();
        if (!db) return [];

        const memberRows = await db.select({
            orgId: orgMembers.orgId,
            joinedAt: orgMembers.joinedAt,
        }).from(orgMembers)
            .where(eq(orgMembers.userEmail, e));
        if (memberRows.length === 0) return [];

        const ordered = [...memberRows].sort((a, b) => {
            const av = a.joinedAt ? new Date(a.joinedAt).getTime() : 0;
            const bv = b.joinedAt ? new Date(b.joinedAt).getTime() : 0;
            return av - bv;
        });
        const orgs = await Promise.all(ordered.map((r: { orgId: string }) =>
            db.select({ id: organizations.id, name: organizations.name, slug: organizations.slug })
                .from(organizations).where(eq(organizations.id, r.orgId)).get()
        ));
        return orgs.filter((o): o is OrgRef => !!o);
    } catch (e2) {
        logger.warn('getOrgsForEmail failed', {
            email: e,
            error: e2 instanceof Error ? e2.message : String(e2),
        });
        return [];
    }
}

/**
 * Every OTHER user who shares at least one org with `email`, paired with the
 * orgs through which they're related (so the owner's "who has access" UI can
 * say "via {orgName}" alongside each name).
 *
 * Two queries: the email's orgs, then the member list of each. The owner is
 * filtered out of the result; remaining members are deduped by email,
 * accumulating every shared org. Fails open returning `[]` so a transient
 * D1 hiccup doesn't blank out the org-mate list on the disclosure (the audit
 * log is the backstop).
 */
export async function getOrgMatesOf(
    email: string | null | undefined,
): Promise<Array<{ email: string; orgs: OrgRef[] }>> {
    const e = normEmail(email);
    if (!e) return [];
    try {
        const orgs = await getOrgsForEmail(e);
        if (orgs.length === 0) return [];

        const db = await getDb();
        if (!db) return [];

        const orgMemberRows = await Promise.all(orgs.map(o =>
            db.select({ userEmail: orgMembers.userEmail })
                .from(orgMembers)
                .where(eq(orgMembers.orgId, o.id))
                .all()
                .then((rows: { userEmail: string }[]) => ({ org: o, rows }))
        ));

        const byEmail = new Map<string, { email: string; orgs: OrgRef[] }>();
        for (const { org, rows } of orgMemberRows) {
            for (const r of rows) {
                const mateEmail = normEmail(r.userEmail);
                if (!mateEmail || mateEmail === e) continue;
                const existing = byEmail.get(mateEmail);
                if (existing) {
                    if (!existing.orgs.some(o => o.id === org.id)) existing.orgs.push(org);
                } else {
                    byEmail.set(mateEmail, { email: mateEmail, orgs: [org] });
                }
            }
        }
        return [...byEmail.values()];
    } catch (e2) {
        logger.warn('getOrgMatesOf failed', {
            email: e,
            error: e2 instanceof Error ? e2.message : String(e2),
        });
        return [];
    }
}

/**
 * Pick the most informative org to attribute the creator with, given a
 * specific viewer. Preference order:
 *   1. The earliest org the viewer and creator share (most relevant context)
 *   2. The creator's earliest org (fallback — at least says where they're from)
 *   3. null (creator has no orgs)
 *
 * The viewer's own membership filter matters: showing "Created by X from Org Y"
 * to a viewer who's also in Org Y feels like "ah, my teammate"; showing the
 * same to someone who isn't in Y is just informational.
 */
export async function pickAttributionOrg(
    creatorEmail: string | null | undefined,
    viewerEmail: string | null | undefined,
): Promise<OrgRef | null> {
    const creator = normEmail(creatorEmail);
    if (!creator) return null;
    try {
        const [creatorOrgs, viewerOrgs] = await Promise.all([
            getOrgsForEmail(creator),
            viewerEmail ? getOrgsForEmail(viewerEmail) : Promise.resolve([] as OrgRef[]),
        ]);
        if (creatorOrgs.length === 0) return null;
        const viewerSet = new Set(viewerOrgs.map(o => o.id));
        const shared = creatorOrgs.find(o => viewerSet.has(o.id));
        return shared ?? creatorOrgs[0];
    } catch (e) {
        logger.warn('pickAttributionOrg failed', {
            creator, viewer: normEmail(viewerEmail),
            error: e instanceof Error ? e.message : String(e),
        });
        return null;
    }
}

/**
 * v2.55.18 (animal-timeline PR5): animals are TEAM resources — org members get
 * full parity with the owner (read AND write, including destructive ops; the
 * always-visible attribution is the accountability counterweight). Convenience
 * predicate for the animal gates: owner or org-mate. Admin is checked by the
 * callers that already do.
 */
export async function isOwnerOrOrgMate(
    viewerEmail: string | null | undefined,
    ownerEmail: string | null | undefined,
): Promise<boolean> {
    const v = normEmail(viewerEmail);
    const o = normEmail(ownerEmail);
    if (!v || !o) return false;
    if (v === o) return true;
    return isOrgMate(v, o);
}

/**
 * v2.55.18: the emails whose animals the viewer can see — self + every
 * org-mate (deduped, capped defensively; orgs are small in practice). Fails
 * open to [self] so a transient D1 hiccup degrades to solo visibility, never
 * to a broken page.
 */
export async function getTeamEmails(email: string | null | undefined): Promise<string[]> {
    const e = normEmail(email);
    if (!e) return [];
    try {
        const mates = await getOrgMatesOf(e);
        return [e, ...mates.map(m => m.email)].slice(0, 30);
    } catch (err) {
        logger.warn('getTeamEmails failed — solo visibility fallback', {
            email: e, error: err instanceof Error ? err.message : String(err),
        });
        return [e];
    }
}
