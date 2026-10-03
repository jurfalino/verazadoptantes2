import { PawIcon } from './Icons'
import { firstShowable, isVideo, posterOf } from '../lib/media'
import { useT, localizedHref } from '../i18n/LocaleContext'

type TFn = (key: string, vars?: Record<string, string | number>) => string

/**
 * AnimalCard — one card in the showcase grid (v2.14.10-3).
 * Clicking navigates to /animal/[id]. Reuses petshield.css design tokens.
 */

export interface AnimalSummary {
    id: string
    animalName: string | null
    species: string | null
    sex: string | null
    neutered: number | null
    color: string | null
    images: { url: string; mediaType?: string | null; thumbnailUrl?: string | null }[]
    rescuer?: { displayName: string; orgName?: string }
}

// Canonical species key, accepting either Spanish or English source values.
const SPECIES_KEY: Record<string, string> = {
    perro: 'dog', dog: 'dog',
    gato: 'cat', cat: 'cat',
    ave: 'bird', bird: 'bird',
    conejo: 'rabbit', rabbit: 'rabbit',
    otro: 'other', other: 'other',
}

function speciesLabel(s: string | null | undefined, t: TFn): string {
    if (!s) return ''
    const key = SPECIES_KEY[s.toLowerCase()]
    return key ? t(`animal.species_${key}`) : s
}

function sexLabel(s: string | null | undefined, t: TFn): string {
    if (!s) return ''
    const v = s.toLowerCase()
    if (v === 'macho' || v === 'male') return t('animal.sex_male')
    if (v === 'hembra' || v === 'female') return t('animal.sex_female')
    return s
}

export default function AnimalCard({ animal }: { animal: AnimalSummary }) {
    const { t, locale } = useT()
    // Lead with the first item that can be DRAWN: a photo, or a video's
    // poster. A video without one cannot represent the animal in a grid.
    const heroItem = firstShowable(animal.images)
    const hero = heroItem ? posterOf(heroItem) : null
    const heroIsVideo = !!heroItem && isVideo(heroItem)
    const name = animal.animalName?.trim() || t('animal.unnamed')
    const subtitle = [speciesLabel(animal.species, t), sexLabel(animal.sex, t)].filter(Boolean).join(' · ')
    const rescuerLabel = animal.rescuer?.orgName || animal.rescuer?.displayName
    return (
        <a className="ps-showcase-card" href={localizedHref(`/animal/${animal.id}`, locale)}>
            <div className="ps-showcase-card__photo">
                {hero ? (
                    <>
                        <img src={hero} alt={name} loading="lazy" />
                        {heroIsVideo && (
                            <span className="ps-media-badge" aria-hidden>
                                <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M8 5v14l11-7z" /></svg>
                            </span>
                        )}
                    </>
                ) : (
                    <div className="ps-showcase-card__photo-empty" aria-hidden>
                        <PawIcon size={48} />
                    </div>
                )}
                <div className="ps-showcase-card__photo-fade" aria-hidden />
            </div>
            <div className="ps-showcase-card__body">
                <h3 className="ps-showcase-card__name">{name}</h3>
                {subtitle && <p className="ps-showcase-card__meta">{subtitle}</p>}
                {rescuerLabel && <p className="ps-showcase-card__rescuer">{rescuerLabel}</p>}
            </div>
        </a>
    )
}
