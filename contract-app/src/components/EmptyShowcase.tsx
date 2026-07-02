import { PawIcon } from './Icons'
import { useT } from '../i18n/LocaleContext'

/**
 * EmptyShowcase — the "no animals available" state.
 * Designed component (not just text) per CX call. Shows an Instagram CTA
 * only when the global INSTAGRAM_URL is configured (admin/config); otherwise
 * just the friendly empty message.
 */

interface Props {
    instagramUrl?: string | null
    scopeLabel?: string  // e.g. "esta organización", "este rescatista", "la plataforma"
}

export default function EmptyShowcase({ instagramUrl, scopeLabel }: Props) {
    const { t } = useT()
    const where = scopeLabel || t('showcase.scope_platform')
    return (
        <div className="ps-showcase-empty">
            <div className="ps-showcase-empty__icon" aria-hidden>
                <PawIcon size={56} />
            </div>
            <h2 className="ps-showcase-empty__title">{t('showcase.empty_title')}</h2>
            <p className="ps-showcase-empty__desc">
                {t('showcase.empty_desc', { where })}
                {instagramUrl ? ` ${t('showcase.empty_follow_hint')}` : ''}
            </p>
            {instagramUrl && (
                <a
                    href={instagramUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ps-btn ps-btn--primary ps-showcase-empty__cta"
                >
                    {t('showcase.empty_cta')}
                </a>
            )}
        </div>
    )
}
