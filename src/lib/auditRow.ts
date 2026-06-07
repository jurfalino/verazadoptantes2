/**
 * Shared audit-row derivation helpers (v2.19.5).
 *
 * Two surfaces read the same `audit_log` shape with different visual
 * treatments: `OrgActivityFeed` (members-of-my-org, sentence cards on
 * `/organizations`) and `/admin/audit` (every event, diagnostic rows for
 * admins). Their renderers diverge but the *data derivations* — what's the
 * severity tint? what's the inline diff summary? what's the human-readable
 * "what happened" string? — should never drift. This module is that single
 * source of truth.
 *
 * Pure functions only. No React, no DB. Both server and client consumers
 * import freely.
 */

export type AuditSeverity = 'rose' | 'amber' | 'emerald' | 'stone';

export interface AuditFieldSummary {
    /** First 1–2 changed field names (camelCase keys; render via fieldLabel). */
    primary: string[];
    /** Number of additional changed fields beyond the primary list. */
    extraCount: number;
}

/**
 * Compact "what happened" payload for a row. The client renderer joins
 * this with the actor/adopter resolution to build sentence-style rows.
 *
 * `primary` is the headline ("buscó", "abrió perfil", "editó …"); `secondary`
 * is the inline detail surfaced next to it (the search query, the
 * comma-joined field list, the flag reason). `tone` defaults to neutral;
 * `accent` lets us spotlight one short phrase in a contrasting color
 * (e.g. the flag reason in rose).
 */
export interface AuditSummary {
    primary: string;
    secondary?: string;
    accent?: { text: string; tone: 'rose' | 'amber' | 'emerald' | 'teal' | 'stone' };
}

/** Field keys whose value is a 1–5 rating; status delta drives severity. */
const STATUS_FIELDS = new Set(['status', 'rating', 'avgRating']);

export function parseDetails(raw: string | null | undefined): Record<string, unknown> {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {};
    } catch {
        return {};
    }
}

/**
 * Derives the row's severity tint from `(action, details)`. Matches the
 * v2.18.14 OrgActivityFeed behavior; one extra case (`adopter_deleted_admin`)
 * to keep admin-purge events visually consistent with regular soft-deletes.
 *
 * Status-downgrade-to-1-or-2 → rose; to 3 → amber; to 4+ → emerald.
 * Drift between sites is prevented by this being the single derivation point.
 */
export function deriveSeverity(action: string, details: Record<string, unknown>): AuditSeverity {
    if (action === 'flag_created' || action === 'adopter_deleted') return 'rose';
    if (action === 'adopter_deletion_requested') return 'amber';
    if (action === 'verification_added') return 'emerald';
    if (action === 'pii_access_denied') return 'rose';
    if (action === 'pii_access_approved' || action === 'pii_access_grant_revoked') return 'emerald';

    if (action === 'adopter_updated') {
        // details payload may be the changes blob directly OR nested under
        // a `changes` key — handle both since logAudit shapes have drifted.
        const changes = (details.changes as Record<string, unknown>) ?? details;
        for (const field of STATUS_FIELDS) {
            const delta = changes?.[field] as { from?: unknown; to?: unknown } | undefined;
            if (delta && typeof delta === 'object' && 'to' in delta) {
                const to = Number(delta.to);
                if (!Number.isFinite(to)) continue;
                if (to <= 2) return 'rose';
                if (to === 3) return 'amber';
                if (to >= 4) return 'emerald';
            }
        }
    }
    return 'stone';
}

/**
 * For `adopter_updated` (and `adoption_updated`), returns the first 1–2
 * changed field keys + a count of the rest, so the renderer can build a
 * "status, familyMembers · +1 campo más" line without re-parsing details
 * client-side.
 *
 * Returns null when the action isn't an edit, or the details JSON lacks
 * a proper {from,to} shape (defensive: not every old audit row conforms).
 */
