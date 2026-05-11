/**
 * ShowcaseHeader — top of every list page. Title (scope-aware) + animal count.
 */

interface Props {
    title: string
    subtitle?: string
    count: number
}

export default function ShowcaseHeader({ title, subtitle, count }: Props) {
    return (
        <header className="ps-showcase-header">
            <h1 className="ps-showcase-header__title">{title}</h1>
            {subtitle && <p className="ps-showcase-header__subtitle">{subtitle}</p>}
            <p className="ps-showcase-header__count">
                {count === 0 ? 'Sin animales disponibles' : `${count} animal${count === 1 ? '' : 'es'} en adopción`}
            </p>
        </header>
    )
}
