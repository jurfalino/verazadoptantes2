import { Component, type ReactNode } from 'react'
import { translate } from './i18n/index'
import { resolveInitialLocale } from './i18n/LocaleContext'

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
            // Class component + crash path: resolve locale straight from the URL
            // (?lang=) rather than context, which may be unavailable mid-crash.
            const locale = resolveInitialLocale()
            return (
                <div className="min-h-screen bg-stone-200 flex items-center justify-center px-4">
                    <div className="bg-white rounded-2xl p-8 text-center border border-stone-200 shadow-sm max-w-md space-y-4">
                        <div className="text-5xl">😿</div>
                        <h2 className="text-xl font-extrabold text-stone-900">
                            {translate(locale, 'common.something_wrong')}
                        </h2>
                        <p className="text-stone-500 text-sm">
                            {translate(locale, 'common.error_persist_hint')}
                        </p>
                        <button
                            onClick={() => window.location.reload()}
                            className="px-6 py-2.5 bg-stone-800 text-white rounded-xl font-bold text-sm hover:bg-stone-900 transition-colors shadow-md"
                        >
                            🔄 {translate(locale, 'common.retry')}
                        </button>
                    </div>
                </div>
            )
        }

        return this.props.children
    }
}