export function deriveFieldSummary(action: string, details: Record<string, unknown>): AuditFieldSummary | null {
    if (action !== 'adopter_updated' && action !== 'adoption_updated') return null;
    const changes = (details.changes as Record<string, unknown>) ?? details;
    if (!changes || typeof changes !== 'object') return null;
    const keys = Object.keys(changes).filter(k => {
        const v = (changes as Record<string, unknown>)[k];
        return v && typeof v === 'object' && ('from' in (v as object) || 'to' in (v as object));
    });
    if (keys.length === 0) return null;
    return {
        primary: keys.slice(0, 2),
        extraCount: Math.max(0, keys.length - 2),
    };
}

/**
 * Friendly label for a field key in an `adopter_updated` diff. Falls back to
 * the raw key when we don't have a translation — better to show "addedBy"
 * than nothing. Limited to the fields that actually surface on the profile
 * form; unknown fields fall through.
 */
export function fieldLabel(key: string, isEs: boolean): string {
    const ES: Record<string, string> = {
        name: 'nombre',
        status: 'rating',
        familyMembers: 'integrantes',
        contactInfo: 'contacto',
        addressInfo: 'dirección',
        country: 'país',
        notes: 'notas',
        source: 'fuente',
        sourceUrl: 'URL fuente',
        animalName: 'animal',
        species: 'especie',
        rating: 'rating',
        details: 'detalles',
        date: 'fecha',
        deliveredToHome: 'entrega a domicilio',
        verifiedAddress: 'dirección verificada',
        identityVerified: 'identidad verificada',
        addedBy: 'creador',
        isPublic: 'público',
    };
    const EN: Record<string, string> = {
        name: 'name',
        status: 'rating',
        familyMembers: 'family',
        contactInfo: 'contact',
        addressInfo: 'address',
        country: 'country',
        notes: 'notes',
        source: 'source',
        sourceUrl: 'source URL',
        animalName: 'animal',
        species: 'species',
        rating: 'rating',
        details: 'details',
        date: 'date',
        deliveredToHome: 'delivered home',
        verifiedAddress: 'verified address',
        identityVerified: 'verified id',
        addedBy: 'creator',
        isPublic: 'public',
    };
    return (isEs ? ES : EN)[key] ?? key;
}

/**
 * Categories surfaced as quick-filter chips on `/admin/audit`. Subset is
 * deliberately narrower than the column dropdown — the chips are the
 * "common cuts an admin wants in 2 clicks." 'all' means no filter.
 *
 * `viewsOnly` exists because profile_viewed defaults to hidden in the UI
 * (high volume); selecting the Vistas chip is the explicit opt-in.
 */
export type AuditCategory =
    | 'all'
    | 'edits'
    | 'searches'
    | 'views'
    | 'flags'
    | 'deletions'
    | 'pii'
    | 'auth'
    | 'admin_ops';

export const CATEGORY_ACTIONS: Record<AuditCategory, string[] | null> = {
    all: null, // means: no action filter; profile_viewed still hidden by default
    edits: [
        'adopter_updated', 'adopter_appended',
        'adoption_updated', 'adoption_created',
        'contact_entry_added', 'contact_entry_updated', 'contact_entry_removed',
    ],
    searches: ['search'],
    views: ['profile_viewed'],
    flags: ['flag_created'],
    deletions: [
        'adopter_deleted', 'adopter_deletion_requested',
        'adoption_deleted',
        'animal_for_adoption_deleted', 'animal_image_deleted',
    ],
    pii: [
        'pii_access_requested', 'pii_access_approved', 'pii_access_denied',
        'pii_access_grant_revoked', 'pii_known_info_unlocked',
        'pii_search_match_grant',
    ],
    auth: ['sign_in', 'sign_out'],
    admin_ops: [
        'config_changed', 'admin_sql_query',
        'adopter_country_backfilled', 'contact_entries_backfilled',
        'adopter_made_public', 'adopter_made_private',
        'adopter_ownership_transferred',
    ],
};

/**
 * Derive the row's headline phrase + optional inline secondary from a raw
 * audit_log shape. Used server-side by /admin/audit's enrichment route to
 * pre-compute a renderable summary so the client renderer stays dumb.
 *
 * Adopter name is NOT included here — the caller (which has the lookup)
 * concatenates the resolved name where {adopter} appears in the primary.
 */
