'use client';

import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';

/**
 * Why the login box was opened, when it isn't a plain click:
 * - `email-first`: Google can't work here (in-app browser that couldn't hand
 *   off to Chrome) — lead with the email code.
 * - `email-code`: an email code was already sent before the page reloaded —
 *   go straight back to the code step.
 */
export type LoginReason = 'email-first' | 'email-code';

interface AuthContextType {
    isLoginOpen: boolean;
    openLogin: (path?: string, reason?: LoginReason) => void;
    closeLogin: () => void;
    redirectPath: string | null;
    loginReason: LoginReason | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [isLoginOpen, setIsLoginOpen] = useState(false);
    const [redirectPath, setRedirectPath] = useState<string | null>(null);
    const [loginReason, setLoginReason] = useState<LoginReason | null>(null);

    const openLogin = useCallback((path?: string, reason?: LoginReason) => {
        if (path) setRedirectPath(path);
        setLoginReason(reason ?? null);
        setIsLoginOpen(true);
    }, []);

    const closeLogin = useCallback(() => {
        setIsLoginOpen(false);
        // Delay clearing redirectPath so LoginModal can still read it during
        // the closing animation.
        setTimeout(() => setRedirectPath(null), 500);
    }, []);

    // Memoized so consumers can safely put the returned value (or any of its
    // destructured fields) in a deps array without triggering re-render loops.
    const value = useMemo(
        () => ({ isLoginOpen, openLogin, closeLogin, redirectPath, loginReason }),
        [isLoginOpen, openLogin, closeLogin, redirectPath, loginReason],
    );

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuthContext() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuthContext must be used within an AuthProvider');
    }
    return context;
}
