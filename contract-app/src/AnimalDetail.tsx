import { useEffect, useState } from 'react'
import { PawIcon, AlertIcon } from './components/Icons'
import { useT, localizedHref } from './i18n/LocaleContext'

type TFn = (key: string, vars?: Record<string, string | number>) => string

const API_URL = import.meta.env.VITE_API_URL || ''

interface AnimalDetailData {
    id: string
    animalName: string | null
    species: string | null
    age: string | null
    estimatedBirthDate: number | null
    sex: string | null
    neutered: number | null
    color: string | null
    microchip: string | null
    details: string | null
    images: { id: string; url: string; caption: string | null }[]
    rescuer: {
        displayName: string
        orgName?: string
        orgSlug?: string
        userHandle?: string
        userId?: string
    }
}

interface ApiResponse {
    animal: AnimalDetailData
    instagramUrl?: string
}

// Canonical species key, accepting either Spanish or English source values.
const SPECIES_KEY: Record<string, string> = {
    perro: 'dog', dog: 'dog',
    gato: 'cat', cat: 'cat',
    ave: 'bird', bird: 'bird',
    conejo: 'rabbit', rabbit: 'rabbit',
    otro: 'other', other: 'other',
}

function speciesLabel(s: string | null, t: TFn): string {
    if (!s) return ''
    const key = SPECIES_KEY[s.toLowerCase()]
    return key ? t(`animal.species_${key}`) : s
}

function sexLabel(s: string | null, t: TFn): string {
    if (!s) return ''
    const v = s.toLowerCase()
    if (v === 'macho' || v === 'male') return t('animal.sex_male')
    if (v === 'hembra' || v === 'female') return t('animal.sex_female')
    return s
}

function ageLabel(estimatedBirthDate: number | null, ageText: string | null, t: TFn): string {
    if (estimatedBirthDate) {
        const years = (Date.now() / 1000 - estimatedBirthDate) / (365.25 * 24 * 3600)
        if (years < 1) {
            const months = Math.max(1, Math.round(years * 12))
            return t(months === 1 ? 'animal.age_month' : 'animal.age_months', { n: months })
        }
        const yrs = Math.round(years)
        return t(yrs === 1 ? 'animal.age_year' : 'animal.age_years', { n: yrs })
    }
    return ageText || ''
}

/**
 * AnimalDetail — the per-animal page. Hero photo + gallery + badges +
 * description + "Adoptar" CTA that launches the form pre-loaded with
 * this animal id.
 *
 * SEO: per-animal title + OG image (the hero photo). JSON-LD `Product`
 * structured data so Google can extract richer card data for search results.
 */
