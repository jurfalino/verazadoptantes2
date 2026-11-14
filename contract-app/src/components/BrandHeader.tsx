import type { PublicBranding } from '../lib/branding'
import { httpsOnly } from '../lib/brandLinks'
import { useT } from '../i18n/LocaleContext'
import { InstagramIcon, FacebookIcon, WebIcon } from './Icons'

/**
 * The group's identity on the public pages (spec 2026-11-13-group-branding).
 * Only https: URLs are ever rendered; anything else is skipped as if unset.
 */

/** The group's social links that are set (and https). */
export function brandLinkList(b: PublicBranding) {
    return [
        { href: httpsOnly(b.instagramUrl), key: 'showcase.follow_instagram', Icon: InstagramIcon },
        { href: httpsOnly(b.facebookUrl), key: 'showcase.follow_facebook', Icon: FacebookIcon },
        { href: httpsOnly(b.websiteUrl), key: 'showcase.follow_website', Icon: WebIcon },
    ].filter((l): l is typeof l & { href: string } => !!l.href)
}

export function BrandLinks({ b, labelled = false }: { b: PublicBranding; labelled?: boolean }) {
    const { t } = useT()
    const links = brandLinkList(b)
    if (links.length === 0) return null
    return (
        <div className={labelled ? 'pb-links pb-links--labelled' : 'pb-links'}>
            {links.map(({ href, key, Icon }) => (
                <a key={key} className="pb-link" href={href} target="_blank" rel="noopener noreferrer">
                    <Icon size={labelled ? 18 : 16} />
                    <span>{t(key)}</span>
                </a>
            ))}
        </div>
    )
}

/**
 * The logo in its own round white tile; nothing when unset or not https.
 * Decorative by default (`alt=""`): every use sits next to the group's visible
 * name, which a screen reader would otherwise hear twice. Pass `alt` (e.g. the
 * group name) where the logo stands alone.
 */
export function BrandLogo({ b, size = 64, alt = '' }: { b: PublicBranding; size?: number; alt?: string }) {
    const src = httpsOnly(b.logoUrl)
    if (!src) return null
    return <img className="pb-logo" src={src} alt={alt} width={size} height={size} style={{ width: size, height: size }} />
}

/** Full header: group / personal catalogue pages. */
export function BrandHeader({ b, subtitle, count }: { b: PublicBranding; subtitle?: string; count?: string }) {
    const banner = httpsOnly(b.bannerUrl)
    return (
        <header className={banner ? 'pb-header pb-header--banner' : 'pb-header'}>
            {banner && (
                <div className="pb-banner">
                    <img src={banner} alt="" width={1200} height={400} loading="lazy" />
                </div>
            )}
            <div className="pb-identity">
                <BrandLogo b={b} size={72} />
                <div className="pb-identity__text">
                    <h1 className="pb-name">{b.orgName}</h1>
                    {subtitle && <p className="pb-subtitle">{subtitle}</p>}
                    {count && <p className="pb-count">{count}</p>}
                </div>
            </div>
            <BrandLinks b={b} />
        </header>
    )
}

/** Compact bar: form and animal pages. */
export function BrandBar({ b }: { b: PublicBranding }) {
    return (
        <div className="pb-bar" data-testid="brand-bar">
            <BrandLogo b={b} size={40} />
            <div className="pb-bar__name">{b.orgName}</div>
        </div>
    )
}
