import ContractPage from './ContractPage'
import ErrorBoundary from './ErrorBoundary'
import PetShieldForm from './PetShieldForm'
import TermsPage from './TermsPage'

function App() {
    // Simple routing: URL is /{animalId}
    const path = window.location.pathname.replace(/^\//, '').replace(/\/$/, '')

    // PetShield Form route: /form?u={userId}&animal={animalId?}
    // The optional `animal` param signals the form was launched from the
    // public showcase ("Adoptar" click on /animal/[id]). When present, the
    // form skips steps 2/3/4 (species / lifeStage / specialNeeds) since
    // the animal choice is already known, and attaches animalId to the
    // submission so the rescuer's notification can name the specific animal.
    if (path === 'form') {
        const params = new URLSearchParams(window.location.search)
        const userId = params.get('u')
        const animalId = params.get('animal')
        return (
            <ErrorBoundary>
                <PetShieldForm userId={userId} animalId={animalId} />
            </ErrorBoundary>
        )
    }

    // Terms and Conditions route: /terms
    if (path === 'terms') {
        return <TermsPage />
    }

    if (!path) {
        return (
            <div className="min-h-screen bg-stone-200 flex items-center justify-center px-4">
                <div className="bg-white rounded-2xl p-8 text-center border border-stone-200 shadow-sm max-w-md">
                    <div className="text-5xl mb-4">📋</div>
                    <h1 className="text-xl font-bold text-stone-900 mb-2">Contrato de Adopción</h1>
                    <p className="text-stone-500 text-sm">
                        Este enlace necesita un identificador de animal. Verificá que el link sea correcto.
                    </p>
                </div>
            </div>
        )
    }

    return (
        <ErrorBoundary>
            <ContractPage animalId={path} />
        </ErrorBoundary>
    )
}

export default App
