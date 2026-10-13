/**
 * Where a profile or an activity came from, for the small origin tag on the
 * profile and in Mis Adoptantes (ENABLE_ORIGIN_LABELS). Pure.
 *
 * Profiles carry it (`adopters.source`). Activities don't have a column: an API
 * one is known from its call (api_requests.record_id → the key's name), a form
 * request from its `source_url` ("form:<id>"), a signed adoption from its
 * contract. Anything else was typed by a rescuer and gets no tag.
 */
export type OriginKind = 'imported' | 'form' | 'contract' | 'api';
export interface Origin { kind: OriginKind; tool?: string | null }

const PROFILE_SOURCES: Record<string, OriginKind | undefined> = { imported: 'imported', form: 'form', contract: 'contract', api: 'api' };

/** A profile's origin; null for one created by hand ('manual'). */
export function profileOrigin(source: string | null | undefined, apiTool?: string | null): Origin | null {
    const kind = PROFILE_SOURCES[source ?? ''];
    if (!kind) return null;
    return kind === 'api' ? { kind, tool: apiTool ?? null } : { kind };
}

/** An activity's origin; null for one a rescuer recorded by hand. */
export function activityOrigin(r: { apiTool?: string | null; sourceUrl?: string | null; hasContract?: number | boolean | null }): Origin | null {
    if (r.apiTool) return { kind: 'api', tool: r.apiTool };
    if (r.sourceUrl?.startsWith('form:')) return { kind: 'form' };
    if (r.hasContract === 1 || r.hasContract === true) return { kind: 'contract' };
    return null;
}

/** The API tool that created a profile, from its history ("api:<key name>" on the creation row). */
export function apiToolFromHistory(history: Array<{ changedBy?: string | null; changes?: string | null }>): string | null {
    const row = history.find(h => (h.changedBy ?? '').startsWith('api:') && (h.changes ?? '').includes('created_via_api'));
    return row ? row.changedBy!.slice(4) || null : null;
}
