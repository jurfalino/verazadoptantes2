import ContractPage from './ContractPage'
import ErrorBoundary from './ErrorBoundary'

function App() {
    // Simple routing: URL is /{animalId}
    const path = window.location.pathname.replace(/^\//, '').replace(/\/$/, '')

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
