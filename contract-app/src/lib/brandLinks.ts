// Link helpers for group branding on the public pages.

/**
 * Carries the catalogue's group to the next page as `g=<slug>` (a hint the
 * server re-checks — it never trusts it). No slug ⇒ the href is untouched.
 */
export function withGroupHint(href: string, slug: string | null | undefined): string {
    if (!slug) return href
    const hashAt = href.indexOf('#')
    const base = hashAt === -1 ? href : href.slice(0, hashAt)
    const hash = hashAt === -1 ? '' : href.slice(hashAt)
    return `${base}${base.includes('?') ? '&' : '?'}g=${encodeURIComponent(slug)}${hash}`
}

/** Only absolute https: URLs are rendered (logo, banner, social links); anything else ⇒ null. */
export function httpsOnly(url: string | null | undefined): string | null {
    if (!url) return null
    try {
        return new URL(url).protocol === 'https:' ? url : null
    } catch {
        return null
    }
}

/**
 * The «follow on Instagram» CTA: on a branded page it is the group's own
 * Instagram (https only); otherwise — or when the group has none — the
 * platform's, as today. null ⇒ no CTA.
 */
export function followInstagramUrl(branding: { instagramUrl: string | null } | null, platformUrl: string | null | undefined): string | null {
    return (branding && httpsOnly(branding.instagramUrl)) || platformUrl || null
}

/**
 * Which group an animal page names («publicado por» + its back link). A branded
 * page wears the look of `branding`'s group — the `?g=` catalogue the visitor came
 * from, accepted by the server only when the poster is a member — so it names
 * that group too. Otherwise the poster's group (or the poster) as the API sent it.
 */
export function shownPublisher(
    rescuer: { displayName: string; orgName?: string; orgSlug?: string; userHandle?: string },
    branding: { orgName: string; orgSlug: string | null } | null,
): { label: string; orgSlug: string | null; userHandle: string | null } {
    if (branding?.orgSlug) return { label: branding.orgName, orgSlug: branding.orgSlug, userHandle: null }
    return { label: rescuer.orgName || rescuer.displayName, orgSlug: rescuer.orgSlug || null, userHandle: rescuer.userHandle || null }
}
