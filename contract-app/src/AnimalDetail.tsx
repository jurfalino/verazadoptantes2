import { useEffect, useState } from 'react'
import { PawIcon, AlertIcon } from './components/Icons'

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

const SPECIES_LABEL: Record<string, string> = { cat: 'Gato', dog: 'Perro', bird: 'Ave' }

function speciesLabel(s: string | null): string {
    if (!s) return ''
    return SPECIES_LABEL[s.toLowerCase()] || s
}

function sexLabel(s: string | null): string {
    if (!s) return ''
    const v = s.toLowerCase()
    if (v === 'macho' || v === 'male') return 'Macho'
    if (v === 'hembra' || v === 'female') return 'Hembra'
    return s
}

function ageLabel(estimatedBirthDate: number | null, ageText: string | null): string {
    if (estimatedBirthDate) {
        const years = (Date.now() / 1000 - estimatedBirthDate) / (365.25 * 24 * 3600)
        if (years < 1) {
            const months = Math.max(1, Math.round(years * 12))
            return `${months} ${months === 1 ? 'mes' : 'meses'}`
        }
        const yrs = Math.round(years)
        return `${yrs} ${yrs === 1 ? 'año' : 'años'}`
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
                    setError(res.status === 404 ? 'Este animal ya no está disponible' : 'Error de red')
                    return
                }
                const body = await res.json() as ApiResponse
                setData(body)
            } catch {
                setError('Error de red')
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [animalId])

    // SEO meta + JSON-LD
    useEffect(() => {
        if (!data) return
        const a = data.animal
        const name = a.animalName?.trim() || 'Animal en adopción'
        const subtitle = [speciesLabel(a.species), sexLabel(a.sex), ageLabel(a.estimatedBirthDate, a.age)].filter(Boolean).join(' · ')
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
    }, [data])

    if (loading) {
        return <main className="ps-showcase-page"><div className="ps-showcase-loading">Cargando…</div></main>
    }
    if (error || !data) {
        return (
            <main className="ps-showcase-page">
                <div className="ps-showcase-empty">
                    <div className="ps-showcase-empty__icon" aria-hidden>
                        <AlertIcon size={48} />
                    </div>
                    <h2 className="ps-showcase-empty__title">{error || 'No encontrado'}</h2>
                    <p className="ps-showcase-empty__desc">
                        <a href="/" className="ps-showcase-back-link">Ver otros animales en adopción</a>
                    </p>
                </div>
            </main>
        )
    }

    const a = data.animal
    const name = a.animalName?.trim() || 'Sin nombre'
    const heroImage = a.images[activeImageIdx]?.url || a.images[0]?.url
    const adoptHref = a.rescuer.userId
        ? `/form?u=${encodeURIComponent(a.rescuer.userId)}&animal=${encodeURIComponent(a.id)}`
        : null
    const rescuerBackHref =
        a.rescuer.orgSlug ? `/org/${a.rescuer.orgSlug}` :
        a.rescuer.userHandle ? `/user/${a.rescuer.userHandle}` :
        null
    const rescuerLabel = a.rescuer.orgName || a.rescuer.displayName

    return (
        <main className="ps-showcase-page ps-animal-detail">
            <a href="/all" className="ps-showcase-back-link">← Volver al catálogo</a>

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
                            aria-label={`Foto ${i + 1} de ${a.images.length}`}
                        >
                            <img src={img.url} alt="" />
                        </button>
                    ))}
                </div>
            )}

            <h1 className="ps-animal-name">{name}</h1>

            <div className="ps-animal-badges">
                {speciesLabel(a.species) && <span className="ps-animal-badge">{speciesLabel(a.species)}</span>}
                {sexLabel(a.sex) && <span className="ps-animal-badge">{sexLabel(a.sex)}</span>}
                {ageLabel(a.estimatedBirthDate, a.age) && <span className="ps-animal-badge">{ageLabel(a.estimatedBirthDate, a.age)}</span>}
                {a.neutered === 1 && <span className="ps-animal-badge">Castrado/a</span>}
                {a.color && <span className="ps-animal-badge">{a.color}</span>}
                {a.microchip && <span className="ps-animal-badge ps-animal-badge--mono">Microchip</span>}
            </div>

            {a.details && (
                <div className="ps-animal-details">
                    <h2 className="ps-animal-section-title">Sobre {name}</h2>
                    <p className="ps-animal-description">{a.details}</p>
                </div>
            )}

            {rescuerLabel && (
                <div className="ps-animal-rescuer">
                    <span className="ps-animal-rescuer__label">Publicado por</span>
                    {rescuerBackHref ? (
                        <a href={rescuerBackHref} className="ps-animal-rescuer__link">{rescuerLabel}</a>
                    ) : (
                        <span className="ps-animal-rescuer__name">{rescuerLabel}</span>
                    )}
                </div>
            )}

            <div className="ps-animal-cta">
                {adoptHref ? (
                    <a href={adoptHref} className="ps-btn ps-btn--primary ps-animal-cta__btn">Quiero adoptarlo</a>
                ) : (
                    <p className="ps-animal-cta__unavailable">Este animal no está disponible para postulación en este momento.</p>
                )}
                {data.instagramUrl && (
                    <a
                        href={data.instagramUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ps-btn ps-btn--ghost ps-animal-cta__ig"
                    >
                        Seguinos en Instagram
                    </a>
                )}
            </div>

            {/* Sticky mobile CTA (mobile-only via CSS). Only when adoption is
                actually possible — when unavailable, the inline message above
                is sufficient and a sticky bar would mislead. */}
            {adoptHref && (
                <div className="ps-animal-cta-sticky" aria-hidden="false">
                    <a href={adoptHref} className="ps-btn ps-btn--primary ps-animal-cta-sticky__btn">
                        Quiero adoptarlo
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