export function deriveSummary(
    action: string,
    details: Record<string, unknown>,
    target: string | null,
    isEs: boolean,
): AuditSummary {
    const _t = isEs;

    switch (action) {
        case 'sign_in':
            return { primary: _t ? 'inició sesión' : 'signed in' };
        case 'sign_out':
            return { primary: _t ? 'cerró sesión' : 'signed out' };

        case 'search': {
            const q = String(details.query ?? '').trim();
            const n = Number(details.resultCount ?? NaN);
            const secondaryParts: string[] = [];
            if (Number.isFinite(n)) {
                secondaryParts.push(`${n} ${_t ? (n === 1 ? 'resultado' : 'resultados') : (n === 1 ? 'result' : 'results')}`);
            }
            return {
                primary: _t ? 'buscó' : 'searched',
                accent: q ? { text: `“${q}”`, tone: 'teal' } : undefined,
                secondary: secondaryParts.join(' · ') || undefined,
            };
        }

        case 'profile_viewed':
            return { primary: _t ? 'abrió perfil' : 'opened profile' };

        case 'adopter_created':
            return { primary: _t ? 'creó perfil' : 'created profile' };

        case 'adopter_updated': {
            const fs = deriveFieldSummary(action, details);
            if (!fs) return { primary: _t ? 'editó perfil' : 'edited profile' };
            const labels = fs.primary.map(k => fieldLabel(k, _t)).join(', ');
            const tail = fs.extraCount > 0
                ? ` · +${fs.extraCount} ${_t ? (fs.extraCount === 1 ? 'campo más' : 'campos más') : (fs.extraCount === 1 ? 'more field' : 'more fields')}`
                : '';
            return {
                primary: _t ? 'editó perfil' : 'edited profile',
                secondary: `${labels}${tail}`,
            };
        }

        case 'adopter_appended':
            return { primary: _t ? 'sumó datos al perfil' : 'appended data to profile' };
        case 'adopter_deleted':
            return { primary: _t ? 'eliminó perfil' : 'deleted profile' };
        case 'adopter_deletion_requested':
            return { primary: _t ? 'pidió eliminar perfil' : 'requested profile deletion' };
        case 'adopter_made_public':
            return { primary: _t ? 'marcó perfil como público' : 'marked profile as public' };
        case 'adopter_made_private':
            return { primary: _t ? 'marcó perfil como privado' : 'marked profile as private' };
        case 'adopter_ownership_transferred': {
            const to = String(details.to ?? '');
            return {
                primary: _t ? 'transfirió propiedad' : 'transferred ownership',
                secondary: to ? `→ ${to}` : undefined,
            };
        }
        case 'adopter_country_backfilled':
            return {
                primary: _t ? 'completó país en perfil' : 'backfilled profile country',
                secondary: String(details.country ?? '') || undefined,
            };

        case 'adoption_created': {
            const an = String(details.animalName ?? '');
            const sp = String(details.species ?? '');
            return {
                primary: _t ? 'registró adopción' : 'recorded adoption',
                secondary: an ? `${an}${sp ? ` (${sp})` : ''}` : undefined,
            };
        }
        case 'adoption_updated':
            return { primary: _t ? 'editó adopción' : 'edited adoption' };
        case 'adoption_deleted':
            return { primary: _t ? 'eliminó adopción' : 'deleted adoption' };

        case 'animal_for_adoption_deleted':
            return {
                primary: _t ? 'eliminó animal en adopción' : 'deleted animal-for-adoption',
                secondary: String(details.animalName ?? '') || undefined,
            };
        case 'animal_image_deleted':
            return { primary: _t ? 'eliminó imagen de animal' : 'deleted animal image' };

        case 'flag_created': {
            const reason = String(details.reason ?? '');
            return {
                primary: _t ? 'reportó perfil' : 'flagged profile',
                accent: reason ? { text: reason, tone: 'rose' } : undefined,
            };
        }
        case 'verification_added':
            return { primary: _t ? 'verificó perfil' : 'verified profile' };

        case 'image_uploaded':
        case 'image_added':
            return { primary: _t ? 'subió una foto' : 'uploaded a photo' };
        case 'profile_picture_set':
            return { primary: _t ? 'cambió foto de perfil' : 'set profile picture' };

        case 'contact_entry_added':
            return {
                primary: _t ? 'agregó un contacto' : 'added a contact entry',
                secondary: String(details.type ?? '') || undefined,
            };
        case 'contact_entry_updated':
            return {
                primary: _t ? 'editó un contacto' : 'edited a contact entry',
                secondary: String(details.type ?? '') || undefined,
            };
        case 'contact_entry_removed':
            return {
                primary: _t ? 'eliminó un contacto' : 'removed a contact entry',
                secondary: String(details.type ?? '') || undefined,
            };

        case 'pii_access_requested':
            return { primary: _t ? 'pidió acceso a contacto' : 'requested PII access' };
        case 'pii_access_approved':
            return { primary: _t ? 'aprobó acceso a contacto' : 'approved PII access' };
        case 'pii_access_denied':
            return { primary: _t ? 'rechazó acceso a contacto' : 'denied PII access' };
        case 'pii_access_grant_revoked':
            return { primary: _t ? 'revocó acceso a contacto' : 'revoked PII access' };
        case 'pii_known_info_unlocked': {
            const entries = Number(details.entryCount ?? 0);
            const names = Number(details.nameTokenCount ?? 0);
            const parts: string[] = [];
            if (entries > 0) parts.push(`${entries} ${_t ? 'campo(s)' : 'field(s)'}`);
            if (names > 0) parts.push(`${names} ${_t ? 'nombre(s)' : 'name(s)'}`);
            return {
                primary: _t ? 'desbloqueó contacto conocido' : 'unlocked known PII',
                secondary: parts.join(' · ') || undefined,
            };
        }
        case 'pii_search_match_grant': {
            const count = Number(details.count ?? 0);
            return {
                primary: _t ? 'ganó acceso por búsqueda' : 'earned search-match grant',
                secondary: count ? `${count} ${_t ? (count === 1 ? 'perfil' : 'perfiles') : (count === 1 ? 'profile' : 'profiles')}` : undefined,
            };
        }

        case 'config_changed':
            return { primary: _t ? 'cambió configuración' : 'changed config' };
        case 'admin_sql_query': {
            const q = String(details.query ?? '');
            return {
                primary: _t ? 'corrió SQL' : 'ran SQL',
                accent: q ? { text: q.length > 80 ? q.slice(0, 80) + '…' : q, tone: 'stone' } : undefined,
            };
        }
        case 'contact_entries_backfilled':
            return { primary: _t ? 'corrió backfill de contactos' : 'ran contact-entries backfill' };

        case 'user_name_updated':
            return {
                primary: _t ? 'cambió nombre' : 'changed name',
                secondary: `${String(details.oldName ?? '')} → ${String(details.newName ?? '')}`,
            };
        case 'user_country_overridden':
            return {
                primary: _t ? 'cambió país manualmente' : 'overrode country',
                secondary: `${String(details.oldCountry ?? '')} → ${String(details.newCountry ?? '')}`,
            };

        default:
            // Unknown action: render the raw action name. Better than dropping
            // the row silently; admin can still expand the raw JSON.
            return { primary: action };
    }
}

/**
 * Most audit actions point `target` at an adopter id. Returns true when we
 * should attempt to resolve `target` against the `adopters` table for the
 * row's "subject" name. False for actions whose `target` is an unrelated
 * id type (sign-in events use the user id as target, etc.) — saves us
 * fruitless DB joins.
 */
export function targetIsAdopter(action: string): boolean {
    if (!action) return false;
    if (action === 'sign_in' || action === 'sign_out') return false;
    if (action === 'search' || action === 'config_changed' || action === 'admin_sql_query') return false;
    if (action === 'user_name_updated' || action === 'user_country_overridden') return false;
    if (action === 'animal_for_adoption_deleted' || action === 'animal_image_deleted') return false;
    if (action === 'contact_entries_backfilled') return false;
    if (action === 'pii_search_match_grant') return false;
    return true;
}