export default function AnimalDetail({ animalId }: { animalId: string }) {
    const { t, locale } = useT()
    const [data, setData] = useState<ApiResponse | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [activeImageIdx, setActiveImageIdx] = useState(0)

    useEffect(() => {
        async function load() {
            setLoading(true)
            setError(null)
            try {
                const res = await fetch(`${API_URL}/api/showcase/animal/${encodeURIComponent(animalId)}`)
                if (!res.ok) {
                    setError(res.status === 404 ? t('animal.no_longer_available') : t('common.network_error'))
                    return
                }
                const body = await res.json() as ApiResponse
                setData(body)
            } catch {
                setError(t('common.network_error'))
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [animalId, t])

    // SEO meta + JSON-LD
    useEffect(() => {
        if (!data) return
        const a = data.animal
        const name = a.animalName?.trim() || 'Animal en adopción'
        const subtitle = [speciesLabel(a.species, t), sexLabel(a.sex, t), ageLabel(a.estimatedBirthDate, a.age, t)].filter(Boolean).join(' · ')
        document.title = `${name} busca hogar · Buen Adoptante`
        setMetaTag('description', `${name}${subtitle ? ' — ' + subtitle : ''}. Conocelo y postulate para adoptar.`)
        setMetaTag('og:title', `${name} busca hogar`, 'property')
        setMetaTag('og:description', subtitle || 'Animal en adopción', 'property')
        setMetaTag('og:type', 'website', 'property')
        const heroImg = a.images[0]?.url
        if (heroImg) setMetaTag('og:image', heroImg, 'property')
        // JSON-LD structured data — Product schema (closest match for an
        // adoptable animal listing). Google + social crawlers parse this
        // for richer search-result cards.
        let jsonLd = document.getElementById('animal-jsonld')
        if (!jsonLd) {
            jsonLd = document.createElement('script')
            jsonLd.id = 'animal-jsonld'
            jsonLd.setAttribute('type', 'application/ld+json')
            document.head.appendChild(jsonLd)
        }
        jsonLd.textContent = JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Product',
            name,
            description: a.details || subtitle,
            image: a.images.map(i => i.url),
            brand: { '@type': 'Organization', name: a.rescuer.orgName || a.rescuer.displayName },
        })
    }, [data, t])

    if (loading) {
        return <main className="ps-showcase-page"><div className="ps-showcase-loading">{t('common.loading')}</div></main>
    }
    if (error || !data) {
        return (
            <main className="ps-showcase-page">
                <div className="ps-showcase-empty">
                    <div className="ps-showcase-empty__icon" aria-hidden>
                        <AlertIcon size={48} />
                    </div>
                    <h2 className="ps-showcase-empty__title">{error || t('common.not_found')}</h2>
                    <p className="ps-showcase-empty__desc">
                        <a href={localizedHref('/', locale)} className="ps-showcase-back-link">{t('common.view_animals_cta')}</a>
                    </p>
                </div>
            </main>
        )
    }

    const a = data.animal
    const name = a.animalName?.trim() || t('animal.unnamed')
    const heroImage = a.images[activeImageIdx]?.url || a.images[0]?.url
    const adoptHref = a.rescuer.userId
        ? localizedHref(`/form?u=${encodeURIComponent(a.rescuer.userId)}&animal=${encodeURIComponent(a.id)}`, locale)
        : null
    const rescuerBackHref =
        a.rescuer.orgSlug ? localizedHref(`/org/${a.rescuer.orgSlug}`, locale) :
        a.rescuer.userHandle ? localizedHref(`/user/${a.rescuer.userHandle}`, locale) :
        null
    const rescuerLabel = a.rescuer.orgName || a.rescuer.displayName

    return (
        <main className="ps-showcase-page ps-animal-detail">
            <a href={localizedHref('/all', locale)} className="ps-showcase-back-link">{t('animal.back_to_catalog')}</a>

            <div className="ps-animal-hero">
                {heroImage ? (
                    <img src={heroImage} alt={name} className="ps-animal-hero__img" />
                ) : (
                    <div className="ps-animal-hero__empty" aria-hidden>
                        <PawIcon size={96} />
                    </div>
                )}
            </div>

            {a.images.length > 1 && (
                <div className="ps-animal-thumbs">
                    {a.images.map((img, i) => (
                        <button
                            key={img.id}
                            type="button"
                            className={`ps-animal-thumb ${i === activeImageIdx ? 'ps-animal-thumb--active' : ''}`}
                            onClick={() => setActiveImageIdx(i)}
                            aria-label={t('animal.photo_position', { n: i + 1, total: a.images.length })}
                        >
                            <img src={img.url} alt="" />
                        </button>
                    ))}
                </div>
            )}

            <h1 className="ps-animal-name">{name}</h1>

            <div className="ps-animal-badges">
                {speciesLabel(a.species, t) && <span className="ps-animal-badge">{speciesLabel(a.species, t)}</span>}
                {sexLabel(a.sex, t) && <span className="ps-animal-badge">{sexLabel(a.sex, t)}</span>}
                {ageLabel(a.estimatedBirthDate, a.age, t) && <span className="ps-animal-badge">{ageLabel(a.estimatedBirthDate, a.age, t)}</span>}
                {a.neutered === 1 && <span className="ps-animal-badge">{t('animal.neutered')}</span>}
                {a.color && <span className="ps-animal-badge">{a.color}</span>}
                {a.microchip && <span className="ps-animal-badge ps-animal-badge--mono">Microchip</span>}
            </div>

            {a.details && (
                <div className="ps-animal-details">
                    <h2 className="ps-animal-section-title">{t('animal.about', { name })}</h2>
                    <p className="ps-animal-description">{a.details}</p>
                </div>
            )}

            {rescuerLabel && (
                <div className="ps-animal-rescuer">
                    <span className="ps-animal-rescuer__label">{t('animal.posted_by')}</span>
                    {rescuerBackHref ? (
                        <a href={rescuerBackHref} className="ps-animal-rescuer__link">{rescuerLabel}</a>
                    ) : (
                        <span className="ps-animal-rescuer__name">{rescuerLabel}</span>
                    )}
                </div>
            )}

            <div className="ps-animal-cta">
                {adoptHref ? (
                    <a href={adoptHref} className="ps-btn ps-btn--primary ps-animal-cta__btn">{t('animal.adopt_cta')}</a>
                ) : (
                    <p className="ps-animal-cta__unavailable">{t('animal.unavailable_for_application')}</p>
                )}
                {data.instagramUrl && (
                    <a
                        href={data.instagramUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ps-btn ps-btn--ghost ps-animal-cta__ig"
                    >
                        {t('animal.follow_instagram')}
                    </a>
                )}
            </div>

            {/* Sticky mobile CTA (mobile-only via CSS). Only when adoption is
                actually possible — when unavailable, the inline message above
                is sufficient and a sticky bar would mislead. */}
            {adoptHref && (
                <div className="ps-animal-cta-sticky" aria-hidden="false">
                    <a href={adoptHref} className="ps-btn ps-btn--primary ps-animal-cta-sticky__btn">
                        {t('animal.adopt_cta')}
                    </a>
                </div>
            )}
        </main>
    )
}

function setMetaTag(name: string, content: string, attr: 'name' | 'property' = 'name') {
    if (!content) return
    let el = document.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`)
    if (!el) {
        el = document.createElement('meta')
        el.setAttribute(attr, name)
        document.head.appendChild(el)
    }
    el.setAttribute('content', content)
}
