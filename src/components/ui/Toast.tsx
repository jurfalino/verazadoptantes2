'use client';

import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info, Copy, Check } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
    id: string;
    type: ToastType;
    title: string;
    message?: string;
    errorId?: string;
    duration?: number;
    action?: {
        label: string;
        onClick?: () => void;
        href?: string;
    };
}

interface ToastContextType {
    toasts: Toast[];
    showToast: (toast: Omit<Toast, 'id'>) => void;
    dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
}

// Convenience methods.
// IMPORTANT: the returned object is memoized so its identity is stable across
// re-renders. Several call sites put `toast` in a useEffect/useCallback deps
// array (PendingDedup, ClientErrorReporter, ...). Without useMemo, every
// render produced a fresh object and those effects looped — at scale that
// hammered the Next.js server-action endpoint (POSTs to the originating
// route) hard enough to trip Cloudflare's 1102 worker-CPU limit.
export function useShowToast() {
    const { showToast } = useToast();

    return useMemo(() => ({
        success: (title: string, message?: string, action?: { label: string; onClick?: () => void; href?: string }) =>
            showToast({ type: 'success', title, message, action, duration: action ? 0 : 5000 }),
        error: (title: string, message?: string, errorId?: string) =>
            showToast({ type: 'error', title, message, errorId, duration: 0 }),
        warning: (title: string, message?: string) =>
            showToast({ type: 'warning', title, message }),
        info: (title: string, message?: string) =>
            showToast({ type: 'info', title, message })
    }), [showToast]);
}

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const showToast = useCallback((toast: Omit<Toast, 'id'>) => {
        const id = crypto.randomUUID();
        const duration = toast.duration ?? 5000;

        setToasts(prev => [...prev, { ...toast, id }]);

        if (duration > 0) {
            setTimeout(() => {
                setToasts(prev => prev.filter(t => t.id !== id));
            }, duration);
        }
    }, []);

    const dismissToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const value = useMemo(
        () => ({ toasts, showToast, dismissToast }),
        [toasts, showToast, dismissToast],
    );

    return (
        <ToastContext.Provider value={value}>
            {children}
            <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        </ToastContext.Provider>
    );
}

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
    if (toasts.length === 0) return null;

    return (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 max-w-md w-full pointer-events-none">
            {toasts.map(toast => (
                <ToastItem key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />
            ))}
        </div>
    );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
    const [copied, setCopied] = useState(false);

    const icons = {
        success: <CheckCircle className="w-5 h-5" style={{ color: 'var(--status-success-text)' }} />,
        error: <AlertCircle className="w-5 h-5" style={{ color: 'var(--status-error-text)' }} />,
        warning: <AlertTriangle className="w-5 h-5" style={{ color: 'var(--status-warning-text)' }} />,
        info: <Info className="w-5 h-5" style={{ color: 'var(--status-info-text)' }} />
    };

    const accentColors = {
        success: 'var(--status-success-text)',
        error: 'var(--status-error-text)',
        warning: 'var(--status-warning-text)',
        info: 'var(--status-info-text)'
    };

    const copyErrorId = () => {
        if (toast.errorId) {
            navigator.clipboard.writeText(toast.errorId);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <div
            className="rounded-lg p-4 animate-slide-in pointer-events-auto"
            role="alert"
            style={{
                background: 'var(--surface-card)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-default)',
                borderLeft: `4px solid ${accentColors[toast.type]}`,
                boxShadow: '0 10px 25px rgba(0,0,0,0.3)'
            }}
        >
            <div className="flex items-start gap-3">
                {icons[toast.type]}
                <div className="flex-1 min-w-0">
                    <p className="font-medium break-words" style={{ color: 'var(--text-primary)' }}>{toast.title}</p>
                    {toast.message && (
                        <p className="text-sm mt-1 break-words" style={{ color: 'var(--text-muted)' }}>{toast.message}</p>
                    )}
                    {toast.errorId && (
                        <button
                            onClick={copyErrorId}
                            className="mt-2 inline-flex items-center gap-1 text-xs font-mono px-2 py-1 rounded"
                            style={{ color: 'var(--text-muted)', background: 'var(--surface-muted)' }}
                        >
                            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            Error ID: {toast.errorId}
                        </button>
                    )}
                    {toast.action && (
                        toast.action.href ? (
                            <a
                                href={toast.action.href}
                                className="mt-3 inline-block text-sm font-semibold px-4 py-2 rounded-lg transition-opacity hover:opacity-80 no-underline"
                                style={{ background: accentColors[toast.type], color: 'var(--btn-primary-text)' }}
                                onClick={() => onDismiss()}
                            >
                                {toast.action.label}
                            </a>
                        ) : (
                            <button
                                onClick={() => {
                                    toast.action?.onClick?.();
                                    onDismiss();
                                }}
                                className="mt-3 text-sm font-semibold px-4 py-2 rounded-lg transition-opacity hover:opacity-80"
                                style={{ background: accentColors[toast.type], color: 'var(--btn-primary-text)' }}
                            >
                                {toast.action.label}
                            </button>
                        )
                    )}
                </div>
                <button
                    onClick={onDismiss}
                    className="hover:opacity-70"
                    style={{ color: 'var(--text-muted)' }}
                >
                    <X className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}
