import ContractPage from './ContractPage'
import ErrorBoundary from './ErrorBoundary'
import PetShieldForm from './PetShieldForm'
import TermsPage from './TermsPage'
import Showcase from './Showcase'
import AnimalDetail from './AnimalDetail'
import HomePage from './HomePage'

// UUIDs are 36 chars: 8-4-4-4-12 hex with hyphens. Check before the named
// routes so existing `/{animalId}` contract URLs keep working unchanged.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function App() {
    const path = window.location.pathname.replace(/^\//, '').replace(/\/$/, '')
    const params = new URLSearchParams(window.location.search)

    // ── /form?u={userId}&animal={animalId?} ──────────────────────────
    // PetShield form. The optional `animal` URL param skips the three
    // animal-preference steps (species/lifeStage/specialNeeds) — v2.14.10-2.
    if (path === 'form') {
        return (
            <ErrorBoundary>
                <PetShieldForm userId={params.get('u')} animalId={params.get('animal')} />
            </ErrorBoundary>
        )
    }

    // ── /terms ───────────────────────────────────────────────────────
    if (path === 'terms') {
        return <TermsPage />
    }

    // ── /{uuid} ──────────────────────────────────────────────────────
    // Existing contract route. Must match BEFORE the named showcase
    // routes so a 36-char UUID-shaped path doesn't get caught by, say,
    // /animal/:id when the user lands directly on the legacy URL shape.
    if (UUID_RE.test(path)) {
        return (
            <ErrorBoundary>
                <ContractPage animalId={path} />
            </ErrorBoundary>
        )
    }

    // ── /animal/:id ──────────────────────────────────────────────────
    if (path.startsWith('animal/')) {
        const animalId = path.slice('animal/'.length)
        return (
            <ErrorBoundary>
                <AnimalDetail animalId={animalId} />
            </ErrorBoundary>
        )
    }

    // ── /org/:slug ───────────────────────────────────────────────────
    if (path.startsWith('org/')) {
        const slug = path.slice('org/'.length)
        return (
            <ErrorBoundary>
                <Showcase scope={{ kind: 'org', slug }} />
            </ErrorBoundary>
        )
    }

    // ── /user/:handle ────────────────────────────────────────────────
    if (path.startsWith('user/')) {
        const handle = path.slice('user/'.length)
        return (
            <ErrorBoundary>
                <Showcase scope={{ kind: 'user', handle }} />
            </ErrorBoundary>
        )
    }

    // ── /all — full global catalog ───────────────────────────────────
    // Previously at /; moved here so / can host a marketing-style landing
    // that frames the funnel before dropping visitors into the grid.
    if (path === 'all') {
        return (
            <ErrorBoundary>
                <Showcase scope={{ kind: 'all' }} />
            </ErrorBoundary>
        )
    }

    // ── / (root) ─────────────────────────────────────────────────────
    // Canonical landing: hero + featured (6 from /all) + how-it-works
    // + closing CTA. The catalog itself lives at /all.
    if (!path) {
        return (
            <ErrorBoundary>
                <HomePage />
            </ErrorBoundary>
        )
    }

    // ── 404 fallback ─────────────────────────────────────────────────
    return (
        <div className="min-h-screen bg-stone-200 flex items-center justify-center px-4">
            <div className="bg-white rounded-2xl p-8 text-center border border-stone-200 shadow-sm max-w-md">
                <div className="text-5xl mb-4">🔍</div>
                <h1 className="text-xl font-bold text-stone-900 mb-2">Página no encontrada</h1>
                <p className="text-stone-500 text-sm mb-4">
                    Verificá que el link sea correcto.
                </p>
                <a href="/" className="ps-btn ps-btn--primary inline-block">Ver animales en adopción</a>
            </div>
        </div>
    )
}

export default App
