import { useT } from '../i18n/LocaleContext'

/**
 * ShowcaseHeader — top of every list page. Title (scope-aware) + animal count.
 */

interface Props {
    title: string
    subtitle?: string
    count: number
}

export default function ShowcaseHeader({ title, subtitle, count }: Props) {
    const { t } = useT()
    const countLabel =
        count === 0 ? t('showcase.count_none') :
        count === 1 ? t('showcase.count_one', { count }) :
        t('showcase.count_other', { count })
    return (
        <header className="ps-showcase-header">
            <h1 className="ps-showcase-header__title">{title}</h1>
            {subtitle && <p className="ps-showcase-header__subtitle">{subtitle}</p>}
            <p className="ps-showcase-header__count">{countLabel}</p>
        </header>
    )
}
