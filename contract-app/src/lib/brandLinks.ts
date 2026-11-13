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
