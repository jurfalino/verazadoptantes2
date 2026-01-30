'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

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

    const openLogin = (path?: string) => {
        if (path) setRedirectPath(path);
        setIsLoginOpen(true);
    };

    const closeLogin = () => {
        setIsLoginOpen(false);
        // We delay clearing the path in case login needs it during closing animation
        // but for now, we can leave it or clear it. 
        // Better to clear it on successful login consumer side? 
        // Actually, LoginModal will read it.
        setTimeout(() => setRedirectPath(null), 500);
    };

    return (
        <AuthContext.Provider value={{ isLoginOpen, openLogin, closeLogin, redirectPath }}>
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
