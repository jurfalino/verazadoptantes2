import { Component, type ReactNode } from 'react'

interface Props {
    children: ReactNode
}

interface State {
    hasError: boolean
    error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props)
        this.state = { hasError: false, error: null }
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error }
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error('[CONTRACT-APP CRASH]', error, info.componentStack)
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen bg-stone-200 flex items-center justify-center px-4">
                    <div className="bg-white rounded-2xl p-8 text-center border border-stone-200 shadow-sm max-w-md space-y-4">
                        <div className="text-5xl">😿</div>
                        <h2 className="text-xl font-extrabold text-stone-900">
                            Algo salió mal / Something went wrong
                        </h2>
                        <p className="text-stone-500 text-sm">
                            Si el problema persiste, intentá abrir el enlace de nuevo.
                            <br />
                            If the issue persists, try opening the link again.
                        </p>
                        <button
                            onClick={() => window.location.reload()}
                            className="px-6 py-2.5 bg-stone-800 text-white rounded-xl font-bold text-sm hover:bg-stone-900 transition-colors shadow-md"
                        >
                            🔄 Reintentar / Try Again
                        </button>
                    </div>
                </div>
            )
        }

        return this.props.children
    }
}
