'use client';

import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';

interface AuthContextType {
    isLoginOpen: boolean;
    openLogin: (path?: string) => void;
    closeLogin: () => void;
    redirectPath: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [isLoginOpen, setIsLoginOpen] = useState(false);
    const [redirectPath, setRedirectPath] = useState<string | null>(null);

    const openLogin = useCallback((path?: string) => {
        if (path) setRedirectPath(path);
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
        () => ({ isLoginOpen, openLogin, closeLogin, redirectPath }),
        [isLoginOpen, openLogin, closeLogin, redirectPath],
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
