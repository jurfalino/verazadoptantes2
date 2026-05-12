import { useEffect, useState } from 'react'
import AnimalCard, { type AnimalSummary } from './components/AnimalCard'

const API_URL = import.meta.env.VITE_API_URL || ''
const FEATURED_COUNT = 6

interface AllResponse {
    animals: AnimalSummary[]
}

/**
 * HomePage — the canonical landing at /.
 *
 * Funnel structure (top to bottom):
 *   1. Hero        — tagline + primary CTA → /all
 *   2. Featured    — first 6 from /api/showcase/all (newest first)
 *   3. How it works — 3 short steps framing the funnel
 *   4. Closing CTA — vetting framing + CTA → /all
 *
 * The full catalog lives at /all (Showcase scope='all'). This page is
 * for first-impression / discovery; /all is for browsing.
 */
export default function HomePage() {
    const [animals, setAnimals] = useState<AnimalSummary[] | null>(null)
    const [total, setTotal] = useState<number>(0)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        async function load() {
            try {
                const res = await fetch(`${API_URL}/api/showcase/all`)
                if (!res.ok) return
                const body = await res.json() as AllResponse
                setAnimals(body.animals.slice(0, FEATURED_COUNT))
                setTotal(body.animals.length)
            } catch { /* keep loading=true → false in finally */ }
            finally { setLoading(false) }
        }
        load()
    }, [])

    useEffect(() => {
        document.title = 'Buen Adoptante — Adoptá responsablemente'
        setMetaTag('description', 'Encontrá tu próxima compañía. Animales rescatados que buscan un hogar responsable. Adoptá con compromiso.')
        setMetaTag('og:title', 'Buen Adoptante — Adoptá responsablemente', 'property')
        setMetaTag('og:type', 'website', 'property')
        setMetaTag('og:description', 'Encontrá tu próxima compañía. Animales rescatados que buscan un hogar responsable.', 'property')
    }, [])

    const showFeatured = animals && animals.length > 0
    const moreCount = Math.max(0, total - FEATURED_COUNT)

    return (
        <main className="ps-home">
            {/* ── Hero ─────────────────────────────────────────── */}
            <section className="ps-home-hero">
                <h1 className="ps-home-hero__title">Encontrá a tu próxima compañía</h1>
                <p className="ps-home-hero__sub">
                    Animales rescatados que buscan un hogar responsable.
                </p>
                <a href="/all" className="ps-btn ps-btn--primary ps-home-hero__cta">
                    Ver animales en adopción
                    <span aria-hidden>→</span>
                </a>
            </section>

            {/* ── Featured animals ─────────────────────────────── */}
            {loading ? (
                <section className="ps-home-section">
                    <FeaturedSkeleton />
                </section>
            ) : showFeatured ? (
                <section className="ps-home-section">
                    <p className="ps-home-section__eyebrow">Algunos que buscan hogar</p>
                    <div className="ps-showcase-grid ps-home-featured">
                        {animals!.map((a) => <AnimalCard key={a.id} animal={a} />)}
                    </div>
                    {moreCount > 0 && (
                        <a href="/all" className="ps-home-featured__more">
                            Ver los {total} animales disponibles
                            <span aria-hidden>→</span>
                        </a>
                    )}
                </section>
            ) : null}

            {/* ── How it works ─────────────────────────────────── */}
            <section className="ps-home-section ps-home-steps-section">
                <p className="ps-home-section__eyebrow">Cómo adoptamos acá</p>
                <ol className="ps-home-steps">
                    <li className="ps-home-step">
                        <div className="ps-home-step__num" aria-hidden>1</div>
                        <h3 className="ps-home-step__title">Conocé</h3>
                        <p className="ps-home-step__desc">Mirá los animales en adopción y sus historias.</p>
                    </li>
                    <li className="ps-home-step">
                        <div className="ps-home-step__num" aria-hidden>2</div>
                        <h3 className="ps-home-step__title">Postulate</h3>
                        <p className="ps-home-step__desc">Completá un formulario corto sobre vos y tu casa.</p>
                    </li>
                    <li className="ps-home-step">
                        <div className="ps-home-step__num" aria-hidden>3</div>
                        <h3 className="ps-home-step__title">Te contactan</h3>
                        <p className="ps-home-step__desc">La organización rescatista te escribe para coordinar.</p>
                    </li>
                </ol>
            </section>

            {/* ── Closing CTA / mission ────────────────────────── */}
            <section className="ps-home-closing">
                <p className="ps-home-closing__text">
                    Adoptar es un compromiso de años. Por eso pedimos un formulario corto antes de
                    conectarte con la organización rescatista — para que el match sea para toda la vida.
                </p>
                <a href="/all" className="ps-btn ps-btn--primary ps-home-closing__cta">
                    Ver todos los animales
                    <span aria-hidden>→</span>
                </a>
            </section>
        </main>
    )
}

function FeaturedSkeleton() {
    return (
        <div className="ps-showcase-grid ps-home-featured" aria-hidden>
            {Array.from({ length: FEATURED_COUNT }).map((_, i) => (
                <div key={i} className="ps-home-card-skeleton">
                    <div className="ps-home-card-skeleton__photo" />
                    <div className="ps-home-card-skeleton__line ps-home-card-skeleton__line--lg" />
                    <div className="ps-home-card-skeleton__line" />
                </div>
            ))}
        </div>
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
