'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
    theme: Theme;
    setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setThemeState] = useState<Theme>('light');
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        // Load from localStorage on mount
        const stored = localStorage.getItem('theme');
        // Migrate legacy 'apple' theme to 'light'
        if (stored === 'apple') {
            localStorage.setItem('theme', 'light');
            setThemeState('light');
        } else if (stored === 'dark') {
            setThemeState('dark');
        }
        setMounted(true);
    }, []);

    useEffect(() => {
        if (mounted) {
            // Apply theme to document
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('theme', theme);
        }
    }, [theme, mounted]);

    const setTheme = (newTheme: Theme) => {
        setThemeState(newTheme);
    };

    // Always provide context, even before mount (children will use defaults safely)
    return (
        <ThemeContext.Provider value={{ theme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        // Return safe defaults for SSR
        return { theme: 'light' as const, setTheme: () => { } };
    }
    return context;
}
