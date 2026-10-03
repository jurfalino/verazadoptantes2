import ContractPage from './ContractPage'
import ErrorBoundary from './ErrorBoundary'
import PetShieldForm from './PetShieldForm'
import TermsPage from './TermsPage'
import Showcase from './Showcase'
import AnimalDetail from './AnimalDetail'
import HealthRecord from './HealthRecord'
import HomePage from './HomePage'
import { LocaleProvider, useT } from './i18n/LocaleContext'

// UUIDs are 36 chars: 8-4-4-4-12 hex with hyphens. Check before the named
// routes so existing `/{animalId}` contract URLs keep working unchanged.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function AppRoutes() {
    const { t } = useT()
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

    // ── /c/<token> — locked contract (v2.14.10-21 / Phase 5) ─────────
    // Token-locked contract URL issued by the rescuer's "Enviar contrato"
    // action. Pre-fills the adopter's info into the form and prevents
    // anyone else from signing the same link. Tokens are UUIDs but the
    // /c/ prefix keeps them out of the legacy /{uuid} branch above.
    if (path.startsWith('c/')) {
        const token = path.slice('c/'.length)
        return (
            <ErrorBoundary>
                <ContractPage token={token} />
            </ErrorBoundary>
        )
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

    // ── /salud/:token ────────────────────────────────────────────────
    // The animal's veterinary record, handed by the rescuer to the family that
    // adopted or is fostering them. Unlike /animal/:id it keeps working while
    // the animal IS placed — that is the whole point — and it carries no
    // person other than the rescue that recorded it.
    //
    // The path is the placement's own token (v2.56.126), not the animal id: it
    // dies when the animal comes home, and a later adoption mints a new one.
    if (path.startsWith('salud/')) {
        const token = path.slice('salud/'.length)
        return (
            <ErrorBoundary>
                <HealthRecord token={token} />
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
                <h1 className="text-xl font-bold text-stone-900 mb-2">{t('common.not_found_title')}</h1>
                <p className="text-stone-500 text-sm mb-4">
                    {t('common.not_found_body')}
                </p>
                <a href="/" className="ps-btn ps-btn--primary inline-block">{t('common.view_animals_cta')}</a>
            </div>
        </div>
    )
}

function App() {
    return (
        <LocaleProvider>
            <AppRoutes />
        </LocaleProvider>
    )
}

export default App
