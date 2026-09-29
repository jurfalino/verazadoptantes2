/**
 * Activity-feed action names + visibility rule for the custom adoption docs
 * feature (Task 5).
 *
 * Deliberately split out of src/domain/adoptionDocs.ts, which builds zod
 * schemas (richDocSchema, contractSectionsSchema) at module scope — those
 * are side effects a bundler can't tree-shake away, so importing even one
 * constant from adoptionDocs.ts drags all of zod into whatever bundle does
 * the importing. OrgActivityFeed.tsx is a client component; this module has
 * zero imports so it can never do that. Server-only consumers (the
 * adoptionDocs.ts / activity.ts server actions) also import from here
 * directly rather than via adoptionDocs.ts, so nothing outside this file
 * needs to remember which module is "the safe one" to import.
 */

export const ADOPTION_DOCS_FORM_SAVED = 'adoption_docs_form_saved';
export const ADOPTION_DOCS_CONTRACT_SAVED = 'adoption_docs_contract_saved';
export const ADOPTION_DOCS_ACTIVITY_ACTIONS = [ADOPTION_DOCS_FORM_SAVED, ADOPTION_DOCS_CONTRACT_SAVED] as const;

/**
 * adoption_docs_form_saved / adoption_docs_contract_saved rows carry org
 * context in `details.orgId`, not in `target`+adopter lookup like every
 * other activity row. The org-collab feed must show them only to members of
 * that org — a self edit (no orgId) is private, and so is an edit of an org
 * the viewer has since left (spec Review Focus #4: membership can lapse).
 * Every other action is unaffected — this is an opt-in gate, not a filter.
 */
export function isDocsActivityVisible(
    action: string,
    details: Record<string, unknown>,
    viewerOrgIds: readonly string[],
): boolean {
    if (!(ADOPTION_DOCS_ACTIVITY_ACTIONS as readonly string[]).includes(action)) return true;
    const orgId = details.orgId;
    return typeof orgId === 'string' && orgId.length > 0 && viewerOrgIds.includes(orgId);
}
