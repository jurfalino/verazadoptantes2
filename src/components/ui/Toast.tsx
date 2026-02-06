'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
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
        onClick: () => void;
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

// Convenience methods
export function useShowToast() {
    const { showToast } = useToast();

    return {
        success: (title: string, message?: string, action?: { label: string; onClick: () => void }) =>
            showToast({ type: 'success', title, message, action, duration: action ? 0 : 5000 }),
        error: (title: string, message?: string, errorId?: string) =>
            showToast({ type: 'error', title, message, errorId, duration: 0 }),
        warning: (title: string, message?: string) =>
            showToast({ type: 'warning', title, message }),
        info: (title: string, message?: string) =>
            showToast({ type: 'info', title, message })
    };
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

    return (
        <ToastContext.Provider value={{ toasts, showToast, dismissToast }}>
            {children}
            <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        </ToastContext.Provider>
    );
}

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
    if (toasts.length === 0) return null;

    return (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-md w-full">
            {toasts.map(toast => (
                <ToastItem key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />
            ))}
        </div>
    );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
    const [copied, setCopied] = useState(false);

    const icons = {
        success: <CheckCircle className="w-5 h-5 text-emerald-500" />,
        error: <AlertCircle className="w-5 h-5 text-red-500" />,
        warning: <AlertTriangle className="w-5 h-5 text-amber-500" />,
        info: <Info className="w-5 h-5 text-blue-500" />
    };

    const backgrounds = {
        success: 'bg-emerald-50 border-emerald-300 shadow-xl',
        error: 'bg-red-50 border-red-300 shadow-xl',
        warning: 'bg-amber-50 border-amber-300 shadow-xl',
        info: 'bg-blue-50 border-blue-300 shadow-xl'
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
            className={`${backgrounds[toast.type]} border rounded-lg shadow-lg p-4 animate-slide-in`}
            role="alert"
        >
            <div className="flex items-start gap-3">
                {icons[toast.type]}
                <div className="flex-1 min-w-0">
                    <p className="font-medium text-stone-900">{toast.title}</p>
                    {toast.message && (
                        <p className="text-sm text-stone-600 mt-1">{toast.message}</p>
                    )}
                    {toast.errorId && (
                        <button
                            onClick={copyErrorId}
                            className="mt-2 inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-700 font-mono bg-stone-100 px-2 py-1 rounded"
                        >
                            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            Error ID: {toast.errorId}
                        </button>
                    )}
                    {toast.action && (
                        <button
                            onClick={() => {
                                toast.action?.onClick();
                                onDismiss();
                            }}
                            className="mt-3 text-sm font-medium px-3 py-1.5 bg-white border border-stone-200 rounded-md hover:bg-stone-50 transition-colors shadow-sm"
                        >
                            {toast.action.label}
                        </button>
                    )}
                </div>
                <button
                    onClick={onDismiss}
                    className="text-stone-400 hover:text-stone-600"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}
