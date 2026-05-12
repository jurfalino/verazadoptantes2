import { useEffect, useState } from 'react'
import AnimalCard, { type AnimalSummary } from './components/AnimalCard'
import ShowcaseHeader from './components/ShowcaseHeader'
import EmptyShowcase from './components/EmptyShowcase'
import { AlertIcon } from './components/Icons'

const API_URL = import.meta.env.VITE_API_URL || ''

export type ShowcaseScope =
    | { kind: 'all' }
    | { kind: 'org'; slug: string }
    | { kind: 'user'; handle: string }

interface ApiResponse {
    animals: AnimalSummary[]
    org?: { name: string; slug: string }
    rescuer?: { displayName: string; orgName?: string }
    instagramUrl?: string
}

/**
 * Showcase — the list page for the public catalog (v2.14.10-3).
 *
 * Three scopes share this component: global ("/"), org ("/org/:slug"), and
 * user ("/user/:handle"). The scope tells us which API to hit and how to
 * render the header. Instagram URL for the empty state is fetched alongside.
 *
 * SEO: sets `document.title` + OG meta tags on mount via React effect.
 * Best-effort for SPAs — Googlebot does execute JS but slower than SSR
 * (see Tech-stack call in the plan doc).
 */
export default function Showcase({ scope }: { scope: ShowcaseScope }) {
    const [data, setData] = useState<ApiResponse | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [instagramUrl, setInstagramUrl] = useState<string>('')

    useEffect(() => {
        async function load() {
            setLoading(true)
            setError(null)
            try {
                const endpoint =
                    scope.kind === 'all' ? `${API_URL}/api/showcase/all` :
                    scope.kind === 'org' ? `${API_URL}/api/showcase/org/${encodeURIComponent(scope.slug)}` :
                    `${API_URL}/api/showcase/user/${encodeURIComponent(scope.handle)}`
                const res = await fetch(endpoint)
                if (!res.ok) {
                    setError(res.status === 404 ? 'No encontrado' : 'Error de red')
                    setData(null)
                    return
                }
                const body = await res.json() as ApiResponse
                setData(body)
                // Fetch global config for INSTAGRAM_URL (needed for empty state).
                // Best-effort: if it fails, the empty state just skips the CTA.
                if (body.animals.length === 0) {
                    try {
                        const cfgRes = await fetch(`${API_URL}/api/config`)
                        if (cfgRes.ok) {
                            const cfg = await cfgRes.json() as { config?: Record<string, string> }
                            setInstagramUrl(cfg.config?.INSTAGRAM_URL || '')
                        }
                    } catch { /* swallow */ }
                }
            } catch {
                setError('Error de red')
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [scope.kind, scope.kind === 'org' ? scope.slug : scope.kind === 'user' ? scope.handle : ''])

    // SEO meta + document title via React effect (SPA-side best-effort).
    useEffect(() => {
        const baseTitle =
            scope.kind === 'all' ? 'Animales en adopción' :
            scope.kind === 'org' ? `${data?.org?.name || 'Organización'} — Animales en adopción` :
            `${data?.rescuer?.displayName || 'Rescatista'} — Animales en adopción`
        document.title = `${baseTitle} · Buen Adoptante`
        setMetaTag('description', `Conocé los animales en adopción${scope.kind === 'all' ? '' : ` de ${baseTitle.split(' — ')[0]}`}. Adoptá responsablemente.`)
        setMetaTag('og:title', baseTitle, 'property')
        setMetaTag('og:type', 'website', 'property')
        const heroImg = data?.animals[0]?.images[0]?.url
        if (heroImg) setMetaTag('og:image', heroImg, 'property')
    }, [scope.kind, data])

    if (loading) {
        return (
            <main className="ps-showcase-page">
                <div className="ps-showcase-loading" aria-busy="true">Cargando…</div>
            </main>
        )
    }
    if (error) {
        return (
            <main className="ps-showcase-page">
                <div className="ps-showcase-empty">
                    <div className="ps-showcase-empty__icon" aria-hidden>
                        <AlertIcon size={48} />
                    </div>
                    <h2 className="ps-showcase-empty__title">No pudimos cargar el catálogo</h2>
                    <p className="ps-showcase-empty__desc">{error}. Intentá nuevamente en unos minutos.</p>
                </div>
            </main>
        )
    }
    if (!data) return null

    const headerTitle =
        scope.kind === 'all' ? 'Animales en adopción' :
        scope.kind === 'org' ? data.org?.name || 'Organización' :
        data.rescuer?.displayName || 'Rescatista'
    const headerSubtitle =
        scope.kind === 'all' ? 'De toda la comunidad rescatista' :
        scope.kind === 'org' ? 'Animales disponibles de esta organización' :
        'Animales disponibles de este rescatista'
    const scopeLabel =
        scope.kind === 'all' ? 'la plataforma' :
        scope.kind === 'org' ? 'esta organización' :
        'este rescatista'

    return (
        <main className="ps-showcase-page">
            <ShowcaseHeader title={headerTitle} subtitle={headerSubtitle} count={data.animals.length} />
            {data.animals.length === 0 ? (
                <EmptyShowcase instagramUrl={instagramUrl} scopeLabel={scopeLabel} />
            ) : (
                <div className="ps-showcase-grid">
                    {data.animals.map((a) => (
                        <AnimalCard key={a.id} animal={a} />
                    ))}
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
